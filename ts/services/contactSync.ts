// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import PQueue from 'p-queue';

import type { ContactSyncEvent } from '../textsecure/messageReceiverEvents';
import type { ContactDetailsWithAvatar } from '../textsecure/ContactsParser';
import { normalizeAci } from '../util/normalizeAci';
import * as Conversation from '../types/Conversation';
import * as Errors from '../types/errors';
import type { ValidateConversationType } from '../model-types.d';
import type { ConversationModel } from '../models/conversations';
import { validateConversation } from '../util/validateConversation';
import { isDirectConversation, isMe } from '../util/whatTypeOfConversation';
import * as log from '../logging/log';
import { dropNull } from '../util/dropNull';

// When true - we are running the very first storage and contact sync after
// linking.
let isInitialSync = false;

export function setIsInitialSync(newValue: boolean): void {
  log.info(`setIsInitialSync(${newValue})`);
  isInitialSync = newValue;
}

async function updateConversationFromContactSync(
  conversation: ConversationModel,
  details: ContactDetailsWithAvatar,
  receivedAtCounter: number,
  sentAt: number
): Promise<void> {
  const { writeNewAttachmentData, deleteAttachmentData, doesAttachmentExist } =
    window.Signal.Migrations;

  conversation.set({
    name: dropNull(details.name),
    inbox_position: dropNull(details.inboxPosition),
  });

  // Update the conversation avatar only if new avatar exists and hash differs
  const { avatar } = details;
  if (avatar && avatar.path) {
    const newAttributes = await Conversation.maybeUpdateAvatar(
      conversation.attributes,
      {
        newAvatar: avatar,
        writeNewAttachmentData,
        deleteAttachmentData,
        doesAttachmentExist,
      }
    );
    conversation.set(newAttributes);
  } else {
    const { attributes } = conversation;
    if (attributes.avatar && attributes.avatar.path) {
      await deleteAttachmentData(attributes.avatar.path);
    }
    conversation.set({ avatar: null });
  }

  // expireTimer isn't in Storage Service so we have to rely on contact sync.
  await conversation.updateExpirationTimer(details.expireTimer, {
    // Note: because it's our conversationId, this notification will be marked read. But
    //   setting this will make 'isSetByOther' check true.
    source: window.ConversationController.getOurConversationId(),
    receivedAt: receivedAtCounter,
    fromSync: true,
    isInitialSync,
    reason: `contact sync (sent=${sentAt})`,
  });

  window.Whisper.events.trigger('incrementProgress');
}

const queue = new PQueue({ concurrency: 1 });

async function doContactSync({
  contacts,
  complete: isFullSync,
  receivedAtCounter,
  sentAt,
}: ContactSyncEvent): Promise<void> {
  const logId =
    `doContactSync(sent=${sentAt}, ` +
    `receivedAt=${receivedAtCounter}, isFullSync=${isFullSync})`;
  log.info(`${logId}: got ${contacts.length} contacts`);

  const updatedConversations = new Set<ConversationModel>();

  let promises = new Array<Promise<void>>();
  for (const details of contacts) {
    const partialConversation: ValidateConversationType = {
      e164: details.number,
      serviceId: normalizeAci(details.aci, 'doContactSync'),
      type: 'private',
    };

    const validationError = validateConversation(partialConversation);
    if (validationError) {
      log.error(
        `${logId}: Invalid contact received`,
        Errors.toLogFormat(validationError)
      );
      continue;
    }

    const { conversation } = window.ConversationController.maybeMergeContacts({
      e164: details.number,
      aci: normalizeAci(details.aci, 'contactSync.aci'),
      reason: logId,
    });

    // It's important to use queueJob here because we might update the expiration timer
    //   and we don't want conflicts with incoming message processing happening on the
    //   conversation queue.
    const job = conversation.queueJob(`${logId}.set`, async () => {
      try {
        await updateConversationFromContactSync(
          conversation,
          details,
          receivedAtCounter,
          sentAt
        );

        updatedConversations.add(conversation);
      } catch (error) {
        log.error(
          'updateConversationFromContactSync error:',
          Errors.toLogFormat(error)
        );
      }
    });

    promises.push(job);
  }

  // updatedConversations are not populated until the promises are resolved
  await Promise.all(promises);
  promises = [];

  // Erase data in conversations that are not the part of contact sync only
  // if we received a full contact sync (and not a one-off contact update).
  const notUpdated = isFullSync
    ? window.ConversationController.getAll().filter(
        convo =>
          (convo.get('name') !== undefined ||
            convo.get('inbox_position') !== undefined) &&
          !updatedConversations.has(convo) &&
          isDirectConversation(convo.attributes) &&
          !isMe(convo.attributes)
      )
    : [];

  log.info(
    `${logId}: ` +
      `updated ${updatedConversations.size} ` +
      `resetting ${notUpdated.length}`
  );

  for (const conversation of notUpdated) {
    conversation.set({
      name: undefined,
      inbox_position: undefined,
    });
  }

  // Save new conversation attributes
  promises.push(
    window.Signal.Data.updateConversations(
      [...updatedConversations, ...notUpdated].map(convo => convo.attributes)
    )
  );

  await Promise.all(promises);

  await window.storage.put('synced_at', Date.now());
  window.Whisper.events.trigger('contactSync:complete');

  log.info(`${logId}: done`);
}

export async function onContactSync(ev: ContactSyncEvent): Promise<void> {
  log.info(
    `onContactSync(sent=${ev.sentAt}, receivedAt=${ev.receivedAtCounter}): queueing sync`
  );
  await queue.add(() => doContactSync(ev));
}
