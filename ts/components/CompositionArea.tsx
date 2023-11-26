// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import type { ReadonlyDeep } from 'type-fest';

import type { DraftBodyRanges } from '../types/BodyRange';
import type { LocalizerType, ThemeType } from '../types/Util';
import type { ErrorDialogAudioRecorderType } from '../types/AudioRecorder';
import { RecordingState } from '../types/AudioRecorder';
import type { imageToBlurHash } from '../util/imageToBlurHash';
import { Spinner } from './Spinner';
import type {
  Props as EmojiButtonProps,
  EmojiButtonAPI,
} from './emoji/EmojiButton';
import { EmojiButton } from './emoji/EmojiButton';
import type { Props as StickerButtonProps } from './stickers/StickerButton';
import { StickerButton } from './stickers/StickerButton';
import type {
  InputApi,
  Props as CompositionInputProps,
} from './CompositionInput';
import { CompositionInput } from './CompositionInput';
import type { Props as MessageRequestActionsProps } from './conversation/MessageRequestActions';
import { MessageRequestActions } from './conversation/MessageRequestActions';
import type { PropsType as GroupV1DisabledActionsPropsType } from './conversation/GroupV1DisabledActions';
import { GroupV1DisabledActions } from './conversation/GroupV1DisabledActions';
import type { PropsType as GroupV2PendingApprovalActionsPropsType } from './conversation/GroupV2PendingApprovalActions';
import { GroupV2PendingApprovalActions } from './conversation/GroupV2PendingApprovalActions';
import { AnnouncementsOnlyGroupBanner } from './AnnouncementsOnlyGroupBanner';
import { AttachmentList } from './conversation/AttachmentList';
import type {
  AttachmentDraftType,
  InMemoryAttachmentDraftType,
} from '../types/Attachment';
import { isImageAttachment, isVoiceMessage } from '../types/Attachment';
import type { AciString } from '../types/ServiceId';
import { AudioCapture } from './conversation/AudioCapture';
import { CompositionUpload } from './CompositionUpload';
import type {
  ConversationType,
  PushPanelForConversationActionType,
  ShowConversationType,
} from '../state/ducks/conversations';
import type { EmojiPickDataType } from './emoji/EmojiPicker';
import type { LinkPreviewType } from '../types/message/LinkPreviews';

import { MandatoryProfileSharingActions } from './conversation/MandatoryProfileSharingActions';
import { MediaQualitySelector } from './MediaQualitySelector';
import type { Props as QuoteProps } from './conversation/Quote';
import { Quote } from './conversation/Quote';
import { countStickers } from './stickers/lib';
import {
  useAttachFileShortcut,
  useEditLastMessageSent,
  useKeyboardShortcutsConditionally,
} from '../hooks/useKeyboardShortcuts';
import { MediaEditor } from './MediaEditor';
import { isImageTypeSupported } from '../util/GoogleChrome';
import * as KeyboardLayout from '../services/keyboardLayout';
import { usePrevious } from '../hooks/usePrevious';
import { PanelType } from '../types/Panels';
import type { SmartCompositionRecordingDraftProps } from '../state/smart/CompositionRecordingDraft';
import { useEscapeHandling } from '../hooks/useEscapeHandling';
import type { SmartCompositionRecordingProps } from '../state/smart/CompositionRecording';
import SelectModeActions from './conversation/SelectModeActions';
import type { ShowToastAction } from '../state/ducks/toast';
import type { DraftEditMessageType } from '../model-types.d';
import OS from '../util/os/osMain';

