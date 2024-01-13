// Copyright 2018 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { isFunction, isObject, isString, omit } from 'lodash';

import * as Contact from './EmbeddedContact';
import type { AttachmentType, AttachmentWithHydratedData } from './Attachment';
import { autoOrientJPEG } from '../util/attachments';
import {
  captureDimensionsAndScreenshot,
  hasData,
  migrateDataToFileSystem,
  removeSchemaVersion,
  replaceUnicodeOrderOverrides,
  replaceUnicodeV2,
} from './Attachment';
import * as Errors from './errors';
import * as SchemaVersion from './SchemaVersion';
import { initializeAttachmentMetadata } from './message/initializeAttachmentMetadata';

import type * as MIME from './MIME';
import type { LoggerType } from './Logging';
import type {
  EmbeddedContactType,
  EmbeddedContactWithHydratedAvatar,
} from './EmbeddedContact';

import type {
  MessageAttributesType,
  QuotedMessageType,
} from '../model-types.d';
import type {
  LinkPreviewType,
  LinkPreviewWithHydratedData,
} from './message/LinkPreviews';
import type { StickerType, StickerWithHydratedData } from './Stickers';

export { hasExpiration } from './Message';

export const GROUP = 'group';
export const PRIVATE = 'private';

export type ContextType = {
  getAbsoluteAttachmentPath: (path: string) => string;
  getAbsoluteStickerPath: (path: string) => string;
  getImageDimensions: (params: {
    objectUrl: string;
    logger: LoggerType;
  }) => Promise<{
    width: number;
    height: number;
  }>;
  getRegionCode: () => string | undefined;
  logger: LoggerType;
  makeImageThumbnail: (params: {
    size: number;
    objectUrl: string;
    contentType: MIME.MIMEType;
    logger: LoggerType;
  }) => Promise<Blob>;
  makeObjectUrl: (
    data: Uint8Array | ArrayBuffer,
    contentType: MIME.MIMEType
  ) => string;
  makeVideoScreenshot: (params: {
    objectUrl: string;
    contentType: MIME.MIMEType;
    logger: LoggerType;
  }) => Promise<Blob>;
  maxVersion?: number;
  revokeObjectUrl: (objectUrl: string) => void;
  writeNewAttachmentData: (data: Uint8Array) => Promise<string>;
  writeNewStickerData: (data: Uint8Array) => Promise<string>;
};

type WriteExistingAttachmentDataType = (
  attachment: Pick<AttachmentType, 'data' | 'path'>
) => Promise<string>;

export type ContextWithMessageType = ContextType & {
  message: MessageAttributesType;
};

// Schema version history
//
// Version 0
//   - Schema initialized
// Version 1
//   - Attachments: Auto-orient JPEG attachments using EXIF `Orientation` data.
//     N.B. The process of auto-orient for JPEGs strips (loses) all existing
//     EXIF metadata improving privacy, e.g. geolocation, camera make, etc.
// Version 2
//   - Attachments: Sanitize Unicode order override characters.
// Version 3
//   - Attachments: Write attachment data to disk and store relative path to it.
// Version 4
//   - Quotes: Write thumbnail data to disk and store relative path to it.
// Version 5 (deprecated)
//   - Attachments: Track number and kind of attachments for media gallery
//     - `hasAttachments?: 1 | 0`
//     - `hasVisualMediaAttachments?: 1 | undefined` (for media gallery ‘Media’ view)
//     - `hasFileAttachments?: 1 | undefined` (for media gallery ‘Documents’ view)
//   - IMPORTANT: Version 7 changes the classification of visual media and files.
//     Therefore version 5 is considered deprecated. For an easier implementation,
//     new files have the same classification in version 5 as in version 7.
// Version 6
//   - Contact: Write contact avatar to disk, ensure contact data is well-formed
// Version 7 (supersedes attachment classification in version 5)
//   - Attachments: Update classification for:
//     - `hasVisualMediaAttachments`: Include all images and video regardless of
//       whether Chromium can render it or not.
//     - `hasFileAttachments`: Exclude voice messages.
// Version 8
//   - Attachments: Capture video/image dimensions and thumbnails, as well as a
//       full-size screenshot for video.
// Version 9
//   - Attachments: Expand the set of unicode characters we filter out of
//     attachment filenames
// Version 10
//   - Preview: A new type of attachment can be included in a message.

