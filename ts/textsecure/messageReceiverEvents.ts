// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable max-classes-per-file */

import type { PublicKey } from '@signalapp/libsignal-client';

import type { SignalService as Proto } from '../protobuf';
import type { ServiceIdString, AciString } from '../types/ServiceId';
import type { StoryDistributionIdString } from '../types/StoryDistributionId';
import type {
  ProcessedEnvelope,
  ProcessedDataMessage,
  ProcessedSent,
} from './Types.d';
import type { ContactDetailsWithAvatar } from './ContactsParser';
import type { CallEventDetails, CallLogEvent } from '../types/CallDisposition';

export class EmptyEvent extends Event {
  constructor() {
    super('empty');
  }
}

export class ProgressEvent extends Event {
  public readonly count: number;

  constructor({ count }: { count: number }) {
    super('progress');

    this.count = count;
  }
}

export type TypingEventData = Readonly<{
  typingMessage: Proto.ITypingMessage;
  timestamp: number;
  started: boolean;
  stopped: boolean;
  groupId?: string;
  groupV2Id?: string;
}>;

export type TypingEventConfig = {
  sender?: string;
  senderAci?: AciString;
  senderDevice: number;
  typing: TypingEventData;
};

export class TypingEvent extends Event {
  public readonly sender?: string;

  public readonly senderAci?: AciString;

  public readonly senderDevice: number;

  public readonly typing: TypingEventData;

  constructor({ sender, senderAci, senderDevice, typing }: TypingEventConfig) {
    super('typing');

    this.sender = sender;
    this.senderAci = senderAci;
    this.senderDevice = senderDevice;
    this.typing = typing;
  }
}

export class ErrorEvent extends Event {
  constructor(public readonly error: Error) {
    super('error');
  }
}

export class ContactSyncEvent extends Event {
  constructor(
    public readonly contacts: ReadonlyArray<ContactDetailsWithAvatar>,
    public readonly complete: boolean,
    public readonly receivedAtCounter: number,
    public readonly sentAt: number
  ) {
    super('contactSync');
  }
}

// Emitted right before we do full decrypt on a message, but after Sealed Sender unseal
export class EnvelopeUnsealedEvent extends Event {
  constructor(public readonly envelope: ProcessedEnvelope) {
    super('envelopeUnsealed');
  }
}

// Emitted when we queue previously-decrypted events from the cache
export class EnvelopeQueuedEvent extends Event {
  constructor(public readonly envelope: ProcessedEnvelope) {
    super('envelopeQueued');
  }
}

//
// Confirmable events below
//

export type ConfirmCallback = () => void;

export class ConfirmableEvent extends Event {
  constructor(type: string, public readonly confirm: ConfirmCallback) {
    super(type);
  }
}

export type DeliveryEventData = Readonly<{
  envelopeId: string;
  timestamp: number;
  envelopeTimestamp: number;
  source?: string;
  sourceServiceId?: ServiceIdString;
  sourceDevice?: number;
  wasSentEncrypted: boolean;
}>;

export class DeliveryEvent extends ConfirmableEvent {
  constructor(
    public readonly deliveryReceipt: DeliveryEventData,
    confirm: ConfirmCallback
  ) {
    super('delivery', confirm);
  }
}

export type DecryptionErrorEventData = Readonly<{
  cipherTextBytes?: Uint8Array;
  cipherTextType?: number;
  contentHint?: number;
  groupId?: string;
  receivedAtCounter: number;
  receivedAtDate: number;
  senderDevice: number;
  senderAci: AciString;
  timestamp: number;
}>;

export class DecryptionErrorEvent extends ConfirmableEvent {
  constructor(
    public readonly decryptionError: DecryptionErrorEventData,
    confirm: ConfirmCallback
  ) {
    super('decryption-error', confirm);
  }
}

export type InvalidPlaintextEventData = Readonly<{
  senderDevice: number;
  senderAci: AciString;
  timestamp: number;
}>;

export class InvalidPlaintextEvent extends Event {
  constructor(public readonly data: InvalidPlaintextEventData) {
    super('invalid-plaintext');
  }
}

