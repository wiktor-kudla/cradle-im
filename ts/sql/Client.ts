// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcRenderer as ipc } from 'electron';
import PQueue from 'p-queue';
import { batch } from 'react-redux';

import { has, get, groupBy, isTypedArray, last, map, omit } from 'lodash';

import { deleteExternalFiles } from '../types/Conversation';
import { expiringMessagesDeletionService } from '../services/expiringMessagesDeletion';
import { tapToViewMessagesDeletionService } from '../services/tapToViewMessagesDeletionService';
import * as Bytes from '../Bytes';
import { createBatcher } from '../util/batcher';
import { assertDev, softAssert } from '../util/assert';
import { mapObjectWithSpec } from '../util/mapObjectWithSpec';
import type { ObjectMappingSpecType } from '../util/mapObjectWithSpec';
import { cleanDataForIpc } from './cleanDataForIpc';
import type { AciString, ServiceIdString } from '../types/ServiceId';
import createTaskWithTimeout from '../textsecure/TaskWithTimeout';
import * as log from '../logging/log';
import { isValidUuid } from '../util/isValidUuid';
import * as Errors from '../types/errors';

import type { StoredJob } from '../jobs/types';
import { formatJobForInsert } from '../jobs/formatJobForInsert';
import {
  cleanupMessage,
  cleanupMessageFromMemory,
  deleteMessageData,
} from '../util/cleanup';
import { drop } from '../util/drop';
import { ipcInvoke, doShutdown } from './channels';

import type {
  AdjacentMessagesByConversationOptionsType,
  AllItemsType,
  AttachmentDownloadJobType,
  ClientInterface,
  ClientExclusiveInterface,
  ClientSearchResultMessageType,
  ConversationType,
  GetConversationRangeCenteredOnMessageResultType,
  GetRecentStoryRepliesOptionsType,
  IdentityKeyIdType,
  IdentityKeyType,
  StoredIdentityKeyType,
  ItemKeyType,
  ItemType,
  StoredItemType,
  MessageType,
  MessageTypeUnhydrated,
  PreKeyIdType,
  PreKeyType,
  StoredPreKeyType,
  ServerInterface,
  ServerSearchResultMessageType,
  SignedPreKeyIdType,
  SignedPreKeyType,
  StoredSignedPreKeyType,
  KyberPreKeyType,
  StoredKyberPreKeyType,
} from './Interface';
import { MINUTE } from '../util/durations';
import { getMessageIdForLogging } from '../util/idForLogging';
import type { MessageAttributesType } from '../model-types';
import { incrementMessageCounter } from '../util/incrementMessageCounter';
import { generateSnippetAroundMention } from '../util/search';

const ERASE_SQL_KEY = 'erase-sql-key';
const ERASE_ATTACHMENTS_KEY = 'erase-attachments';
const ERASE_STICKERS_KEY = 'erase-stickers';
const ERASE_TEMP_KEY = 'erase-temp';
const ERASE_DRAFTS_KEY = 'erase-drafts';
const CLEANUP_ORPHANED_ATTACHMENTS_KEY = 'cleanup-orphaned-attachments';
const ENSURE_FILE_PERMISSIONS = 'ensure-file-permissions';

const exclusiveInterface: ClientExclusiveInterface = {
  createOrUpdateIdentityKey,
  getIdentityKeyById,
  bulkAddIdentityKeys,
  getAllIdentityKeys,

  createOrUpdateKyberPreKey,
  getKyberPreKeyById,
  bulkAddKyberPreKeys,
  getAllKyberPreKeys,

  createOrUpdatePreKey,
  getPreKeyById,
  bulkAddPreKeys,
  getAllPreKeys,

  createOrUpdateSignedPreKey,
  getSignedPreKeyById,
  bulkAddSignedPreKeys,
  getAllSignedPreKeys,

  createOrUpdateItem,
  getItemById,
  getAllItems,

  updateConversation,
  removeConversation,

  searchMessages,

  getRecentStoryReplies,
  getOlderMessagesByConversation,
  getConversationRangeCenteredOnMessage,
  getNewerMessagesByConversation,

  // Client-side only

  flushUpdateConversationBatcher,

  shutdown,
  removeAllMessagesInConversation,

  removeOtherData,
  cleanupOrphanedAttachments,
  ensureFilePermissions,
};

type ClientOverridesType = ClientExclusiveInterface &
  Pick<
    ServerInterface,
    | 'removeMessage'
    | 'removeMessages'
    | 'saveAttachmentDownloadJob'
    | 'saveMessage'
    | 'saveMessages'
    | 'updateConversations'
  >;