const INITIAL_SCHEMA_VERSION = 0;

// Placeholder until we have stronger preconditions:
export const isValid = (_message: MessageAttributesType): boolean => true;

// Schema
export const initializeSchemaVersion = ({
  message,
  logger,
}: {
  message: MessageAttributesType;
  logger: LoggerType;
}): MessageAttributesType => {
  const isInitialized =
    SchemaVersion.isValid(message.schemaVersion) && message.schemaVersion >= 1;
  if (isInitialized) {
    return message;
  }

  const firstAttachment = message?.attachments?.[0];
  if (!firstAttachment) {
    return { ...message, schemaVersion: INITIAL_SCHEMA_VERSION };
  }

  // All attachments should have the same schema version, so we just pick
  // the first one:
  const inheritedSchemaVersion = SchemaVersion.isValid(
    firstAttachment.schemaVersion
  )
    ? firstAttachment.schemaVersion
    : INITIAL_SCHEMA_VERSION;
  const messageWithInitialSchema = {
    ...message,
    schemaVersion: inheritedSchemaVersion,
    attachments:
      message?.attachments?.map(attachment =>
        removeSchemaVersion({ attachment, logger })
      ) || [],
  };

  return messageWithInitialSchema;
};

// Middleware
// type UpgradeStep = (Message, Context) -> Promise Message

// SchemaVersion -> UpgradeStep -> UpgradeStep
export const _withSchemaVersion = ({
  schemaVersion,
  upgrade,
}: {
  schemaVersion: number;
  upgrade: (
    message: MessageAttributesType,
    context: ContextType
  ) => Promise<MessageAttributesType>;
}): ((
  message: MessageAttributesType,
  context: ContextType
) => Promise<MessageAttributesType>) => {
  if (!SchemaVersion.isValid(schemaVersion)) {
    throw new TypeError('_withSchemaVersion: schemaVersion is invalid');
  }
  if (!isFunction(upgrade)) {
    throw new TypeError('_withSchemaVersion: upgrade must be a function');
  }

  return async (message: MessageAttributesType, context: ContextType) => {
    if (!context || !isObject(context.logger)) {
      throw new TypeError(
        '_withSchemaVersion: context must have logger object'
      );
    }
    const { logger } = context;

    if (!isValid(message)) {
      logger.error(
        'Message._withSchemaVersion: Invalid input message:',
        message
      );
      return message;
    }

    const isAlreadyUpgraded = (message.schemaVersion || 0) >= schemaVersion;
    if (isAlreadyUpgraded) {
      return message;
    }

    const expectedVersion = schemaVersion - 1;
    const hasExpectedVersion = message.schemaVersion === expectedVersion;
    if (!hasExpectedVersion) {
      logger.warn(
        'WARNING: Message._withSchemaVersion: Unexpected version:',
        `Expected message to have version ${expectedVersion},`,
        `but got ${message.schemaVersion}.`
      );
      return message;
    }

    let upgradedMessage;
    try {
      upgradedMessage = await upgrade(message, context);
    } catch (error) {
      logger.error(
        `Message._withSchemaVersion: error updating message ${message.id}:`,
        Errors.toLogFormat(error)
      );
      return message;
    }

    if (!isValid(upgradedMessage)) {
      logger.error(
        'Message._withSchemaVersion: Invalid upgraded message:',
        upgradedMessage
      );
      return message;
    }

    return { ...upgradedMessage, schemaVersion };
  };
};

// Public API
//      _mapAttachments :: (Attachment -> Promise Attachment) ->
//                         (Message, Context) ->
//                         Promise Message
export type UpgradeAttachmentType = (
  attachment: AttachmentType,
  context: ContextType,
  message: MessageAttributesType
) => Promise<AttachmentType>;

