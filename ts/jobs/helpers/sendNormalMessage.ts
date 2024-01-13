// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { isNumber } from 'lodash';
import PQueue from 'p-queue';

import * as Errors from '../../types/errors';
import { strictAssert } from '../../util/assert';
import type { MessageModel } from '../../models/messages';
import { __DEPRECATED$getMessageById } from '../../messages/getMessageById';
import type { ConversationModel } from '../../models/conversations';
import { isGroup, isGroupV2, isMe } from '../../util/whatTypeOfConversation';
import { getSendOptions } from '../../util/getSendOptions';
import { SignalService as Proto } from '../../protobuf';
import { handleMessageSend } from '../../util/handleMessageSend';
import { findAndFormatContact } from '../../util/findAndFormatContact';
import { uploadAttachment } from '../../util/uploadAttachment';
import type { CallbackResultType } from '../../textsecure/Types.d';
import { isSent } from '../../messages/MessageSendState';
import { isOutgoing, canReact } from '../../state/selectors/message';
import type {
  ReactionType,
  OutgoingQuoteType,
  OutgoingQuoteAttachmentType,
  OutgoingLinkPreviewType,
  OutgoingStickerType,
} from '../../textsecure/SendMessage';
import type {
  AttachmentType,
  UploadedAttachmentType,
  AttachmentWithHydratedData,
} from '../../types/Attachment';
import { copyCdnFields } from '../../util/attachments';
import { LONG_MESSAGE } from '../../types/MIME';
import type { RawBodyRange } from '../../types/BodyRange';
import type {
  EmbeddedContactWithHydratedAvatar,
  EmbeddedContactWithUploadedAvatar,
} from '../../types/EmbeddedContact';
import type { StoryContextType } from '../../types/Util';
import type { LoggerType } from '../../types/Logging';
import type {
  ConversationQueueJobBundle,
  NormalMessageSendJobData,
} from '../conversationJobQueue';

import { handleMultipleSendErrors } from './handleMultipleSendErrors';
import { ourProfileKeyService } from '../../services/ourProfileKey';
import { isConversationUnregistered } from '../../util/isConversationUnregistered';
import { isConversationAccepted } from '../../util/isConversationAccepted';
import { sendToGroup } from '../../util/sendToGroup';
import type { DurationInSeconds } from '../../util/durations';
import type { ServiceIdString } from '../../types/ServiceId';
import { normalizeAci } from '../../util/normalizeAci';
import * as Bytes from '../../Bytes';
import {
  getPropForTimestamp,
  getTargetOfThisEditTimestamp,
  setPropForTimestamp,
} from '../../util/editHelpers';
import { getMessageSentTimestamp } from '../../util/getMessageSentTimestamp';

const LONG_ATTACHMENT_LIMIT = 2048;
const MAX_CONCURRENT_ATTACHMENT_UPLOADS = 5;