export type RetryRequestEventData = Readonly<{
  groupId?: string;
  ratchetKey?: PublicKey;
  requesterAci: AciString;
  requesterDevice: number;
  senderDevice: number;
  sentAt: number;
}>;

export class RetryRequestEvent extends ConfirmableEvent {
  constructor(
    public readonly retryRequest: RetryRequestEventData,
    confirm: ConfirmCallback
  ) {
    super('retry-request', confirm);
  }
}

export type SentEventData = Readonly<{
  envelopeId: string;
  destination?: string;
  destinationServiceId?: ServiceIdString;
  timestamp?: number;
  serverTimestamp?: number;
  device: number | undefined;
  unidentifiedStatus: ProcessedSent['unidentifiedStatus'];
  message: ProcessedDataMessage;
  isRecipientUpdate: boolean;
  receivedAtCounter: number;
  receivedAtDate: number;
  expirationStartTimestamp?: number;
  storyDistributionListId?: StoryDistributionIdString;
}>;

export class SentEvent extends ConfirmableEvent {
  constructor(public readonly data: SentEventData, confirm: ConfirmCallback) {
    super('sent', confirm);
  }
}

export type ProfileKeyUpdateData = Readonly<{
  source?: string;
  sourceAci?: AciString;
  profileKey: string;
}>;

export class ProfileKeyUpdateEvent extends ConfirmableEvent {
  constructor(
    public readonly data: ProfileKeyUpdateData,
    confirm: ConfirmCallback
  ) {
    super('profileKeyUpdate', confirm);
  }
}

export type MessageEventData = Readonly<{
  envelopeId: string;
  source?: string;
  sourceAci: AciString;
  sourceDevice?: number;
  destinationServiceId: ServiceIdString;
  timestamp: number;
  serverGuid?: string;
  serverTimestamp?: number;
  unidentifiedDeliveryReceived: boolean;
  message: ProcessedDataMessage;
  receivedAtCounter: number;
  receivedAtDate: number;
}>;

export class MessageEvent extends ConfirmableEvent {
  constructor(
    public readonly data: MessageEventData,
    confirm: ConfirmCallback
  ) {
    super('message', confirm);
  }
}

export type ReadOrViewEventData = Readonly<{
  envelopeId: string;
  timestamp: number;
  envelopeTimestamp: number;
  source?: string;
  sourceServiceId?: ServiceIdString;
  sourceDevice?: number;
  wasSentEncrypted: true;
}>;

export class ReadEvent extends ConfirmableEvent {
  constructor(
    public readonly receipt: ReadOrViewEventData,
    confirm: ConfirmCallback
  ) {
    super('read', confirm);
  }
}

export class ViewEvent extends ConfirmableEvent {
  constructor(
    public readonly receipt: ReadOrViewEventData,
    confirm: ConfirmCallback
  ) {
    super('view', confirm);
  }
}

export class ConfigurationEvent extends ConfirmableEvent {
  constructor(
    public readonly configuration: Proto.SyncMessage.IConfiguration,
    confirm: ConfirmCallback
  ) {
    super('configuration', confirm);
  }
}

export type ViewOnceOpenSyncOptions = {
  source?: string;
  sourceAci?: AciString;
  timestamp?: number;
};

export class ViewOnceOpenSyncEvent extends ConfirmableEvent {
  public readonly source?: string;

  public readonly sourceAci?: AciString;

  public readonly timestamp?: number;

  constructor(
    { source, sourceAci, timestamp }: ViewOnceOpenSyncOptions,
    confirm: ConfirmCallback
  ) {
    super('viewOnceOpenSync', confirm);

    this.source = source;
    this.sourceAci = sourceAci;
    this.timestamp = timestamp;
  }
}

export type MessageRequestResponseOptions = {
  envelopeId: string;
  threadE164?: string;
  threadAci?: AciString;
  messageRequestResponseType: Proto.SyncMessage.IMessageRequestResponse['type'];
  groupId?: string;
  groupV2Id?: string;
};

export class MessageRequestResponseEvent extends ConfirmableEvent {
  public readonly threadE164?: string;

