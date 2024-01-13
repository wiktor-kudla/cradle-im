// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { MessageAttributesType } from '../model-types.d';

export function getSenderIdentifier({
  sent_at: sentAt,
  source,
  sourceServiceId,
  sourceDevice,
}: Pick<
  MessageAttributesType,
  'sent_at' | 'source' | 'sourceServiceId' | 'sourceDevice'
>): string {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const conversation = window.ConversationController.lookupOrCreate({
    e164: source,
    serviceId: sourceServiceId,
    reason: 'MessageModel.getSenderIdentifier',
  })!;

  return `${conversation?.id}.${sourceDevice}-${sentAt}`;
}