export async function sendNormalMessage(
  conversation: ConversationModel,
  {
    isFinalAttempt,
    messaging,
    shouldContinue,
    timeRemaining,
    log,
  }: ConversationQueueJobBundle,
  data: NormalMessageSendJobData
): Promise<void> {
  const { Message } = window.Signal.Types;

  const { messageId, revision, editedMessageTimestamp } = data;
  const message = await __DEPRECATED$getMessageById(messageId);
  if (!message) {
    log.info(
      `message ${messageId} was not found, maybe because it was deleted. Giving up on sending it`
    );
    return;
  }

  const messageConversation = message.getConversation();
  if (messageConversation !== conversation) {
    log.error(
      `Message conversation '${messageConversation?.idForLogging()}' does not match job conversation ${conversation.idForLogging()}`
    );
    return;
  }

  if (!isOutgoing(message.attributes)) {
    log.error(
      `message ${messageId} was not an outgoing message to begin with. This is probably a bogus job. Giving up on sending it`
    );
    return;
  }

  if (message.isErased() || message.get('deletedForEveryone')) {
    log.info(`message ${messageId} was erased. Giving up on sending it`);
    return;
  }

  // The original timestamp for this message
  const messageTimestamp = getMessageSentTimestamp(message.attributes, {
    includeEdits: false,
    log,
  });
  // The timestamp for the thing we're sending now, whether a first send or an edit
  const targetTimestamp = editedMessageTimestamp || messageTimestamp;
  // The timestamp identifying the target of this edit; could be the original timestamp
  //   or the most recent edit prior to this one
  const targetOfThisEditTimestamp = getTargetOfThisEditTimestamp({
    message,
    targetTimestamp,
  });

  let messageSendErrors: Array<Error> = [];

  // We don't want to save errors on messages unless we're giving up. If it's our
  //   final attempt, we know upfront that we want to give up. However, we might also
  //   want to give up if (1) we get a 508 from the server, asking us to please stop
  //   (2) we get a 428 from the server, flagging the message for spam (3) some other
  //   reason not known at the time of this writing.
  //
  // This awkward callback lets us hold onto errors we might want to save, so we can
  //   decide whether to save them later on.
  const saveErrors = isFinalAttempt
    ? undefined
    : (errors: Array<Error>) => {
        messageSendErrors = errors;
      };

  if (!shouldContinue) {
    log.info(`message ${messageId} ran out of time. Giving up on sending it`);
    await markMessageFailed({
      message,
      errors: [new Error('Message send ran out of time')],
      targetTimestamp,
    });
    return;
  }

  let profileKey: Uint8Array | undefined;
  if (conversation.get('profileSharing')) {
    profileKey = await ourProfileKeyService.get();
  }

  let originalError: Error | undefined;

  try {
    const {
      allRecipientServiceIds,
      recipientServiceIdsWithoutMe,
      sentRecipientServiceIds,
      untrustedServiceIds,
    } = getMessageRecipients({
      log,
      message,
      conversation,
      targetTimestamp,
    });

    if (untrustedServiceIds.length) {
      window.reduxActions.conversations.conversationStoppedByMissingVerification(
        {
          conversationId: conversation.id,
          untrustedServiceIds,
        }
      );
      throw new Error(
        `Message ${messageId} sending blocked because ${untrustedServiceIds.length} conversation(s) were untrusted. Failing this attempt.`
      );
    }

    if (!allRecipientServiceIds.length) {
      log.warn(
        `trying to send message ${messageId} but it looks like it was already sent to everyone. This is unexpected, but we're giving up`
      );
      return;
    }

    const {
      attachments,
      body,
      contact,
      deletedForEveryoneTimestamp,
      expireTimer,
      bodyRanges,
      preview,
      quote,
      reaction,
      sticker,
      storyMessage,
      storyContext,
    } = await getMessageSendData({ log, message, targetTimestamp });

    if (reaction) {
      strictAssert(
        storyMessage,
        'Only story reactions can be sent as normal messages'
      );

      const ourConversationId =
        window.ConversationController.getOurConversationIdOrThrow();

      if (
        !canReact(
          storyMessage.attributes,
          ourConversationId,
          findAndFormatContact
        )
      ) {
        log.info(
          `could not react to ${messageId}. Removing this pending reaction`
        );
        await markMessageFailed({
          message,
          errors: [new Error('Could not react to story')],
          targetTimestamp,
        });
        return;
      }
    }

    log.info(
      'Sending normal message;',
      `editedMessageTimestamp=${editedMessageTimestamp},`,
      `storyMessage=${Boolean(storyMessage)}`
    );

    let messageSendPromise: Promise<CallbackResultType | void>;

    if (recipientServiceIdsWithoutMe.length === 0) {
      if (
        !isMe(conversation.attributes) &&
        !isGroup(conversation.attributes) &&
        sentRecipientServiceIds.length === 0
      ) {
        log.info(
          'No recipients; not sending to ourselves or to group, and no successful sends. Failing job.'
        );
        void markMessageFailed({
          message,
          errors: [new Error('No valid recipients')],
          targetTimestamp,
        });
        return;
      }

      // We're sending to Note to Self or a 'lonely group' with just us in it
      // or sending a story to a group where all other users don't have the stories
      // capabilities (effectively a 'lonely group' in the context of stories)
      log.info('sending sync message only');
      const dataMessage = await messaging.getDataOrEditMessage({
        attachments,
        body,
        bodyRanges,
        contact,
        deletedForEveryoneTimestamp,
        expireTimer,
        groupV2: conversation.getGroupV2Info({
          members: recipientServiceIdsWithoutMe,
        }),
        preview,
        profileKey,
        quote,
        recipients: allRecipientServiceIds,
        sticker,
        storyContext,
        targetTimestampForEdit: editedMessageTimestamp
          ? targetOfThisEditTimestamp
          : undefined,
        timestamp: targetTimestamp,
        reaction,
      });
      messageSendPromise = message.sendSyncMessageOnly({
        dataMessage,
        saveErrors,
        targetTimestamp,
      });
    } else {
      const conversationType = conversation.get('type');
      const sendOptions = await getSendOptions(conversation.attributes);
      const { ContentHint } = Proto.UnidentifiedSenderMessage.Message;

      let innerPromise: Promise<CallbackResultType>;
      if (conversationType === Message.GROUP) {
        // Note: this will happen for all old jobs queued beore 5.32.x
        if (isGroupV2(conversation.attributes) && !isNumber(revision)) {
          log.error('No revision provided, but conversation is GroupV2');
        }

        const groupV2Info = conversation.getGroupV2Info({
          members: recipientServiceIdsWithoutMe,
        });
        if (groupV2Info && isNumber(revision)) {
          groupV2Info.revision = revision;
        }

        log.info('sending group message');
        innerPromise = conversation.queueJob(
          'conversationQueue/sendNormalMessage',
          abortSignal =>
            sendToGroup({
              abortSignal,
              contentHint: ContentHint.RESENDABLE,
              groupSendOptions: {
                attachments,
                bodyRanges,
                contact,
                deletedForEveryoneTimestamp,
                expireTimer,
                groupV2: groupV2Info,
                messageText: body,
                preview,
                profileKey,
                quote,
                sticker,
                storyContext,
                reaction,
                targetTimestampForEdit: editedMessageTimestamp
                  ? targetOfThisEditTimestamp
                  : undefined,
                timestamp: targetTimestamp,
              },
              messageId,
              sendOptions,
              sendTarget: conversation.toSenderKeyTarget(),
              sendType: 'message',
              story: Boolean(storyContext),
              urgent: true,
            })
        );
      } else {
        if (!isConversationAccepted(conversation.attributes)) {
          log.info(
            `conversation ${conversation.idForLogging()} is not accepted; refusing to send`
          );
          void markMessageFailed({
            message,
            errors: [new Error('Message request was not accepted')],
            targetTimestamp,
          });
          return;
        }
        if (isConversationUnregistered(conversation.attributes)) {
          log.info(
            `conversation ${conversation.idForLogging()} is unregistered; refusing to send`
          );
          void markMessageFailed({
            message,
            errors: [new Error('Contact no longer has a Signal account')],
            targetTimestamp,
          });
          return;
        }
        if (conversation.isBlocked()) {
          log.info(
            `conversation ${conversation.idForLogging()} is blocked; refusing to send`
          );
          void markMessageFailed({
            message,
            errors: [new Error('Contact is blocked')],
            targetTimestamp,
          });
          return;
        }

        log.info('sending direct message');
        innerPromise = messaging.sendMessageToServiceId({
          attachments,
          bodyRanges,
          contact,
          contentHint: ContentHint.RESENDABLE,
          deletedForEveryoneTimestamp,
          expireTimer,
          groupId: undefined,
          serviceId: recipientServiceIdsWithoutMe[0],
          messageText: body,
          options: sendOptions,
          preview,
          profileKey,
          quote,
          sticker,
          storyContext,
          reaction,
          targetTimestampForEdit: editedMessageTimestamp
            ? targetOfThisEditTimestamp
            : undefined,
          timestamp: targetTimestamp,
          // Note: 1:1 story replies should not set story=true -   they aren't group sends
          urgent: true,
          includePniSignatureMessage: true,
        });
      }

      messageSendPromise = message.send({
        promise: handleMessageSend(innerPromise, {
          messageIds: [messageId],
          sendType: 'message',
        }),
        saveErrors,
        targetTimestamp,
      });

      // Because message.send swallows and processes errors, we'll await the inner promise
      //   to get the SendMessageProtoError, which gives us information upstream
      //   processors need to detect certain kinds of situations.
      try {
        await innerPromise;
      } catch (error) {
        if (error instanceof Error) {
          originalError = error;
        } else {
          log.error(
            `promiseForError threw something other than an error: ${Errors.toLogFormat(
              error
            )}`
          );
        }
      }
    }

    await messageSendPromise;

    const didFullySend =
      !messageSendErrors.length ||
      didSendToEveryone({
        log,
        message,
        targetTimestamp: editedMessageTimestamp || messageTimestamp,
      });
    if (!didFullySend) {
      throw new Error('message did not fully send');
    }
  } catch (thrownError: unknown) {
    const errors = [thrownError, ...messageSendErrors];
    await handleMultipleSendErrors({
      errors,
      isFinalAttempt,
      log,
      markFailed: () =>
        markMessageFailed({
          message,
          errors: messageSendErrors,
          targetTimestamp,
        }),
      timeRemaining,
      // In the case of a failed group send thrownError will not be SentMessageProtoError,
      //   but we should have been able to harvest the original error. In the Note to Self
      //   send case, thrownError will be the error we care about, and we won't have an
      //   originalError.
      toThrow: originalError || thrownError,
    });
  }
}

