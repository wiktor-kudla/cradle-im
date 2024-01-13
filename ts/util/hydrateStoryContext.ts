// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import omit from 'lodash/omit';
import type { AttachmentType } from '../types/Attachment';
import type { MessageAttributesType } from '../model-types.d';
import { getAttachmentsForMessage } from '../state/selectors/message';
import { isAciString } from './isAciString';
import { isDirectConversation } from './whatTypeOfConversation';
import { softAssert, strictAssert } from './assert';

export async function hydrateStoryContext(
  messageId: string,
  storyMessageParam?: MessageAttributesType,
  {
    shouldSave,
  }: {
    shouldSave?: boolean;
  } = {}
): Promise<void> {
  let messageAttributes: MessageAttributesType;
  try {
    messageAttributes = await window.MessageCache.resolveAttributes(
      'hydrateStoryContext',
      messageId
    );
  } catch {
    return;
  }

  const { storyId } = messageAttributes;
  if (!storyId) {
    return;
  }

  const { storyReplyContext: context } = messageAttributes;
  // We'll continue trying to get the attachment as long as the message still exists
  if (context && (context.attachment?.url || !context.messageId)) {
    return;
  }

  let storyMessage: MessageAttributesType | undefined;
  try {
    storyMessage =
      storyMessageParam === undefined
        ? await window.MessageCache.resolveAttributes(
            'hydrateStoryContext/story',
            storyId
          )
        : window.MessageCache.toMessageAttributes(storyMessageParam);
  } catch {
    storyMessage = undefined;
  }

  if (!storyMessage) {
    const conversation = window.ConversationController.get(
      messageAttributes.conversationId
    );
    softAssert(
      conversation && isDirectConversation(conversation.attributes),
      'hydrateStoryContext: Not a type=direct conversation'
    );
    window.MessageCache.setAttributes({
      messageId,
      messageAttributes: {
        storyReplyContext: {
          attachment: undefined,
          // This is ok to do because story replies only show in 1:1 conversations
          // so the story that was quoted should be from the same conversation.
          authorAci: conversation?.getAci(),
          // No messageId = referenced story not found
          messageId: '',
        },
      },
      skipSaveToDatabase: !shouldSave,
    });
    return;
  }

  const attachments = getAttachmentsForMessage({ ...storyMessage });
  let attachment: AttachmentType | undefined = attachments?.[0];
  if (attachment && !attachment.url && !attachment.textAttachment) {
    attachment = undefined;
  }

  const { sourceServiceId: authorAci } = storyMessage;
  strictAssert(isAciString(authorAci), 'Story message from pni');
  window.MessageCache.setAttributes({
    messageId,
    messageAttributes: {
      storyReplyContext: {
        attachment: omit(attachment, 'screenshotData'),
        authorAci,
        messageId: storyMessage.id,
      },
    },
    skipSaveToDatabase: !shouldSave,
  });
}