export type OwnProps = Readonly<{
  acceptedMessageRequest?: boolean;
  removalStage?: 'justNotification' | 'messageRequest';
  addAttachment: (
    conversationId: string,
    attachment: InMemoryAttachmentDraftType
  ) => unknown;
  announcementsOnly?: boolean;
  areWeAdmin?: boolean;
  areWePending?: boolean;
  areWePendingApproval?: boolean;
  cancelRecording: () => unknown;
  completeRecording: (
    conversationId: string,
    onRecordingComplete: (rec: InMemoryAttachmentDraftType) => unknown
  ) => unknown;
  conversationId: string;
  discardEditMessage: (id: string) => unknown;
  draftEditMessage?: DraftEditMessageType;
  draftAttachments: ReadonlyArray<AttachmentDraftType>;
  errorDialogAudioRecorderType?: ErrorDialogAudioRecorderType;
  errorRecording: (e: ErrorDialogAudioRecorderType) => unknown;
  focusCounter: number;
  groupAdmins: Array<ConversationType>;
  groupVersion?: 1 | 2;
  i18n: LocalizerType;
  imageToBlurHash: typeof imageToBlurHash;
  isDisabled: boolean;
  isFetchingUUID?: boolean;
  isFormattingEnabled: boolean;
  isFormattingFlagEnabled: boolean;
  isFormattingSpoilersFlagEnabled: boolean;
  isGroupV1AndDisabled?: boolean;
  isMissingMandatoryProfileSharing?: boolean;
  isSignalConversation?: boolean;
  lastEditableMessageId?: string;
  recordingState: RecordingState;
  messageCompositionId: string;
  shouldHidePopovers?: boolean;
  isSMSOnly?: boolean;
  left?: boolean;
  linkPreviewLoading: boolean;
  linkPreviewResult?: LinkPreviewType;
  messageRequestsEnabled?: boolean;
  onClearAttachments(conversationId: string): unknown;
  onCloseLinkPreview(conversationId: string): unknown;
  platform: string;
  showToast: ShowToastAction;
  processAttachments: (options: {
    conversationId: string;
    files: ReadonlyArray<File>;
  }) => unknown;
  setMediaQualitySetting(conversationId: string, isHQ: boolean): unknown;
  sendStickerMessage(
    id: string,
    opts: { packId: string; stickerId: number }
  ): unknown;
  sendEditedMessage(
    conversationId: string,
    options: {
      bodyRanges?: DraftBodyRanges;
      message?: string;
      quoteAuthorAci?: AciString;
      quoteSentAt?: number;
      targetMessageId: string;
    }
  ): unknown;
  sendMultiMediaMessage(
    conversationId: string,
    options: {
      draftAttachments?: ReadonlyArray<AttachmentDraftType>;
      bodyRanges?: DraftBodyRanges;
      message?: string;
      timestamp?: number;
      voiceNoteAttachment?: InMemoryAttachmentDraftType;
    }
  ): unknown;
  quotedMessageId?: string;
  quotedMessageProps?: ReadonlyDeep<
    Omit<
      QuoteProps,
      'i18n' | 'onClick' | 'onClose' | 'withContentAbove' | 'isCompose'
    >
  >;
  quotedMessageAuthorAci?: AciString;
  quotedMessageSentAt?: number;

  removeAttachment: (conversationId: string, filePath: string) => unknown;
  scrollToMessage: (conversationId: string, messageId: string) => unknown;
  setComposerFocus: (conversationId: string) => unknown;
  setMessageToEdit(conversationId: string, messageId: string): unknown;
  setQuoteByMessageId(
    conversationId: string,
    messageId: string | undefined
  ): unknown;
  shouldSendHighQualityAttachments: boolean;
  showConversation: ShowConversationType;
  startRecording: (id: string) => unknown;
  theme: ThemeType;
  renderSmartCompositionRecording: (
    props: SmartCompositionRecordingProps
  ) => JSX.Element;
  renderSmartCompositionRecordingDraft: (
    props: SmartCompositionRecordingDraftProps
  ) => JSX.Element | null;
  selectedMessageIds: ReadonlyArray<string> | undefined;
  toggleSelectMode: (on: boolean) => void;
  toggleForwardMessagesModal: (
    messageIds: ReadonlyArray<string>,
    onForward: () => void
  ) => void;
}>;

export type Props = Pick<
  CompositionInputProps,
  | 'clearQuotedMessage'
  | 'draftText'
  | 'draftBodyRanges'
  | 'getPreferredBadge'
  | 'getQuotedMessage'
  | 'onEditorStateChange'
  | 'onTextTooLong'
  | 'sendCounter'
  | 'sortedGroupMembers'