export const _mapAttachments =
  (upgradeAttachment: UpgradeAttachmentType) =>
  async (
    message: MessageAttributesType,
    context: ContextType
  ): Promise<MessageAttributesType> => {
    const upgradeWithContext = (attachment: AttachmentType) =>
      upgradeAttachment(attachment, context, message);
    const attachments = await Promise.all(
      (message.attachments || []).map(upgradeWithContext)
    );
    return { ...message, attachments };
  };

// Public API
//      _mapContact :: (Contact -> Promise Contact) ->
//                     (Message, Context) ->
//                     Promise Message

export type UpgradeContactType = (
  contact: EmbeddedContactType,
  contextWithMessage: ContextWithMessageType
) => Promise<EmbeddedContactType>;
export const _mapContact =
  (upgradeContact: UpgradeContactType) =>
  async (
    message: MessageAttributesType,
    context: ContextType
  ): Promise<MessageAttributesType> => {
    const contextWithMessage = { ...context, message };
    const upgradeWithContext = (contact: EmbeddedContactType) =>
      upgradeContact(contact, contextWithMessage);
    const contact = await Promise.all(
      (message.contact || []).map(upgradeWithContext)
    );
    return { ...message, contact };
  };

//      _mapQuotedAttachments :: (QuotedAttachment -> Promise QuotedAttachment) ->
//                               (Message, Context) ->
//                               Promise Message
export const _mapQuotedAttachments =
  (upgradeAttachment: UpgradeAttachmentType) =>
  async (
    message: MessageAttributesType,
    context: ContextType
  ): Promise<MessageAttributesType> => {
    if (!message.quote) {
      return message;
    }
    if (!context || !isObject(context.logger)) {
      throw new Error('_mapQuotedAttachments: context must have logger object');
    }

    const upgradeWithContext = async (
      attachment: AttachmentType
    ): Promise<AttachmentType> => {
      const { thumbnail } = attachment;
      if (!thumbnail) {
        return attachment;
      }

      const upgradedThumbnail = await upgradeAttachment(
        thumbnail as AttachmentType,
        context,
        message
      );
      return { ...attachment, thumbnail: upgradedThumbnail };
    };

    const quotedAttachments =
      (message.quote && message.quote.attachments) || [];

    const attachments = await Promise.all(
      quotedAttachments.map(upgradeWithContext)
    );
    return { ...message, quote: { ...message.quote, attachments } };
  };

//      _mapPreviewAttachments :: (PreviewAttachment -> Promise PreviewAttachment) ->
//                               (Message, Context) ->
//                               Promise Message
export const _mapPreviewAttachments =
  (upgradeAttachment: UpgradeAttachmentType) =>
  async (
    message: MessageAttributesType,
    context: ContextType
  ): Promise<MessageAttributesType> => {
    if (!message.preview) {
      return message;
    }
    if (!context || !isObject(context.logger)) {
      throw new Error(
        '_mapPreviewAttachments: context must have logger object'
      );
    }

    const upgradeWithContext = async (preview: LinkPreviewType) => {
      const { image } = preview;
      if (!image) {
        return preview;
      }

      const upgradedImage = await upgradeAttachment(image, context, message);
      return { ...preview, image: upgradedImage };
    };

    const preview = await Promise.all(
      (message.preview || []).map(upgradeWithContext)
    );
    return { ...message, preview };
  };