function getMessageRecipients({
  log,
  conversation,
  message,
  targetTimestamp,
}: Readonly<{
  log: LoggerType;
  conversation: ConversationModel;
  message: MessageModel;
  targetTimestamp: number;
}>): {
  allRecipientServiceIds: Array<ServiceIdString>;
  recipientServiceIdsWithoutMe: Array<ServiceIdString>;
  sentRecipientServiceIds: Array<ServiceIdString>;
  untrustedServiceIds: Array<ServiceIdString>;
} {
  const allRecipientServiceIds: Array<ServiceIdString> = [];
  const recipientServiceIdsWithoutMe: Array<ServiceIdString> = [];
  const untrustedServiceIds: Array<ServiceIdString> = [];
  const sentRecipientServiceIds: Array<ServiceIdString> = [];

  const currentConversationRecipients = conversation.getMemberConversationIds();

  const sendStateByConversationId =
    getPropForTimestamp({
      log,
      message,
      prop: 'sendStateByConversationId',
      targetTimestamp,
    }) || {};

  Object.entries(sendStateByConversationId).forEach(
    ([recipientConversationId, sendState]) => {
      const recipient = window.ConversationController.get(
        recipientConversationId
      );
      if (!recipient) {
        return;
      }

      const isRecipientMe = isMe(recipient.attributes);

      if (
        !currentConversationRecipients.has(recipientConversationId) &&
        !isRecipientMe
      ) {
        return;
      }

      if (recipient.isUntrusted()) {
        const serviceId = recipient.getServiceId();
        if (!serviceId) {
          log.error(
            `sendNormalMessage/getMessageRecipients: Untrusted conversation ${recipient.idForLogging()} missing serviceId.`
          );
          return;
        }
        untrustedServiceIds.push(serviceId);
        return;
      }
      if (recipient.isUnregistered()) {
        return;
      }
      if (recipient.isBlocked()) {
        return;
      }

      const recipientIdentifier = recipient.getSendTarget();
      if (!recipientIdentifier) {
        return;
      }

      if (isSent(sendState.status)) {
        sentRecipientServiceIds.push(recipientIdentifier);
        return;
      }

      allRecipientServiceIds.push(recipientIdentifier);
      if (!isRecipientMe) {
        recipientServiceIdsWithoutMe.push(recipientIdentifier);
      }
    }
  );

  return {
    allRecipientServiceIds,
    recipientServiceIdsWithoutMe,
    sentRecipientServiceIds,
    untrustedServiceIds,
  };
}