const channels: ServerInterface = new Proxy({} as ServerInterface, {
  get(_target, name) {
    return async (...args: ReadonlyArray<unknown>) =>
      ipcInvoke(String(name), args);
  },
});

const clientExclusiveOverrides: ClientOverridesType = {
  ...exclusiveInterface,
  removeMessage,
  removeMessages,
  saveAttachmentDownloadJob,
  saveMessage,
  saveMessages,
  updateConversations,
};

const dataInterface: ClientInterface = new Proxy(
  {
    ...clientExclusiveOverrides,
  } as ClientInterface,
  {
    get(target, name) {
      return async (...args: ReadonlyArray<unknown>) => {
        if (has(target, name)) {
          return get(target, name)(...args);
        }

        return get(channels, name)(...args);
      };
    },
  }
);

export default dataInterface;

function _cleanData(
  data: unknown
): ReturnType<typeof cleanDataForIpc>['cleaned'] {
  const { cleaned, pathsChanged } = cleanDataForIpc(data);

  if (pathsChanged.length) {
    log.info(
      `_cleanData cleaned the following paths: ${pathsChanged.join(', ')}`
    );
  }

  return cleaned;
}

export function _cleanMessageData(data: MessageType): MessageType {
  const result = { ...data };
  // Ensure that all messages have the received_at set properly
  if (!data.received_at) {
    assertDev(false, 'received_at was not set on the message');
    result.received_at = incrementMessageCounter();
  }
  if (data.attachments) {
    const logId = getMessageIdForLogging(data);
    result.attachments = data.attachments.map((attachment, index) => {
      if (attachment.data && !isTypedArray(attachment.data)) {
        log.warn(
          `_cleanMessageData/${logId}: Attachment ${index} had non-array \`data\` field; deleting.`
        );
        return omit(attachment, ['data']);
      }

      if (attachment.screenshotData) {
        assertDev(
          false,
          `_cleanMessageData/${logId}: Attachment ${index} had screenshotData field; deleting`
        );
        return omit(attachment, ['screenshotData']);
      }

      if (attachment.screenshot?.data) {
        assertDev(
          false,
          `_cleanMessageData/${logId}: Attachment ${index} had screenshot.data field; deleting`
        );
        return omit(attachment, ['screenshot.data']);
      }

      if (attachment.thumbnail?.data) {
        assertDev(
          false,
          `_cleanMessageData/${logId}: Attachment ${index} had thumbnail.data field; deleting`
        );
        return omit(attachment, ['thumbnail.data']);
      }

      return attachment;
    });
  }
  return _cleanData(omit(result, ['dataMessage']));
}

function specToBytes<Input, Output>(
  spec: ObjectMappingSpecType,
  data: Input
): Output {
  return mapObjectWithSpec<string, Uint8Array>(spec, data, x =>
    Bytes.fromBase64(x)
  );
}

function specFromBytes<Input, Output>(
  spec: ObjectMappingSpecType,
  data: Input
): Output {
  return mapObjectWithSpec<Uint8Array, string>(spec, data, x =>
    Bytes.toBase64(x)
  );
}

// Top-level calls

async function shutdown(): Promise<void> {
  log.info('Client.shutdown');

  // Stop accepting new SQL jobs, flush outstanding queue
  await doShutdown();

  // Close database
  await channels.close();
}

// Identity Keys

const IDENTITY_KEY_SPEC = ['publicKey'];
async function createOrUpdateIdentityKey(data: IdentityKeyType): Promise<void> {
  const updated: StoredIdentityKeyType = specFromBytes(IDENTITY_KEY_SPEC, data);
  await channels.createOrUpdateIdentityKey(updated);
}
async function getIdentityKeyById(
  id: IdentityKeyIdType
): Promise<IdentityKeyType | undefined> {
  const data = await channels.getIdentityKeyById(id);

  return specToBytes(IDENTITY_KEY_SPEC, data);
}
async function bulkAddIdentityKeys(
  array: Array<IdentityKeyType>
): Promise<void> {
  const updated: Array<StoredIdentityKeyType> = map(array, data =>
    specFromBytes(IDENTITY_KEY_SPEC, data)
  );
  await channels.bulkAddIdentityKeys(updated);
}
async function getAllIdentityKeys(): Promise<Array<IdentityKeyType>> {
  const keys = await channels.getAllIdentityKeys();

  return keys.map(key => specToBytes(IDENTITY_KEY_SPEC, key));
}

// Kyber Pre Keys