const toVersion0 = async (
  message: MessageAttributesType,
  context: ContextType
) => initializeSchemaVersion({ message, logger: context.logger });
const toVersion1 = _withSchemaVersion({
  schemaVersion: 1,
  upgrade: _mapAttachments(autoOrientJPEG),
});
const toVersion2 = _withSchemaVersion({
  schemaVersion: 2,
  upgrade: _mapAttachments(replaceUnicodeOrderOverrides),
});
const toVersion3 = _withSchemaVersion({
  schemaVersion: 3,
  upgrade: _mapAttachments(migrateDataToFileSystem),
});
const toVersion4 = _withSchemaVersion({
  schemaVersion: 4,
  upgrade: _mapQuotedAttachments(migrateDataToFileSystem),
});
const toVersion5 = _withSchemaVersion({
  schemaVersion: 5,
  upgrade: initializeAttachmentMetadata,
});
const toVersion6 = _withSchemaVersion({
  schemaVersion: 6,
  upgrade: _mapContact(Contact.parseAndWriteAvatar(migrateDataToFileSystem)),
});
// IMPORTANT: We’ve updated our definition of `initializeAttachmentMetadata`, so
// we need to run it again on existing items that have previously been incorrectly
// classified:
const toVersion7 = _withSchemaVersion({
  schemaVersion: 7,
  upgrade: initializeAttachmentMetadata,
});

const toVersion8 = _withSchemaVersion({
  schemaVersion: 8,
  upgrade: _mapAttachments(captureDimensionsAndScreenshot),
});

const toVersion9 = _withSchemaVersion({
  schemaVersion: 9,
  upgrade: _mapAttachments(replaceUnicodeV2),
});
const toVersion10 = _withSchemaVersion({
  schemaVersion: 10,
  upgrade: async (message, context) => {
    const processPreviews = _mapPreviewAttachments(migrateDataToFileSystem);
    const processSticker = async (
      stickerMessage: MessageAttributesType,
      stickerContext: ContextType
    ): Promise<MessageAttributesType> => {
      const { sticker } = stickerMessage;
      if (!sticker || !sticker.data || !sticker.data.data) {
        return stickerMessage;
      }

      return {
        ...stickerMessage,
        sticker: {
          ...sticker,
          data: await migrateDataToFileSystem(sticker.data, stickerContext),
        },
      };
    };

    const previewProcessed = await processPreviews(message, context);
    const stickerProcessed = await processSticker(previewProcessed, context);

    return stickerProcessed;
  },
});

const VERSIONS = [
  toVersion0,
  toVersion1,
  toVersion2,
  toVersion3,
  toVersion4,
  toVersion5,
  toVersion6,
  toVersion7,
  toVersion8,
  toVersion9,
  toVersion10,
];
export const CURRENT_SCHEMA_VERSION = VERSIONS.length - 1;

// We need dimensions and screenshots for images for proper display
export const VERSION_NEEDED_FOR_DISPLAY = 9;

// UpgradeStep
export const upgradeSchema = async (
  rawMessage: MessageAttributesType,
  {
    writeNewAttachmentData,
    getRegionCode,
    getAbsoluteAttachmentPath,
    getAbsoluteStickerPath,
    makeObjectUrl,
    revokeObjectUrl,
    getImageDimensions,
    makeImageThumbnail,
    makeVideoScreenshot,
    writeNewStickerData,
    logger,
    maxVersion = CURRENT_SCHEMA_VERSION,
  }: ContextType
): Promise<MessageAttributesType> => {
  if (!isFunction(writeNewAttachmentData)) {
    throw new TypeError('context.writeNewAttachmentData is required');
  }
  if (!isFunction(getRegionCode)) {
    throw new TypeError('context.getRegionCode is required');
  }
  if (!isFunction(getAbsoluteAttachmentPath)) {
    throw new TypeError('context.getAbsoluteAttachmentPath is required');
  }
  if (!isFunction(makeObjectUrl)) {
    throw new TypeError('context.makeObjectUrl is required');
  }
  if (!isFunction(revokeObjectUrl)) {
    throw new TypeError('context.revokeObjectUrl is required');
  }
  if (!isFunction(getImageDimensions)) {
    throw new TypeError('context.getImageDimensions is required');
  }
  if (!isFunction(makeImageThumbnail)) {
    throw new TypeError('context.makeImageThumbnail is required');
  }
  if (!isFunction(makeVideoScreenshot)) {
    throw new TypeError('context.makeVideoScreenshot is required');
  }
  if (!isObject(logger)) {
    throw new TypeError('context.logger is required');
  }
  if (!isFunction(getAbsoluteStickerPath)) {
    throw new TypeError('context.getAbsoluteStickerPath is required');
  }
  if (!isFunction(writeNewStickerData)) {
    throw new TypeError('context.writeNewStickerData is required');
  }

  let message = rawMessage;
  for (let index = 0, max = VERSIONS.length; index < max; index += 1) {
    if (maxVersion < index) {
      break;
    }

    const currentVersion = VERSIONS[index];
    // We really do want this intra-loop await because this is a chained async action,
    //   each step dependent on the previous
    // eslint-disable-next-line no-await-in-loop
    message = await currentVersion(message, {
      writeNewAttachmentData,
      getAbsoluteAttachmentPath,
      makeObjectUrl,
      revokeObjectUrl,
      getImageDimensions,
      makeImageThumbnail,
      makeVideoScreenshot,
      logger,
      getAbsoluteStickerPath,
      getRegionCode,
      writeNewStickerData,
    });
  }

  return message;
};