async function getMessageSendData({
  log,
  message,
  targetTimestamp,
}: Readonly<{
  log: LoggerType;
  message: MessageModel;
  targetTimestamp: number;
}>): Promise<{
  attachments: Array<UploadedAttachmentType>;
  body: undefined | string;
  contact?: Array<EmbeddedContactWithUploadedAvatar>;
  deletedForEveryoneTimestamp: undefined | number;
  expireTimer: undefined | DurationInSeconds;
  bodyRanges: undefined | ReadonlyArray<RawBodyRange>;
  preview: Array<OutgoingLinkPreviewType> | undefined;
  quote: OutgoingQuoteType | undefined;
  sticker: OutgoingStickerType | undefined;
  reaction: ReactionType | undefined;
  storyMessage?: MessageModel;
  storyContext?: StoryContextType;
}> {
  const storyId = message.get('storyId');

  // Figure out if we need to upload message body as an attachment.
  let body = getPropForTimestamp({
    log,
    message,
    prop: 'body',
    targetTimestamp,
  });
  let maybeLongAttachment: AttachmentWithHydratedData | undefined;
  if (body && body.length > LONG_ATTACHMENT_LIMIT) {
    const data = Bytes.fromString(body);

    maybeLongAttachment = {
      contentType: LONG_MESSAGE,
      fileName: `long-message-${targetTimestamp}.txt`,
      data,
      size: data.byteLength,
    };
    body = body.slice(0, LONG_ATTACHMENT_LIMIT);
  }

  const uploadQueue = new PQueue({
    concurrency: MAX_CONCURRENT_ATTACHMENT_UPLOADS,
  });

  const preUploadAttachments =
    getPropForTimestamp({
      log,
      message,
      prop: 'attachments',
      targetTimestamp,
    }) || [];
  const [
    uploadedAttachments,
    maybeUploadedLongAttachment,
    contact,
    preview,
    quote,
    sticker,
    storyMessage,
  ] = await Promise.all([
    uploadQueue.addAll(
      preUploadAttachments.map(
        attachment => () =>
          uploadSingleAttachment({
            attachment,
            log,
            message,
            targetTimestamp,
          })
      )
    ),
    uploadQueue.add(async () =>
      maybeLongAttachment ? uploadAttachment(maybeLongAttachment) : undefined
    ),
    uploadMessageContacts(message, uploadQueue),
    uploadMessagePreviews({
      log,
      message,
      targetTimestamp,
      uploadQueue,
    }),
    uploadMessageQuote({
      log,
      message,
      targetTimestamp,
      uploadQueue,
    }),
    uploadMessageSticker(message, uploadQueue),
    storyId ? __DEPRECATED$getMessageById(storyId) : undefined,
  ]);

  // Save message after uploading attachments
  await window.Signal.Data.saveMessage(message.attributes, {
    ourAci: window.textsecure.storage.user.getCheckedAci(),
  });

  const storyReaction = message.get('storyReaction');
  const storySourceServiceId = storyMessage?.get('sourceServiceId');

  let reactionForSend: ReactionType | undefined;
  if (storyReaction) {
    const { targetAuthorAci, ...restOfReaction } = storyReaction;

    reactionForSend = {
      ...restOfReaction,
      targetAuthorAci,
      remove: false,
    };
  }

  return {
    attachments: [
      ...(maybeUploadedLongAttachment ? [maybeUploadedLongAttachment] : []),
      ...uploadedAttachments,
    ],
    body,
    contact,
    deletedForEveryoneTimestamp: message.get('deletedForEveryoneTimestamp'),
    expireTimer: message.get('expireTimer'),
    bodyRanges: getPropForTimestamp({
      log,
      message,
      prop: 'bodyRanges',
      targetTimestamp,
    }),
    preview,
    quote,
    reaction: reactionForSend,
    sticker,
    storyMessage,
    storyContext: storyMessage
      ? {
          authorAci: storySourceServiceId
            ? normalizeAci(
                storySourceServiceId,
                'sendNormalMessage.storyContext.authorAci'
              )
            : undefined,
          timestamp: storyMessage.get('sent_at'),
        }
      : undefined,
  };
}