  public readonly threadAci?: AciString;

  public readonly messageRequestResponseType?: MessageRequestResponseOptions['messageRequestResponseType'];

  public readonly groupId?: string;

  public readonly groupV2Id?: string;

  public readonly envelopeId?: string;

  constructor(
    {
      envelopeId,
      threadE164,
      threadAci,
      messageRequestResponseType,
      groupId,
      groupV2Id,
    }: MessageRequestResponseOptions,
    confirm: ConfirmCallback
  ) {
    super('messageRequestResponse', confirm);

    this.envelopeId = envelopeId;
    this.threadE164 = threadE164;
    this.threadAci = threadAci;
    this.messageRequestResponseType = messageRequestResponseType;
    this.groupId = groupId;
    this.groupV2Id = groupV2Id;
  }
}

export class FetchLatestEvent extends ConfirmableEvent {
  constructor(
    public readonly eventType: Proto.SyncMessage.IFetchLatest['type'],
    confirm: ConfirmCallback
  ) {
    super('fetchLatest', confirm);
  }
}

export type KeysEventData = Readonly<{
  storageServiceKey: Uint8Array | undefined;
  masterKey: Uint8Array | undefined;
}>;

export class KeysEvent extends ConfirmableEvent {
  public readonly storageServiceKey: Uint8Array | undefined;
  public readonly masterKey: Uint8Array | undefined;

  constructor(
    { storageServiceKey, masterKey }: KeysEventData,
    confirm: ConfirmCallback
  ) {
    super('keys', confirm);

    this.storageServiceKey = storageServiceKey;
    this.masterKey = masterKey;
  }
}

export type StickerPackEventData = Readonly<{
  id?: string;
  key?: string;
  isInstall: boolean;
  isRemove: boolean;
}>;

export class StickerPackEvent extends ConfirmableEvent {
  constructor(
    public readonly stickerPacks: ReadonlyArray<StickerPackEventData>,
    confirm: ConfirmCallback
  ) {
    super('sticker-pack', confirm);
  }
}

export type ReadSyncEventData = Readonly<{
  envelopeId: string;
  timestamp?: number;
  envelopeTimestamp: number;
  sender?: string;
  senderAci?: AciString;
}>;

export class ReadSyncEvent extends ConfirmableEvent {
  constructor(
    public readonly read: ReadSyncEventData,
    confirm: ConfirmCallback
  ) {
    super('readSync', confirm);
  }
}

export type ViewSyncEventData = Readonly<{
  envelopeId: string;
  timestamp?: number;
  envelopeTimestamp: number;
  senderE164?: string;
  senderAci?: AciString;
}>;

export class ViewSyncEvent extends ConfirmableEvent {
  constructor(
    public readonly view: ViewSyncEventData,
    confirm: ConfirmCallback
  ) {
    super('viewSync', confirm);
  }
}

export type CallEventSyncEventData = Readonly<{
  callEventDetails: CallEventDetails;
  receivedAtCounter: number;
}>;

export class CallEventSyncEvent extends ConfirmableEvent {
  constructor(
    public readonly callEvent: CallEventSyncEventData,
    confirm: ConfirmCallback
  ) {
    super('callEventSync', confirm);
  }
}

export type CallLogEventSyncEventData = Readonly<{
  event: CallLogEvent;
  timestamp: number;
  receivedAtCounter: number;
}>;

export class CallLogEventSyncEvent extends ConfirmableEvent {
  constructor(
    public readonly callLogEvent: CallLogEventSyncEventData,
    confirm: ConfirmCallback
  ) {
    super('callLogEventSync', confirm);
  }
}

export type StoryRecipientUpdateData = Readonly<{
  destinationServiceId: ServiceIdString;
  storyMessageRecipients: Array<Proto.SyncMessage.Sent.IStoryMessageRecipient>;
  timestamp: number;
}>;

export class StoryRecipientUpdateEvent extends ConfirmableEvent {
  constructor(
    public readonly data: StoryRecipientUpdateData,
    confirm: ConfirmCallback
  ) {
    super('storyRecipientUpdate', confirm);
  }
}