// Runs on attachments outside of the schema upgrade process, since attachments are
//   downloaded out of band.
export const processNewAttachment = async (
  attachment: AttachmentType,
  {
    writeNewAttachmentData,
    getAbsoluteAttachmentPath,
    makeObjectUrl,
    revokeObjectUrl,
    getImageDimensions,
    makeImageThumbnail,
    makeVideoScreenshot,
    logger,
  }: Pick<
    ContextType,
    | 'writeNewAttachmentData'
    | 'getAbsoluteAttachmentPath'
    | 'makeObjectUrl'
    | 'revokeObjectUrl'
    | 'getImageDimensions'
    | 'makeImageThumbnail'
    | 'makeVideoScreenshot'
    | 'logger'
  >
): Promise<AttachmentType> => {
  if (!isFunction(writeNewAttachmentData)) {
    throw new TypeError('context.writeNewAttachmentData is required');
  }
  if (!isFunction(getAbsoluteAttachmentPath)) {
    throw new TypeError('context.getAbsoluteAttachmentPath is required');
  }
  if (!isFunction(makeObjectUrl)) {
    throw new TypeError('context.makeObjectUrl is required');
  }
  if (!isFunction(revokeObjectUrl)) {
    throw new TypeError('context.revokeObjectUrl is required');
  }
  if (!isFunction(getImageDimensions)) {
    throw new TypeError('context.getImageDimensions is required');
  }
  if (!isFunction(makeImageThumbnail)) {
    throw new TypeError('context.makeImageThumbnail is required');
  }
  if (!isFunction(makeVideoScreenshot)) {
    throw new TypeError('context.makeVideoScreenshot is required');
  }
  if (!isObject(logger)) {
    throw new TypeError('context.logger is required');
  }

  const rotatedAttachment = await autoOrientJPEG(
    attachment,
    { logger },
    {
      isIncoming: true,
    }
  );

  let onDiskAttachment = rotatedAttachment;

  // If we rotated the attachment, then `data` will be the actual bytes of the attachment,
  //   in memory. We want that updated attachment to go back to disk.
  if (rotatedAttachment.data) {
    onDiskAttachment = await migrateDataToFileSystem(rotatedAttachment, {
      writeNewAttachmentData,
      logger,
    });
  }

  const finalAttachment = await captureDimensionsAndScreenshot(
    onDiskAttachment,
    {
      writeNewAttachmentData,
      getAbsoluteAttachmentPath,
      makeObjectUrl,
      revokeObjectUrl,
      getImageDimensions,
      makeImageThumbnail,
      makeVideoScreenshot,
      logger,
    }
  );

  return finalAttachment;
};