const KYBER_PRE_KEY_SPEC = ['data'];
async function createOrUpdateKyberPreKey(data: KyberPreKeyType): Promise<void> {
  const updated: StoredKyberPreKeyType = specFromBytes(
    KYBER_PRE_KEY_SPEC,
    data
  );
  await channels.createOrUpdateKyberPreKey(updated);
}
async function getKyberPreKeyById(
  id: PreKeyIdType
): Promise<KyberPreKeyType | undefined> {
  const data = await channels.getPreKeyById(id);

  return specToBytes(KYBER_PRE_KEY_SPEC, data);
}
async function bulkAddKyberPreKeys(
  array: Array<KyberPreKeyType>
): Promise<void> {
  const updated: Array<StoredKyberPreKeyType> = map(array, data =>
    specFromBytes(KYBER_PRE_KEY_SPEC, data)
  );
  await channels.bulkAddKyberPreKeys(updated);
}
async function getAllKyberPreKeys(): Promise<Array<KyberPreKeyType>> {
  const keys = await channels.getAllKyberPreKeys();

  return keys.map(key => specToBytes(KYBER_PRE_KEY_SPEC, key));
}

// Pre Keys

async function createOrUpdatePreKey(data: PreKeyType): Promise<void> {
  const updated: StoredPreKeyType = specFromBytes(PRE_KEY_SPEC, data);
  await channels.createOrUpdatePreKey(updated);
}
async function getPreKeyById(
  id: PreKeyIdType
): Promise<PreKeyType | undefined> {
  const data = await channels.getPreKeyById(id);

  return specToBytes(PRE_KEY_SPEC, data);
}
async function bulkAddPreKeys(array: Array<PreKeyType>): Promise<void> {
  const updated: Array<StoredPreKeyType> = map(array, data =>
    specFromBytes(PRE_KEY_SPEC, data)
  );
  await channels.bulkAddPreKeys(updated);
}
async function getAllPreKeys(): Promise<Array<PreKeyType>> {
  const keys = await channels.getAllPreKeys();

  return keys.map(key => specToBytes(PRE_KEY_SPEC, key));
}

// Signed Pre Keys

const PRE_KEY_SPEC = ['privateKey', 'publicKey'];
async function createOrUpdateSignedPreKey(
  data: SignedPreKeyType
): Promise<void> {
  const updated: StoredSignedPreKeyType = specFromBytes(PRE_KEY_SPEC, data);
  await channels.createOrUpdateSignedPreKey(updated);
}
async function getSignedPreKeyById(
  id: SignedPreKeyIdType
): Promise<SignedPreKeyType | undefined> {
  const data = await channels.getSignedPreKeyById(id);

  return specToBytes(PRE_KEY_SPEC, data);
}
async function getAllSignedPreKeys(): Promise<Array<SignedPreKeyType>> {
  const keys = await channels.getAllSignedPreKeys();

  return keys.map(key => specToBytes(PRE_KEY_SPEC, key));
}
async function bulkAddSignedPreKeys(
  array: Array<SignedPreKeyType>
): Promise<void> {
  const updated: Array<StoredSignedPreKeyType> = map(array, data =>
    specFromBytes(PRE_KEY_SPEC, data)
  );
  await channels.bulkAddSignedPreKeys(updated);
}

// Items

const ITEM_SPECS: Partial<Record<ItemKeyType, ObjectMappingSpecType>> = {
  identityKeyMap: {
    key: 'value',
    valueSpec: {
      isMap: true,
      valueSpec: ['privKey', 'pubKey'],
    },
  },
  profileKey: ['value'],
  senderCertificate: ['value.serialized'],
  senderCertificateNoE164: ['value.serialized'],
  subscriberId: ['value'],
  usernameLink: ['value.entropy', 'value.serverId'],
};
async function createOrUpdateItem<K extends ItemKeyType>(
  data: ItemType<K>
): Promise<void> {
  const { id } = data;
  if (!id) {
    throw new Error(
      'createOrUpdateItem: Provided data did not have a truthy id'
    );
  }

  const spec = ITEM_SPECS[id];
  const updated: StoredItemType<K> = spec
    ? specFromBytes(spec, data)
    : (data as unknown as StoredItemType<K>);

  await channels.createOrUpdateItem(updated);
}
async function getItemById<K extends ItemKeyType>(
  id: K
): Promise<ItemType<K> | undefined> {
  const spec = ITEM_SPECS[id];
  const data = await channels.getItemById(id);

  try {
    return spec ? specToBytes(spec, data) : (data as unknown as ItemType<K>);
  } catch (error) {
    log.warn(`getItemById(${id}): Failed to parse item from spec`, error);
    return undefined;
  }
}
async function getAllItems(): Promise<AllItemsType> {
  const items = await channels.getAllItems();

  const result = Object.create(null);

  for (const id of Object.keys(items)) {
    const key = id as ItemKeyType;
    const value = items[key];

    const keys = ITEM_SPECS[key];

    try {
      const deserializedValue = keys
        ? (specToBytes(keys, { value }) as ItemType<typeof key>).value
        : value;

      result[key] = deserializedValue;
    } catch (error) {
      log.warn(`getAllItems(${id}): Failed to parse item from spec`, error);
    }
  }

  return result;
}