> &
  Pick<
    EmojiButtonProps,
    'onPickEmoji' | 'onSetSkinTone' | 'recentEmojis' | 'skinTone'
  > &
  Pick<
    StickerButtonProps,
    | 'knownPacks'
    | 'receivedPacks'
    | 'installedPack'
    | 'installedPacks'
    | 'blessedPacks'
    | 'recentStickers'
    | 'clearInstalledStickerPack'
    | 'clearShowIntroduction'
    | 'showPickerHint'
    | 'clearShowPickerHint'
  > &
  MessageRequestActionsProps &
  Pick<GroupV1DisabledActionsPropsType, 'showGV2MigrationDialog'> &
  Pick<GroupV2PendingApprovalActionsPropsType, 'cancelJoinRequest'> & {
    pushPanelForConversation: PushPanelForConversationActionType;
  } & OwnProps;

export function CompositionArea({
  // Base props
  addAttachment,
  conversationId,
  discardEditMessage,
  draftEditMessage,
  focusCounter,
  i18n,
  imageToBlurHash,
  isDisabled,
  isSignalConversation,
  lastEditableMessageId,
  messageCompositionId,
  pushPanelForConversation,
  platform,
  processAttachments,
  removeAttachment,
  sendEditedMessage,
  sendMultiMediaMessage,
  setComposerFocus,
  setMessageToEdit,
  setQuoteByMessageId,
  shouldHidePopovers,
  showToast,
  theme,

  // AttachmentList
  draftAttachments,
  onClearAttachments,
  // AudioCapture
  recordingState,
  startRecording,
  // StagedLinkPreview
  linkPreviewLoading,
  linkPreviewResult,
  onCloseLinkPreview,
  // Quote
  quotedMessageId,
  quotedMessageProps,
  quotedMessageAuthorAci,
  quotedMessageSentAt,
  scrollToMessage,
  // MediaQualitySelector
  setMediaQualitySetting,
  shouldSendHighQualityAttachments,
  // CompositionInput
  clearQuotedMessage,
  draftBodyRanges,
  draftText,
  getPreferredBadge,
  getQuotedMessage,
  isFormattingEnabled,
  isFormattingFlagEnabled,
  isFormattingSpoilersFlagEnabled,
  onEditorStateChange,
  onTextTooLong,
  sendCounter,
  sortedGroupMembers,
  // EmojiButton
  onPickEmoji,
  onSetSkinTone,
  recentEmojis,
  skinTone,
  // StickerButton
  knownPacks,
  receivedPacks,
  installedPack,
  installedPacks,
  blessedPacks,
  recentStickers,
  clearInstalledStickerPack,
  sendStickerMessage,
  clearShowIntroduction,
  showPickerHint,
  clearShowPickerHint,
  // Message Requests
  acceptedMessageRequest,
  areWePending,
  areWePendingApproval,
  conversationType,
  groupVersion,
  isBlocked,
  isMissingMandatoryProfileSharing,
  left,
  messageRequestsEnabled,
  removalStage,
  acceptConversation,
  blockConversation,
  blockAndReportSpam,
  deleteConversation,
  title,
  // GroupV1 Disabled Actions
  isGroupV1AndDisabled,
  showGV2MigrationDialog,
  // GroupV2
  announcementsOnly,
  areWeAdmin,
  groupAdmins,
  cancelJoinRequest,
  showConversation,
  // SMS-only contacts
  isSMSOnly,
  isFetchingUUID,
  renderSmartCompositionRecording,
  renderSmartCompositionRecordingDraft,
  // Selected messages
  selectedMessageIds,
  toggleSelectMode,
  toggleForwardMessagesModal,
}: Props): JSX.Element | null {
  const [dirty, setDirty] = useState(false);
  const [large, setLarge] = useState(false);
  const [attachmentToEdit, setAttachmentToEdit] = useState<
    AttachmentDraftType | undefined
  >();
  const inputApiRef = useRef<InputApi | undefined>();
  const emojiButtonRef = useRef<EmojiButtonAPI | undefined>();
  const fileInputRef = useRef<null | HTMLInputElement>(null);

  const handleForceSend = useCallback(() => {
    /*if (OS.isMacOS()) {
      const {
        getAuthStatus, askForCameraAccess, askForMicrophoneAccess 
      } = require('node-mac-permissions');
      if (getAuthStatus('camera') !== 'authorized')
        askForCameraAccess();
      if (getAuthStatus('microphone') !== 'authorized')
        askForMicrophoneAccess();
    }*/
    setLarge(false);
    if (inputApiRef.current) {
      inputApiRef.current.submit();
    }
  }, [inputApiRef, setLarge]);

  const draftEditMessageBody = draftEditMessage?.body;
  const editedMessageId = draftEditMessage?.targetMessageId;

  const handleSubmit = useCallback(
    (message: string, bodyRanges: DraftBodyRanges, timestamp: number) => {
      emojiButtonRef.current?.close();

      if (editedMessageId) {
        sendEditedMessage(conversationId, {
          bodyRanges,
          message,
          // sent timestamp for the quote
          quoteSentAt: quotedMessageSentAt,
          quoteAuthorAci: quotedMessageAuthorAci,
          targetMessageId: editedMessageId,
        });
      } else {
        sendMultiMediaMessage(conversationId, {
          draftAttachments,
          bodyRanges,
          message,
          timestamp,
        });
      }
      setLarge(false);
    },
    [
      conversationId,
      draftAttachments,
      editedMessageId,
      quotedMessageSentAt,
      quotedMessageAuthorAci,
      sendEditedMessage,
      sendMultiMediaMessage,
      setLarge,
    ]
  );

  const launchAttachmentPicker = useCallback(() => {
    const fileInput = fileInputRef.current;
    if (fileInput) {
      // Setting the value to empty so that onChange always fires in case
      // you add multiple photos.
      fileInput.value = '';
      fileInput.click();
    }
  }, []);

  function maybeEditAttachment(attachment: AttachmentDraftType) {
    if (!isImageTypeSupported(attachment.contentType)) {
      return;
    }

    setAttachmentToEdit(attachment);
  }

  const isComposerEmpty =
    !draftAttachments.length && !draftText && !draftEditMessage;

  const maybeEditMessage = useCallback(() => {
    if (!isComposerEmpty || !lastEditableMessageId) {
      return false;
    }

    setMessageToEdit(conversationId, lastEditableMessageId);
    return true;
  }, [
    conversationId,
    isComposerEmpty,
    lastEditableMessageId,
    setMessageToEdit,
  ]);

  const [hasFocus, setHasFocus] = useState(false);

  const attachFileShortcut = useAttachFileShortcut(launchAttachmentPicker);
  const editLastMessageSent = useEditLastMessageSent(maybeEditMessage);
  useKeyboardShortcutsConditionally(
    hasFocus,
    attachFileShortcut,
    editLastMessageSent
  );

  // Focus input on first mount
  const previousFocusCounter = usePrevious<number | undefined>(
    focusCounter,
    focusCounter
  );
  useEffect(() => {
    if (inputApiRef.current) {
      inputApiRef.current.focus();
      setHasFocus(true);
    }
  }, []);
  // Focus input whenever explicitly requested
  useEffect(() => {
    if (focusCounter !== previousFocusCounter && inputApiRef.current) {
      inputApiRef.current.focus();
      setHasFocus(true);
    }
  }, [inputApiRef, focusCounter, previousFocusCounter]);

  const withStickers =
    countStickers({
      knownPacks,
      blessedPacks,
      installedPacks,
      receivedPacks,
    }) > 0;

  const previousMessageCompositionId = usePrevious(
    messageCompositionId,
    messageCompositionId
  );
  const previousSendCounter = usePrevious(sendCounter, sendCounter);
  useEffect(() => {
    if (!inputApiRef.current) {
      return;
    }
    if (
      previousMessageCompositionId !== messageCompositionId ||
      previousSendCounter !== sendCounter
    ) {
      inputApiRef.current.reset();
    }
  }, [
    messageCompositionId,
    sendCounter,
    previousMessageCompositionId,
    previousSendCounter,
  ]);

  const insertEmoji = useCallback(
    (e: EmojiPickDataType) => {
      if (inputApiRef.current) {
        inputApiRef.current.insertEmoji(e);
        onPickEmoji(e);
      }
    },
    [inputApiRef, onPickEmoji]
  );

  // We want to reset the state of Quill only if:
  //
  // - Our other device edits the message (edit history length would change)
  // - User begins editing another message.
  const editHistoryLength = draftEditMessage?.editHistoryLength;
  const hasEditHistoryChanged =
    usePrevious(editHistoryLength, editHistoryLength) !== editHistoryLength;
  const hasEditedMessageChanged =
    usePrevious(editedMessageId, editedMessageId) !== editedMessageId;

  const hasEditDraftChanged = hasEditHistoryChanged || hasEditedMessageChanged;
  useEffect(() => {
    if (!hasEditDraftChanged) {
      return;
    }

    inputApiRef.current?.setContents(
      draftEditMessageBody ?? '',
      draftBodyRanges,
      true
    );
  }, [draftBodyRanges, draftEditMessageBody, hasEditDraftChanged]);

  const previousConversationId = usePrevious(conversationId, conversationId);
  useEffect(() => {
    if (conversationId === previousConversationId) {
      return;
    }

    if (!draftText) {
      inputApiRef.current?.setContents('');
      return;
    }

    inputApiRef.current?.setContents(draftText, draftBodyRanges, true);
  }, [conversationId, draftBodyRanges, draftText, previousConversationId]);

  const handleToggleLarge = useCallback(() => {
    setLarge(l => !l);
  }, [setLarge]);

  const shouldShowMicrophone = !large && isComposerEmpty;

  const showMediaQualitySelector = draftAttachments.some(isImageAttachment);

  const leftHandSideButtonsFragment = (
    <>
      <div className="CompositionArea__button-cell">
        <EmojiButton
          emojiButtonApi={emojiButtonRef}
          i18n={i18n}
          doSend={handleForceSend}
          onPickEmoji={insertEmoji}
          onClose={() => setComposerFocus(conversationId)}
          recentEmojis={recentEmojis}
          skinTone={skinTone}
          onSetSkinTone={onSetSkinTone}
        />
      </div>
      {showMediaQualitySelector ? (
        <div className="CompositionArea__button-cell">
          <MediaQualitySelector
            conversationId={conversationId}
            i18n={i18n}
            isHighQuality={shouldSendHighQualityAttachments}
            onSelectQuality={setMediaQualitySetting}
          />
        </div>
      ) : null}
    </>
  );

  const micButtonFragment = shouldShowMicrophone ? (
    <div className="CompositionArea__button-cell">
      <AudioCapture
        conversationId={conversationId}
        draftAttachments={draftAttachments}
        i18n={i18n}
        startRecording={startRecording}
      />
    </div>
  ) : null;

  const editMessageFragment = draftEditMessage ? (
    <>
      {large && <div className="CompositionArea__placeholder" />}
      <div className="CompositionArea__button-cell CompositionArea__button-edit">
        <button
          aria-label={i18n('icu:CompositionArea__edit-action--discard')}
          className="CompositionArea__edit-button CompositionArea__edit-button--discard"
          onClick={() => discardEditMessage(conversationId)}
          type="button"
        />
        <button
          aria-label={i18n('icu:CompositionArea__edit-action--send')}
          className="CompositionArea__edit-button CompositionArea__edit-button--accept"
          onClick={() => inputApiRef.current?.submit()}
          type="button"
        />
      </div>
    </>
  ) : null;

  const isRecording = recordingState === RecordingState.Recording;
  const attButton =
    draftEditMessage || linkPreviewResult || isRecording ? undefined : (
      <div className="CompositionArea__button-cell">
        <button
          type="button"
          className="CompositionArea__attach-file"
          onClick={launchAttachmentPicker}
          aria-label={i18n('icu:CompositionArea--attach-file')}
        />
      </div>
    );

  const sendButtonFragment = !draftEditMessage ? (
    <>
      <div className="CompositionArea__placeholder" />
      <div className="CompositionArea__button-cell">
        <button
          type="button"
          className="CompositionArea__send-button"
          onClick={handleForceSend}
          aria-label={i18n('icu:sendMessageToContact')}
        />
      </div>
    </>
  ) : null;

  const stickerButtonPlacement = large ? 'top-start' : 'top-end';
  const stickerButtonFragment =
    !draftEditMessage && withStickers ? (
      <div className="CompositionArea__button-cell">
        <StickerButton
          i18n={i18n}
          knownPacks={knownPacks}
          receivedPacks={receivedPacks}
          installedPack={installedPack}
          installedPacks={installedPacks}
          blessedPacks={blessedPacks}
          recentStickers={recentStickers}
          clearInstalledStickerPack={clearInstalledStickerPack}
          onClickAddPack={() =>
            pushPanelForConversation({
              type: PanelType.StickerManager,
            })
          }
          onPickSticker={(packId, stickerId) =>
            sendStickerMessage(conversationId, { packId, stickerId })
          }
          clearShowIntroduction={clearShowIntroduction}
          showPickerHint={showPickerHint}
          clearShowPickerHint={clearShowPickerHint}
          position={stickerButtonPlacement}
        />
      </div>
    ) : null;

  // Listen for cmd/ctrl-shift-x to toggle large composition mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { shiftKey, ctrlKey, metaKey } = e;
      const key = KeyboardLayout.lookup(e);
      // When using the ctrl key, `key` is `'K'`. When using the cmd key, `key` is `'k'`
      const targetKey = key === 'k' || key === 'K';
      const commandKey = platform === 'darwin' && metaKey;
      const controlKey = platform !== 'darwin' && ctrlKey;
      const commandOrCtrl = commandKey || controlKey;

      // cmd/ctrl-shift-k
      if (targetKey && shiftKey && commandOrCtrl) {
        e.preventDefault();
        setLarge(x => !x);
      }
    };

    document.addEventListener('keydown', handler);

    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [platform, setLarge]);

  const handleRecordingBeforeSend = useCallback(() => {
    emojiButtonRef.current?.close();
  }, [emojiButtonRef]);

  const handleEscape = useCallback(() => {
    if (linkPreviewResult) {
      onCloseLinkPreview(conversationId);
    } else if (draftEditMessage) {
      discardEditMessage(conversationId);
    } else if (quotedMessageId) {
      setQuoteByMessageId(conversationId, undefined);
    }
  }, [
    conversationId,
    discardEditMessage,
    draftEditMessage,
    linkPreviewResult,
    onCloseLinkPreview,
    quotedMessageId,
    setQuoteByMessageId,
  ]);

  useEscapeHandling(handleEscape);

  if (isSignalConversation) {
    // TODO DESKTOP-4547
    return <div />;
  }

  if (selectedMessageIds != null) {
    return (
      <SelectModeActions
        i18n={i18n}
        selectedMessageIds={selectedMessageIds}
        onExitSelectMode={() => {
          toggleSelectMode(false);
        }}
        onDeleteMessages={() => {
          window.reduxActions.globalModals.toggleDeleteMessagesModal({
            conversationId,
            messageIds: selectedMessageIds,
            onDelete() {
              toggleSelectMode(false);
            },
          });
        }}
        onForwardMessages={() => {
          if (selectedMessageIds.length > 0) {
            toggleForwardMessagesModal(selectedMessageIds, () => {
              toggleSelectMode(false);
            });
          }
        }}
        showToast={showToast}
      />
    );
  }

  if (
    isBlocked ||
    areWePending ||
    (messageRequestsEnabled &&
      !acceptedMessageRequest &&
      removalStage !== 'justNotification')
  ) {
    return (
      <MessageRequestActions
        acceptConversation={acceptConversation}
        blockAndReportSpam={blockAndReportSpam}
        blockConversation={blockConversation}
        conversationId={conversationId}
        conversationType={conversationType}
        deleteConversation={deleteConversation}
        i18n={i18n}
        isBlocked={isBlocked}
        isHidden={removalStage !== undefined}
        title={title}
      />
    );
  }

  if (conversationType === 'direct' && isSMSOnly) {
    return (
      <div
        className={classNames([
          'CompositionArea',
          'CompositionArea--sms-only',
          isFetchingUUID ? 'CompositionArea--pending' : null,
        ])}
      >
        {isFetchingUUID ? (
          <Spinner
            ariaLabel={i18n('icu:CompositionArea--sms-only__spinner-label')}
            role="presentation"
            moduleClassName="module-image-spinner"
            svgSize="small"
          />
        ) : (
          <>
            <h2 className="CompositionArea--sms-only__title">
              {i18n('icu:CompositionArea--sms-only__title')}
            </h2>
            <p className="CompositionArea--sms-only__body">
              {i18n('icu:CompositionArea--sms-only__body')}
            </p>
          </>
        )}
      </div>
    );
  }

  // If no message request, but we haven't shared profile yet, we show profile-sharing UI
  if (
    !left &&
    ((conversationType === 'direct' && removalStage !== 'justNotification') ||
      (conversationType === 'group' && groupVersion === 1)) &&
    isMissingMandatoryProfileSharing
  ) {
    return (
      <MandatoryProfileSharingActions
        acceptConversation={acceptConversation}
        blockAndReportSpam={blockAndReportSpam}
        blockConversation={blockConversation}
        conversationId={conversationId}
        conversationType={conversationType}
        deleteConversation={deleteConversation}
        i18n={i18n}
        title={title}
      />
    );
  }

  // If this is a V1 group, now disabled entirely, we show UI to help them upgrade
  if (!left && isGroupV1AndDisabled) {
    return (
      <GroupV1DisabledActions
        conversationId={conversationId}
        i18n={i18n}
        showGV2MigrationDialog={showGV2MigrationDialog}
      />
    );
  }

  if (areWePendingApproval) {
    return (
      <GroupV2PendingApprovalActions
        cancelJoinRequest={cancelJoinRequest}
        conversationId={conversationId}
        i18n={i18n}
      />
    );
  }

  if (announcementsOnly && !areWeAdmin) {
    return (
      <AnnouncementsOnlyGroupBanner
        groupAdmins={groupAdmins}
        i18n={i18n}
        showConversation={showConversation}
        theme={theme}
      />
    );
  }

  if (isRecording) {
    return renderSmartCompositionRecording({
      onBeforeSend: handleRecordingBeforeSend,
    });
  }

  if (draftAttachments.length === 1 && isVoiceMessage(draftAttachments[0])) {
    const voiceNoteAttachment = draftAttachments[0];

    if (!voiceNoteAttachment.pending && voiceNoteAttachment.url) {
      return renderSmartCompositionRecordingDraft({ voiceNoteAttachment });
    }
  }

  return (
    <div className="CompositionArea">
      {attachmentToEdit &&
        'url' in attachmentToEdit &&
        attachmentToEdit.url && (
          <MediaEditor
            i18n={i18n}
            imageSrc={attachmentToEdit.url}
            imageToBlurHash={imageToBlurHash}
            isSending={false}
            onClose={() => setAttachmentToEdit(undefined)}
            onDone={({ data, contentType, blurHash }) => {
              const newAttachment = {
                ...attachmentToEdit,
                contentType,
                blurHash,
                data,
                size: data.byteLength,
              };

              addAttachment(conversationId, newAttachment);
              setAttachmentToEdit(undefined);
            }}
            installedPacks={installedPacks}
            recentStickers={recentStickers}
          />
        )}
      <div className="CompositionArea__toggle-large">
        <button
          type="button"
          className={classNames(
            'CompositionArea__toggle-large__button',
            large ? 'CompositionArea__toggle-large__button--large-active' : null
          )}
          // This prevents the user from tabbing here
          tabIndex={-1}
          onClick={handleToggleLarge}
          aria-label={i18n('icu:CompositionArea--expand')}
        />
      </div>
      <div
        className={classNames(
          'CompositionArea__row',
          'CompositionArea__row--column'
        )}
      >
        {quotedMessageProps && (
          <div className="quote-wrapper">
            <Quote
              isCompose
              {...quotedMessageProps}
              i18n={i18n}
              onClick={
                quotedMessageId
                  ? () => scrollToMessage(conversationId, quotedMessageId)
                  : undefined
              }
              onClose={
                draftEditMessage
                  ? undefined
                  : () => {
                      setQuoteByMessageId(conversationId, undefined);
                    }
              }
            />
          </div>
        )}
        {draftAttachments.length ? (
          <div className="CompositionArea__attachment-list">
            <AttachmentList
              attachments={draftAttachments}
              canEditImages
              i18n={i18n}
              onAddAttachment={launchAttachmentPicker}
              onClickAttachment={maybeEditAttachment}
              onClose={() => onClearAttachments(conversationId)}
              onCloseAttachment={attachment => {
                if (attachment.path) {
                  removeAttachment(conversationId, attachment.path);
                }
              }}
            />
          </div>
        ) : null}
      </div>
      <div
        className={classNames(
          'CompositionArea__row',
          large ? 'CompositionArea__row--padded' : null
        )}
      >
        {!large ? leftHandSideButtonsFragment : null}
        <div
          className={classNames(
            'CompositionArea__input',
            large ? 'CompositionArea__input--padded' : null
          )}
        >
          <CompositionInput
            clearQuotedMessage={clearQuotedMessage}
            conversationId={conversationId}
            disabled={isDisabled}
            draftBodyRanges={draftBodyRanges}
            draftEditMessage={draftEditMessage}
            draftText={draftText}
            getPreferredBadge={getPreferredBadge}
            getQuotedMessage={getQuotedMessage}
            i18n={i18n}
            inputApi={inputApiRef}
            isFormattingEnabled={isFormattingEnabled}
            isFormattingFlagEnabled={isFormattingFlagEnabled}
            isFormattingSpoilersFlagEnabled={isFormattingSpoilersFlagEnabled}
            large={large}
            linkPreviewLoading={linkPreviewLoading}
            linkPreviewResult={linkPreviewResult}
            onBlur={() => setHasFocus(false)}
            onFocus={() => setHasFocus(true)}
            onCloseLinkPreview={onCloseLinkPreview}
            onDirtyChange={setDirty}
            onEditorStateChange={onEditorStateChange}
            onPickEmoji={onPickEmoji}
            onSubmit={handleSubmit}
            onTextTooLong={onTextTooLong}
            platform={platform}
            sendCounter={sendCounter}
            shouldHidePopovers={shouldHidePopovers}
            skinTone={skinTone}
            sortedGroupMembers={sortedGroupMembers}
            theme={theme}
          />
        </div>
        {!large ? (
          <>
            {stickerButtonFragment}
            {!dirty ? micButtonFragment : null}
            {editMessageFragment}
            {attButton}
          </>
        ) : null}
      </div>
      {large ? (
        <div
          className={classNames(
            'CompositionArea__row',
            'CompositionArea__row--control-row'
          )}
        >
          {leftHandSideButtonsFragment}
          {stickerButtonFragment}
          {attButton}
          {!dirty ? micButtonFragment : null}
          {editMessageFragment}
          {dirty || !shouldShowMicrophone ? sendButtonFragment : null}
        </div>
      ) : null}
      <CompositionUpload
        conversationId={conversationId}
        draftAttachments={draftAttachments}
        i18n={i18n}
        processAttachments={processAttachments}
        ref={fileInputRef}
      />
    </div>
  );
}