export const processNewSticker = async (
  stickerData: Uint8Array,
  {
    writeNewStickerData,
    getAbsoluteStickerPath,
    getImageDimensions,
    logger,
  }: Pick<
    ContextType,
    | 'writeNewStickerData'
    | 'getAbsoluteStickerPath'
    | 'getImageDimensions'
    | 'logger'
  >
): Promise<{ path: string; width: number; height: number }> => {
  if (!isFunction(writeNewStickerData)) {
    throw new TypeError('context.writeNewStickerData is required');
  }
  if (!isFunction(getAbsoluteStickerPath)) {
    throw new TypeError('context.getAbsoluteStickerPath is required');
  }
  if (!isFunction(getImageDimensions)) {
    throw new TypeError('context.getImageDimensions is required');
  }
  if (!isObject(logger)) {
    throw new TypeError('context.logger is required');
  }

  const path = await writeNewStickerData(stickerData);
  const absolutePath = await getAbsoluteStickerPath(path);

  const { width, height } = await getImageDimensions({
    objectUrl: absolutePath,
    logger,
  });

  return {
    path,
    width,
    height,
  };
};

type LoadAttachmentType = (
  attachment: Pick<AttachmentType, 'data' | 'path'>
) => Promise<AttachmentWithHydratedData>;

export const createAttachmentLoader = (
  loadAttachmentData: LoadAttachmentType
): ((message: MessageAttributesType) => Promise<MessageAttributesType>) => {
  if (!isFunction(loadAttachmentData)) {
    throw new TypeError(
      'createAttachmentLoader: loadAttachmentData is required'
    );
  }

  return async (
    message: MessageAttributesType
  ): Promise<MessageAttributesType> => ({
    ...message,
    attachments: await Promise.all(
      (message.attachments || []).map(loadAttachmentData)
    ),
  });
};

export const loadQuoteData = (
  loadAttachmentData: LoadAttachmentType
): ((
  quote: QuotedMessageType | undefined | null
) => Promise<QuotedMessageType | null>) => {
  if (!isFunction(loadAttachmentData)) {
    throw new TypeError('loadQuoteData: loadAttachmentData is required');
  }

  return async (
    quote: QuotedMessageType | undefined | null
  ): Promise<QuotedMessageType | null> => {
    if (!quote) {
      return null;
    }

    return {
      ...quote,
      attachments: await Promise.all(
        (quote.attachments || []).map(async attachment => {
          const { thumbnail } = attachment;

          if (!thumbnail || !thumbnail.path) {
            return attachment;
          }

          return {
            ...attachment,
            thumbnail: await loadAttachmentData(thumbnail),
          };
        })
      ),
    };
  };
};

export const loadContactData = (
  loadAttachmentData: LoadAttachmentType
): ((
  contact: Array<EmbeddedContactType> | undefined
) => Promise<Array<EmbeddedContactWithHydratedAvatar> | undefined>) => {
  if (!isFunction(loadAttachmentData)) {
    throw new TypeError('loadContactData: loadAttachmentData is required');
  }

  return async (
    contact: Array<EmbeddedContactType> | undefined
  ): Promise<Array<EmbeddedContactWithHydratedAvatar> | undefined> => {
    if (!contact) {
      return undefined;
    }

    return Promise.all(
      contact.map(
        async (
          item: EmbeddedContactType
        ): Promise<EmbeddedContactWithHydratedAvatar> => {
          if (
            !item ||
            !item.avatar ||
            !item.avatar.avatar ||
            !item.avatar.avatar.path
          ) {
            return {
              ...item,
              avatar: undefined,
            };
          }

          return {
            ...item,
            avatar: {
              ...item.avatar,
              avatar: {
                ...item.avatar.avatar,
                ...(await loadAttachmentData(item.avatar.avatar)),
              },
            },
          };
        }
      )
    );
  };
};

export const loadPreviewData = (
  loadAttachmentData: LoadAttachmentType
): ((
  preview: Array<LinkPreviewType> | undefined
) => Promise<Array<LinkPreviewWithHydratedData>>) => {
  if (!isFunction(loadAttachmentData)) {
    throw new TypeError('loadPreviewData: loadAttachmentData is required');
  }

  return async (preview: Array<LinkPreviewType> | undefined) => {
    if (!preview || !preview.length) {
      return [];
    }

    return Promise.all(
      preview.map(
        async (item: LinkPreviewType): Promise<LinkPreviewWithHydratedData> => {
          if (!item.image) {
            return {
              ...item,
              // Pacify typescript
              image: undefined,
            };
          }

          return {
            ...item,
            image: await loadAttachmentData(item.image),
          };
        }
      )
    );
  };
};