async function uploadSingleAttachment({
  attachment,
  log,
  message,
  targetTimestamp,
}: {
  attachment: AttachmentType;
  log: LoggerType;
  message: MessageModel;
  targetTimestamp: number;
}): Promise<UploadedAttachmentType> {
  const { loadAttachmentData } = window.Signal.Migrations;

  const withData = await loadAttachmentData(attachment);
  const uploaded = await uploadAttachment(withData);

  // Add digest to the attachment
  const logId = `uploadSingleAttachment(${message.idForLogging()}`;
  const oldAttachments = getPropForTimestamp({
    log,
    message,
    prop: 'attachments',
    targetTimestamp,
  });
  strictAssert(
    oldAttachments !== undefined,
    `${logId}: Attachment was uploaded, but message doesn't ` +
      'have attachments anymore'
  );

  const index = oldAttachments.indexOf(attachment);
  strictAssert(
    index !== -1,
    `${logId}: Attachment was uploaded, but isn't in the message anymore`
  );

  const newAttachments = [...oldAttachments];
  newAttachments[index] = {
    ...newAttachments[index],
    ...copyCdnFields(uploaded),
  };

  setPropForTimestamp({
    log,
    message,
    prop: 'attachments',
    targetTimestamp,
    value: newAttachments,
  });

  return uploaded;
}