// Conversation

const updateConversationBatcher = createBatcher<ConversationType>({
  name: 'sql.Client.updateConversationBatcher',
  wait: 500,
  maxSize: 20,
  processBatch: async (items: Array<ConversationType>) => {
    // We only care about the most recent update for each conversation
    const byId = groupBy(items, item => item.id);
    const ids = Object.keys(byId);
    const mostRecent = ids.map((id: string): ConversationType => {
      const maybeLast = last(byId[id]);
      assertDev(maybeLast !== undefined, 'Empty array in `groupBy` result');
      return maybeLast;
    });

    await updateConversations(mostRecent);
  },
});

function updateConversation(data: ConversationType): void {
  updateConversationBatcher.add(data);
}
async function flushUpdateConversationBatcher(): Promise<void> {
  await updateConversationBatcher.flushAndWait();
}

async function updateConversations(
  array: Array<ConversationType>
): Promise<void> {
  const { cleaned, pathsChanged } = cleanDataForIpc(array);
  assertDev(
    !pathsChanged.length,
    `Paths were cleaned: ${JSON.stringify(pathsChanged)}`
  );
  await channels.updateConversations(cleaned);
}

async function removeConversation(id: string): Promise<void> {
  const existing = await channels.getConversationById(id);

  // Note: It's important to have a fully database-hydrated model to delete here because
  //   it needs to delete all associated on-disk files along with the database delete.
  if (existing) {
    await channels.removeConversation(id);
    await deleteExternalFiles(existing, {
      deleteAttachmentData: window.Signal.Migrations.deleteAttachmentData,
    });
  }
}

function handleSearchMessageJSON(
  messages: Array<ServerSearchResultMessageType>
): Array<ClientSearchResultMessageType> {
  return messages.map<ClientSearchResultMessageType>(message => {
    const parsedMessage = JSON.parse(message.json);
    assertDev(
      message.ftsSnippet ?? typeof message.mentionStart === 'number',
      'Neither ftsSnippet nor matching mention returned from message search'
    );
    const snippet =
      message.ftsSnippet ??
      generateSnippetAroundMention({
        body: parsedMessage.body,
        mentionStart: message.mentionStart ?? 0,
        mentionLength: message.mentionLength ?? 1,
      });

    return {
      json: message.json,

      // Empty array is a default value. `message.json` has the real field
      bodyRanges: [],
      ...parsedMessage,
      snippet,
    };
  });
}

async function searchMessages({
  query,
  options,
  contactServiceIdsMatchingQuery,
  conversationId,
}: {
  query: string;
  options?: { limit?: number };
  contactServiceIdsMatchingQuery?: Array<ServiceIdString>;
  conversationId?: string;
}): Promise<Array<ClientSearchResultMessageType>> {
  const messages = await channels.searchMessages({
    query,
    conversationId,
    options,
    contactServiceIdsMatchingQuery,
  });

  return handleSearchMessageJSON(messages);
}

// Message

async function saveMessage(
  data: MessageType,
  options: {
    jobToInsert?: Readonly<StoredJob>;
    forceSave?: boolean;
    ourAci: AciString;
  }
): Promise<string> {
  const id = await channels.saveMessage(_cleanMessageData(data), {
    ...options,
    jobToInsert: options.jobToInsert && formatJobForInsert(options.jobToInsert),
  });

  softAssert(isValidUuid(id), 'saveMessage: messageId is not a UUID');

  void expiringMessagesDeletionService.update();
  void tapToViewMessagesDeletionService.update();

  return id;
}

async function saveMessages(
  arrayOfMessages: ReadonlyArray<MessageType>,
  options: { forceSave?: boolean; ourAci: AciString }
): Promise<void> {
  await channels.saveMessages(
    arrayOfMessages.map(message => _cleanMessageData(message)),
    options
  );

  void expiringMessagesDeletionService.update();
  void tapToViewMessagesDeletionService.update();
}

async function removeMessage(id: string): Promise<void> {
  const message = await channels.getMessageById(id);

  // Note: It's important to have a fully database-hydrated model to delete here because
  //   it needs to delete all associated on-disk files along with the database delete.
  if (message) {
    await channels.removeMessage(id);
    await cleanupMessage(message);
  }
}