export const loadStickerData = (
  loadAttachmentData: LoadAttachmentType
): ((
  sticker: StickerType | undefined
) => Promise<StickerWithHydratedData | undefined>) => {
  if (!isFunction(loadAttachmentData)) {
    throw new TypeError('loadStickerData: loadAttachmentData is required');
  }

  return async (sticker: StickerType | undefined) => {
    if (!sticker || !sticker.data) {
      return undefined;
    }

    return {
      ...sticker,
      data: await loadAttachmentData(sticker.data),
    };
  };
};

export const deleteAllExternalFiles = ({
  deleteAttachmentData,
  deleteOnDisk,
}: {
  deleteAttachmentData: (attachment: AttachmentType) => Promise<void>;
  deleteOnDisk: (path: string) => Promise<void>;
}): ((message: MessageAttributesType) => Promise<void>) => {
  if (!isFunction(deleteAttachmentData)) {
    throw new TypeError(
      'deleteAllExternalFiles: deleteAttachmentData must be a function'
    );
  }

  if (!isFunction(deleteOnDisk)) {
    throw new TypeError(
      'deleteAllExternalFiles: deleteOnDisk must be a function'
    );
  }

  return async (message: MessageAttributesType) => {
    const { attachments, editHistory, quote, contact, preview, sticker } =
      message;

    if (attachments && attachments.length) {
      await Promise.all(attachments.map(deleteAttachmentData));
    }

    if (quote && quote.attachments && quote.attachments.length) {
      await Promise.all(
        quote.attachments.map(async attachment => {
          const { thumbnail } = attachment;

          // To prevent spoofing, we copy the original image from the quoted message.
          //   If so, it will have a 'copied' field. We don't want to delete it if it has
          //   that field set to true.
          if (thumbnail && thumbnail.path && !thumbnail.copied) {
            await deleteOnDisk(thumbnail.path);
          }
        })
      );
    }

    if (contact && contact.length) {
      await Promise.all(
        contact.map(async item => {
          const { avatar } = item;

          if (avatar && avatar.avatar && avatar.avatar.path) {
            await deleteOnDisk(avatar.avatar.path);
          }
        })
      );
    }

    if (preview && preview.length) {
      await deletePreviews(preview, deleteOnDisk);
    }

    if (sticker && sticker.data && sticker.data.path) {
      await deleteOnDisk(sticker.data.path);

      if (sticker.data.thumbnail && sticker.data.thumbnail.path) {
        await deleteOnDisk(sticker.data.thumbnail.path);
      }
    }

    if (editHistory && editHistory.length) {
      await editHistory.map(edit => {
        if (!edit.attachments || !edit.attachments.length) {
          return;
        }
        return Promise.all(edit.attachments.map(deleteAttachmentData));
      });
      await editHistory.map(edit => deletePreviews(edit.preview, deleteOnDisk));
    }
  };
};

async function deletePreviews(
  preview: MessageAttributesType['preview'],
  deleteOnDisk: (path: string) => Promise<void>
): Promise<Array<void>> {
  if (!preview) {
    return [];
  }

  return Promise.all(
    preview.map(async item => {
      const { image } = item;

      if (image && image.path) {
        await deleteOnDisk(image.path);
      }

      if (image?.thumbnail?.path) {
        await deleteOnDisk(image.thumbnail.path);
      }
    })
  );
}