async function uploadMessageQuote({
  log,
  message,
  targetTimestamp,
  uploadQueue,
}: {
  log: LoggerType;
  message: MessageModel;
  targetTimestamp: number;
  uploadQueue: PQueue;
}): Promise<OutgoingQuoteType | undefined> {
  const { loadQuoteData } = window.Signal.Migrations;

  // We don't update the caches here because (1) we expect the caches to be populated
  //   on initial send, so they should be there in the 99% case (2) if you're retrying
  //   a failed message across restarts, we don't touch the cache for simplicity. If
  //   sends are failing, let's not add the complication of a cache.
  const startingQuote = getPropForTimestamp({
    log,
    message,
    prop: 'quote',
    targetTimestamp,
  });
  const loadedQuote =
    message.cachedOutgoingQuoteData || (await loadQuoteData(startingQuote));

  if (!loadedQuote) {
    return undefined;
  }

  const attachmentsAfterThumbnailUpload = await uploadQueue.addAll(
    loadedQuote.attachments.map(
      attachment => async (): Promise<OutgoingQuoteAttachmentType> => {
        const { thumbnail } = attachment;
        if (!thumbnail) {
          return {
            contentType: attachment.contentType,
          };
        }

        const uploaded = await uploadAttachment(thumbnail);

        return {
          contentType: attachment.contentType,
          fileName: attachment.fileName,
          thumbnail: uploaded,
        };
      }
    )
  );

  // Update message with attachment digests
  const logId = `uploadMessageQuote(${message.idForLogging()}`;
  const oldQuote = getPropForTimestamp({
    log,
    message,
    prop: 'quote',
    targetTimestamp,
  });
  strictAssert(oldQuote, `${logId}: Quote is gone after upload`);

  const newQuote = {
    ...oldQuote,
    attachments: oldQuote.attachments.map((attachment, index) => {
      if (!attachment.thumbnail) {
        return attachment;
      }

      strictAssert(
        attachment.path === loadedQuote.attachments.at(index)?.path,
        `${logId}: Quote attachment ${index} was updated from under us`
      );

      strictAssert(
        attachment.thumbnail,
        `${logId}: Quote attachment ${index} no longer has a thumbnail`
      );

      const attachmentAfterThumbnailUpload =
        attachmentsAfterThumbnailUpload[index];
      return {
        ...attachment,
        thumbnail: {
          ...attachment.thumbnail,
          ...copyCdnFields(attachmentAfterThumbnailUpload.thumbnail),
        },
      };
    }),
  };
  setPropForTimestamp({
    log,
    message,
    prop: 'quote',
    targetTimestamp,
    value: newQuote,
  });

  return {
    isGiftBadge: loadedQuote.isGiftBadge,
    id: loadedQuote.id,
    authorAci: loadedQuote.authorAci
      ? normalizeAci(loadedQuote.authorAci, 'sendNormalMessage.quote.authorAci')
      : undefined,
    text: loadedQuote.text,
    bodyRanges: loadedQuote.bodyRanges,
    attachments: attachmentsAfterThumbnailUpload,
  };
}