async function _cleanupMessages(
  messages: ReadonlyArray<MessageAttributesType>
): Promise<void> {
  // First, remove messages from memory, so we can batch the updates in redux
  batch(() => {
    messages.forEach(message => cleanupMessageFromMemory(message));
  });

  // Then, handle any asynchronous actions (e.g. deleting data from disk)
  const queue = new PQueue({ concurrency: 3, timeout: MINUTE * 30 });
  drop(
    queue.addAll(
      messages.map(
        (message: MessageAttributesType) => async () =>
          deleteMessageData(message)
      )
    )
  );
  await queue.onIdle();
}

async function removeMessages(
  messageIds: ReadonlyArray<string>
): Promise<void> {
  const messages = await channels.getMessagesById(messageIds);
  await _cleanupMessages(messages);
  await channels.removeMessages(messageIds);
}

function handleMessageJSON(
  messages: Array<MessageTypeUnhydrated>
): Array<MessageType> {
  return messages.map(message => JSON.parse(message.json));
}

async function getNewerMessagesByConversation(
  options: AdjacentMessagesByConversationOptionsType
): Promise<Array<MessageType>> {
  const messages = await channels.getNewerMessagesByConversation(options);

  return handleMessageJSON(messages);
}

async function getRecentStoryReplies(
  storyId: string,
  options?: GetRecentStoryRepliesOptionsType
): Promise<Array<MessageType>> {
  const messages = await channels.getRecentStoryReplies(storyId, options);

  return handleMessageJSON(messages);
}

async function getOlderMessagesByConversation(
  options: AdjacentMessagesByConversationOptionsType
): Promise<Array<MessageType>> {
  const messages = await channels.getOlderMessagesByConversation(options);

  return handleMessageJSON(messages);
}

async function getConversationRangeCenteredOnMessage(
  options: AdjacentMessagesByConversationOptionsType
): Promise<GetConversationRangeCenteredOnMessageResultType<MessageType>> {
  const result = await channels.getConversationRangeCenteredOnMessage(options);

  return {
    ...result,
    older: handleMessageJSON(result.older),
    newer: handleMessageJSON(result.newer),
  };
}

async function removeAllMessagesInConversation(
  conversationId: string,
  {
    logId,
  }: {
    logId: string;
  }
): Promise<void> {
  let messages;
  do {
    const chunkSize = 20;
    log.info(
      `removeAllMessagesInConversation/${logId}: Fetching chunk of ${chunkSize} messages`
    );
    // Yes, we really want the await in the loop. We're deleting a chunk at a
    //   time so we don't use too much memory.
    // eslint-disable-next-line no-await-in-loop
    messages = await getOlderMessagesByConversation({
      conversationId,
      limit: chunkSize,
      includeStoryReplies: true,
      storyId: undefined,
    });

    if (!messages.length) {
      return;
    }

    const ids = messages.map(message => message.id);

    log.info(`removeAllMessagesInConversation/${logId}: Cleanup...`);
    // eslint-disable-next-line no-await-in-loop
    await _cleanupMessages(messages);

    log.info(`removeAllMessagesInConversation/${logId}: Deleting...`);
    // eslint-disable-next-line no-await-in-loop
    await channels.removeMessages(ids);
  } while (messages.length > 0);
}

// Attachment downloads

async function saveAttachmentDownloadJob(
  job: AttachmentDownloadJobType
): Promise<void> {
  await channels.saveAttachmentDownloadJob(_cleanData(job));
}

// Other

async function cleanupOrphanedAttachments(): Promise<void> {
  try {
    await invokeWithTimeout(CLEANUP_ORPHANED_ATTACHMENTS_KEY);
  } catch (error) {
    log.warn(
      'sql/Client: cleanupOrphanedAttachments failure',
      Errors.toLogFormat(error)
    );
  }
}

async function ensureFilePermissions(): Promise<void> {
  await invokeWithTimeout(ENSURE_FILE_PERMISSIONS);
}

// Note: will need to restart the app after calling this, to set up afresh
async function removeOtherData(): Promise<void> {
  await Promise.all([
    invokeWithTimeout(ERASE_SQL_KEY),
    invokeWithTimeout(ERASE_ATTACHMENTS_KEY),
    invokeWithTimeout(ERASE_STICKERS_KEY),
    invokeWithTimeout(ERASE_TEMP_KEY),
    invokeWithTimeout(ERASE_DRAFTS_KEY),
  ]);
}

async function invokeWithTimeout(name: string): Promise<void> {
  return createTaskWithTimeout(
    () => ipc.invoke(name),
    `callChannel call to ${name}`
  )();
}