//      createAttachmentDataWriter :: (RelativePath -> IO Unit)
//                                    Message ->
//                                    IO (Promise Message)
export const createAttachmentDataWriter = ({
  writeExistingAttachmentData,
  logger,
}: {
  writeExistingAttachmentData: WriteExistingAttachmentDataType;
  logger: LoggerType;
}): ((message: MessageAttributesType) => Promise<MessageAttributesType>) => {
  if (!isFunction(writeExistingAttachmentData)) {
    throw new TypeError(
      'createAttachmentDataWriter: writeExistingAttachmentData must be a function'
    );
  }
  if (!isObject(logger)) {
    throw new TypeError('createAttachmentDataWriter: logger must be an object');
  }

  return async (
    rawMessage: MessageAttributesType
  ): Promise<MessageAttributesType> => {
    if (!isValid(rawMessage)) {
      throw new TypeError("'rawMessage' is not valid");
    }

    const message = initializeSchemaVersion({
      message: rawMessage,
      logger,
    });

    const { attachments, quote, contact, preview } = message;
    const hasFilesToWrite =
      (quote && quote.attachments && quote.attachments.length > 0) ||
      (attachments && attachments.length > 0) ||
      (contact && contact.length > 0) ||
      (preview && preview.length > 0);

    if (!hasFilesToWrite) {
      return message;
    }

    const lastVersionWithAttachmentDataInMemory = 2;
    const willAttachmentsGoToFileSystemOnUpgrade =
      (message.schemaVersion || 0) <= lastVersionWithAttachmentDataInMemory;
    if (willAttachmentsGoToFileSystemOnUpgrade) {
      return message;
    }

    (attachments || []).forEach(attachment => {
      if (!hasData(attachment)) {
        throw new TypeError(
          "'attachment.data' is required during message import"
        );
      }

      if (!isString(attachment.path)) {
        throw new TypeError(
          "'attachment.path' is required during message import"
        );
      }
    });

    const writeQuoteAttachment = async (attachment: AttachmentType) => {
      const { thumbnail } = attachment;
      if (!thumbnail) {
        return attachment;
      }

      const { data, path } = thumbnail;

      // we want to be bulletproof to attachments without data
      if (!data || !path) {
        logger.warn(
          'quote attachment had neither data nor path.',
          'id:',
          message.id,
          'source:',
          message.source
        );
        return attachment;
      }

      await writeExistingAttachmentData(thumbnail);
      return {
        ...attachment,
        thumbnail: omit(thumbnail, ['data']),
      };
    };

    const writeContactAvatar = async (
      messageContact: EmbeddedContactType
    ): Promise<EmbeddedContactType> => {
      const { avatar } = messageContact;
      if (!avatar) {
        return messageContact;
      }

      if (avatar && !avatar.avatar) {
        return omit(messageContact, ['avatar']);
      }

      await writeExistingAttachmentData(avatar.avatar);

      return {
        ...messageContact,
        avatar: { ...avatar, avatar: omit(avatar.avatar, ['data']) },
      };
    };

    const writePreviewImage = async (
      item: LinkPreviewType
    ): Promise<LinkPreviewType> => {
      const { image } = item;
      if (!image) {
        return omit(item, ['image']);
      }

      await writeExistingAttachmentData(image);

      return { ...item, image: omit(image, ['data']) };
    };

    const messageWithoutAttachmentData = {
      ...message,
      ...(quote
        ? {
            quote: {
              ...quote,
              attachments: await Promise.all(
                (quote?.attachments || []).map(writeQuoteAttachment)
              ),
            },
          }
        : undefined),
      contact: await Promise.all((contact || []).map(writeContactAvatar)),
      preview: await Promise.all((preview || []).map(writePreviewImage)),
      attachments: await Promise.all(
        (attachments || []).map(async attachment => {
          await writeExistingAttachmentData(attachment);

          if (attachment.screenshot && attachment.screenshot.data) {
            await writeExistingAttachmentData(attachment.screenshot);
          }
          if (attachment.thumbnail && attachment.thumbnail.data) {
            await writeExistingAttachmentData(attachment.thumbnail);
          }

          return {
            ...omit(attachment, ['data']),
            ...(attachment.thumbnail
              ? { thumbnail: omit(attachment.thumbnail, ['data']) }
              : null),
            ...(attachment.screenshot
              ? { screenshot: omit(attachment.screenshot, ['data']) }
              : null),
          };
        })
      ),
    };

    return messageWithoutAttachmentData;
  };
};
