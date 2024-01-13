// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as log from '../logging/log';
import type { MessageAttributesType } from '../model-types.d';
import * as Errors from '../types/errors';
import type { MessageModel } from '../models/messages';

export async function __DEPRECATED$getMessageById(
  messageId: string
): Promise<MessageModel | undefined> {
  const message = window.MessageCache.__DEPRECATED$getById(messageId);
  if (message) {
    return message;
  }

  let found: MessageAttributesType | undefined;
  try {
    found = await window.Signal.Data.getMessageById(messageId);
  } catch (err: unknown) {
    log.error(
      `failed to load message with id ${messageId} ` +
        `due to error ${Errors.toLogFormat(err)}`
    );
  }

  if (!found) {
    return undefined;
  }

  return window.MessageCache.__DEPRECATED$register(
    found.id,
    found,
    '__DEPRECATED$getMessageById'
  );
}