async function uploadMessagePreviews({
  log,
  message,
  targetTimestamp,
  uploadQueue,
}: {
  log: LoggerType;
  message: MessageModel;
  targetTimestamp: number;
  uploadQueue: PQueue;
}): Promise<Array<OutgoingLinkPreviewType> | undefined> {
  const { loadPreviewData } = window.Signal.Migrations;

  // See uploadMessageQuote for comment on how we do caching for these
  // attachments.
  const startingPreview = getPropForTimestamp({
    log,
    message,
    prop: 'preview',
    targetTimestamp,
  });

  const loadedPreviews =
    message.cachedOutgoingPreviewData ||
    (await loadPreviewData(startingPreview));

  if (!loadedPreviews) {
    return undefined;
  }
  if (loadedPreviews.length === 0) {
    return [];
  }

  const uploadedPreviews = await uploadQueue.addAll(
    loadedPreviews.map(
      preview => async (): Promise<OutgoingLinkPreviewType> => {
        if (!preview.image) {
          return {
            ...preview,

            // Pacify typescript
            image: undefined,
          };
        }

        return {
          ...preview,
          image: await uploadAttachment(preview.image),
        };
      }
    )
  );

  // Update message with attachment digests
  const logId = `uploadMessagePreviews(${message.idForLogging()}`;
  const oldPreview = getPropForTimestamp({
    log,
    message,
    prop: 'preview',
    targetTimestamp,
  });
  strictAssert(oldPreview, `${logId}: Link preview is gone after upload`);

  const newPreview = oldPreview.map((preview, index) => {
    strictAssert(
      preview.image?.path === loadedPreviews.at(index)?.image?.path,
      `${logId}: Preview attachment ${index} was updated from under us`
    );

    const uploaded = uploadedPreviews.at(index);
    if (!preview.image || !uploaded?.image) {
      return preview;
    }

    return {
      ...preview,
      image: {
        ...preview.image,
        ...copyCdnFields(uploaded.image),
      },
    };
  });

  setPropForTimestamp({
    log,
    message,
    prop: 'preview',
    targetTimestamp,
    value: newPreview,
  });

  return uploadedPreviews;
}

async function uploadMessageSticker(
  message: MessageModel,
  uploadQueue: PQueue
): Promise<OutgoingStickerType | undefined> {
  const { loadStickerData } = window.Signal.Migrations;

  // See uploadMessageQuote for comment on how we do caching for these
  // attachments.
  const startingSticker = message.get('sticker');
  const stickerWithData =
    message.cachedOutgoingStickerData ||
    (await loadStickerData(startingSticker));

  if (!stickerWithData) {
    return undefined;
  }

  const uploaded = await uploadQueue.add(() =>
    uploadAttachment(stickerWithData.data)
  );

  // Add digest to the attachment
  const logId = `uploadMessageSticker(${message.idForLogging()}`;
  const existingSticker = message.get('sticker');
  strictAssert(
    existingSticker?.data !== undefined,
    `${logId}: Sticker was uploaded, but message doesn't ` +
      'have a sticker anymore'
  );
  strictAssert(
    existingSticker.data.path === startingSticker?.data?.path,
    `${logId}: Sticker was uploaded, but message has a different sticker`
  );
  message.set('sticker', {
    ...existingSticker,
    data: {
      ...existingSticker.data,
      ...copyCdnFields(uploaded),
    },
  });

  return {
    ...stickerWithData,
    data: uploaded,
  };
}

async function uploadMessageContacts(
  message: MessageModel,
  uploadQueue: PQueue
): Promise<Array<EmbeddedContactWithUploadedAvatar> | undefined> {
  const { loadContactData } = window.Signal.Migrations;

  // See uploadMessageQuote for comment on how we do caching for these
  // attachments.
  const contacts =
    message.cachedOutgoingContactData ||
    (await loadContactData(message.get('contact')));

  if (!contacts) {
    return undefined;
  }
  if (contacts.length === 0) {
    return [];
  }

  const uploadedContacts = await uploadQueue.addAll(
    contacts.map(
      contact => async (): Promise<EmbeddedContactWithUploadedAvatar> => {
        const avatar = contact.avatar?.avatar;
        // Pacify typescript
        if (contact.avatar === undefined || !avatar) {
          return {
            ...contact,
            avatar: undefined,
          };
        }

        const uploaded = await uploadAttachment(avatar);

        return {
          ...contact,
          avatar: {
            ...contact.avatar,
            avatar: uploaded,
          },
        };
      }
    )
  );

  // Add digest to the attachment
  const logId = `uploadMessageContacts(${message.idForLogging()}`;
  const oldContact = message.get('contact');
  strictAssert(oldContact, `${logId}: Contacts are gone after upload`);

  const newContact = oldContact.map((contact, index) => {
    const loaded: EmbeddedContactWithHydratedAvatar | undefined =
      contacts.at(index);
    if (!contact.avatar) {
      strictAssert(
        loaded?.avatar === undefined,
        `${logId}: Avatar erased in the message`
      );
      return contact;
    }

    strictAssert(
      loaded !== undefined &&
        loaded.avatar !== undefined &&
        loaded.avatar.avatar.path === contact.avatar.avatar.path,
      `${logId}: Avatar has incorrect path`
    );
    const uploaded = uploadedContacts.at(index);
    strictAssert(
      uploaded !== undefined && uploaded.avatar !== undefined,
      `${logId}: Avatar wasn't uploaded properly`
    );

    return {
      ...contact,
      avatar: {
        ...contact.avatar,
        avatar: {
          ...contact.avatar.avatar,
          ...copyCdnFields(uploaded.avatar.avatar),
        },
      },
    };
  });
  message.set('contact', newContact);

  return uploadedContacts;
}

async function markMessageFailed({
  errors,
  message,
  targetTimestamp,
}: {
  errors: Array<Error>;
  message: MessageModel;
  targetTimestamp: number;
}): Promise<void> {
  message.markFailed(targetTimestamp);
  void message.saveErrors(errors, { skipSave: true });
  await window.Signal.Data.saveMessage(message.attributes, {
    ourAci: window.textsecure.storage.user.getCheckedAci(),
  });
}

function didSendToEveryone({
  log,
  message,
  targetTimestamp,
}: {
  log: LoggerType;
  message: MessageModel;
  targetTimestamp: number;
}): boolean {
  const sendStateByConversationId =
    getPropForTimestamp({
      log,
      message,
      prop: 'sendStateByConversationId',
      targetTimestamp,
    }) || {};
  return Object.values(sendStateByConversationId).every(sendState =>
    isSent(sendState.status)
  );
}
