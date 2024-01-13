// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ThunkAction } from 'redux-thunk';
import {
  difference,
  fromPairs,
  isEqual,
  omit,
  orderBy,
  pick,
  values,
  without,
} from 'lodash';

import { clipboard } from 'electron';
import type { ReadonlyDeep } from 'type-fest';
import type { AttachmentType } from '../../types/Attachment';
import type { StateType as RootStateType } from '../reducer';
import * as groups from '../../groups';
import * as log from '../../logging/log';
import { calling } from '../../services/calling';
import { getOwn } from '../../util/getOwn';
import { assertDev, strictAssert } from '../../util/assert';
import { drop } from '../../util/drop';
import type { DurationInSeconds } from '../../util/durations';
import * as universalExpireTimer from '../../util/universalExpireTimer';
import * as Attachment from '../../types/Attachment';
import { isFileDangerous } from '../../util/isFileDangerous';
import type {
  ShowSendAnywayDialogActionType,
  ShowErrorModalActionType,
  ToggleProfileEditorErrorActionType,
} from './globalModals';
import {
  SHOW_SEND_ANYWAY_DIALOG,
  SHOW_ERROR_MODAL,
  TOGGLE_PROFILE_EDITOR_ERROR,
} from './globalModals';
import {
  MODIFY_LIST,
  DELETE_LIST,
  HIDE_MY_STORIES_FROM,
  VIEWERS_CHANGED,
} from './storyDistributionLists';
import type { StoryDistributionListsActionType } from './storyDistributionLists';
import type {
  UUIDFetchStateKeyType,
  UUIDFetchStateType,
} from '../../util/uuidFetchState';

import type {
  AvatarColorType,
  ConversationColorType,
  CustomColorType,
} from '../../types/Colors';
import type {
  ConversationAttributesType,
  DraftEditMessageType,
  LastMessageStatus,
  MessageAttributesType,
} from '../../model-types.d';
import type {
  DraftBodyRanges,
  HydratedBodyRangesType,
} from '../../types/BodyRange';
import { CallMode } from '../../types/Calling';
import type { MediaItemType } from '../../types/MediaItem';
import type { StoryDistributionIdString } from '../../types/StoryDistributionId';
import { normalizeStoryDistributionId } from '../../types/StoryDistributionId';
import type {
  ServiceIdString,
  AciString,
  PniString,
} from '../../types/ServiceId';
import { isAciString } from '../../util/isAciString';
import { MY_STORY_ID, StorySendMode } from '../../types/Stories';
import * as Errors from '../../types/errors';
import {
  getGroupSizeRecommendedLimit,
  getGroupSizeHardLimit,
} from '../../groups/limits';
import { isMessageUnread } from '../../util/isMessageUnread';
import { toggleSelectedContactForGroupAddition } from '../../groups/toggleSelectedContactForGroupAddition';
import type { GroupNameCollisionsWithIdsByTitle } from '../../util/groupMemberNameCollisions';
import { ContactSpoofingType } from '../../util/contactSpoofing';
import { writeProfile } from '../../services/writeProfile';
import {
  getConversationServiceIdsStoppingSend,
  getConversationIdsStoppedForVerification,
  getConversationSelector,
  getMe,
  getMessagesByConversation,
} from '../selectors/conversations';
import { getIntl } from '../selectors/user';
import type { AvatarDataType, AvatarUpdateType } from '../../types/Avatar';
import { getDefaultAvatars } from '../../types/Avatar';
import { getAvatarData } from '../../util/getAvatarData';
import { isSameAvatarData } from '../../util/isSameAvatarData';
import { longRunningTaskWrapper } from '../../util/longRunningTaskWrapper';
import {
  ComposerStep,
  ConversationVerificationState,
  OneTimeModalState,
  TargetedMessageSource,
} from './conversationsEnums';
import { markViewed as messageUpdaterMarkViewed } from '../../services/MessageUpdater';
import type { BoundActionCreatorsMapObject } from '../../hooks/useBoundActions';
import { useBoundActions } from '../../hooks/useBoundActions';

import type { NoopActionType } from './noop';
import {
  conversationJobQueue,
  conversationQueueJobEnum,
} from '../../jobs/conversationJobQueue';
import type { TimelineMessageLoadingState } from '../../util/timelineUtil';
import {
  isDirectConversation,
  isGroup,
  isGroupV2,
} from '../../util/whatTypeOfConversation';
import { missingCaseError } from '../../util/missingCaseError';
import { viewSyncJobQueue } from '../../jobs/viewSyncJobQueue';
import { ReadStatus } from '../../messages/MessageReadStatus';
import { isIncoming, processBodyRanges } from '../selectors/message';
import { getActiveCallState } from '../selectors/calling';
import { sendDeleteForEveryoneMessage } from '../../util/sendDeleteForEveryoneMessage';
import type { ShowToastActionType } from './toast';
import { SHOW_TOAST } from './toast';
import { ToastType } from '../../types/Toast';
import { isMemberRequestingToJoin } from '../../util/groupMembershipUtils';
import { removePendingMember } from '../../util/removePendingMember';
import { denyPendingApprovalRequest } from '../../util/denyPendingApprovalRequest';
import { SignalService as Proto } from '../../protobuf';
import { addReportSpamJob } from '../../jobs/helpers/addReportSpamJob';
import { reportSpamJobQueue } from '../../jobs/reportSpamJobQueue';
import {
  modifyGroupV2,
  buildAddMembersChange,
  buildPromotePendingAdminApprovalMemberChange,
  buildUpdateAttributesChange,
  initiateMigrationToGroupV2 as doInitiateMigrationToGroupV2,
} from '../../groups';
import { __DEPRECATED$getMessageById } from '../../messages/getMessageById';
import type { PanelRenderType, PanelRequestType } from '../../types/Panels';
import type { ConversationQueueJobData } from '../../jobs/conversationJobQueue';
import { isOlderThan } from '../../util/timestamp';
import { DAY } from '../../util/durations';
import { isNotNil } from '../../util/isNotNil';
import { PanelType } from '../../types/Panels';
import { startConversation } from '../../util/startConversation';
import { getMessageSentTimestamp } from '../../util/getMessageSentTimestamp';
import { removeLinkPreview } from '../../services/LinkPreview';
import type {
  ReplaceAttachmentsActionType,
  ResetComposerActionType,
  SetFocusActionType,
  SetQuotedMessageActionType,
} from './composer';
import {
  SET_FOCUS,
  replaceAttachments,
  setComposerFocus,
  setQuoteByMessageId,
  resetComposer,
  handleLeaveConversation,
} from './composer';
import { ReceiptType } from '../../types/Receipt';
import { Sound, SoundType } from '../../util/Sound';
import {
  canEditMessage,
  isWithinMaxEdits,
  MESSAGE_MAX_EDIT_COUNT,
} from '../../util/canEditMessage';
import type { ChangeNavTabActionType } from './nav';
import { CHANGE_NAV_TAB, NavTab, actions as navActions } from './nav';
import { sortByMessageOrder } from '../../types/ForwardDraft';

// State

export type DBConversationType = ReadonlyDeep<{
  id: string;
  activeAt?: number;
  lastMessage?: string | null;
  type: string;
}>;

export const InteractionModes = ['mouse', 'keyboard'] as const;
export type InteractionModeType = ReadonlyDeep<typeof InteractionModes[number]>;

export type MessageTimestamps = ReadonlyDeep<
  Pick<MessageAttributesType, 'sent_at' | 'received_at'>
>;

// eslint-disable-next-line local-rules/type-alias-readonlydeep
export type MessageType = MessageAttributesType & {
  interactionType?: InteractionModeType;
};
// eslint-disable-next-line local-rules/type-alias-readonlydeep
export type MessageWithUIFieldsType = MessageAttributesType & {
  displayLimit?: number;
  isSpoilerExpanded?: Record<number, boolean>;
};

export const ConversationTypes = ['direct', 'group'] as const;
export type ConversationTypeType = ReadonlyDeep<
  typeof ConversationTypes[number]
>;

export type LastMessageType = ReadonlyDeep<
  | {
      deletedForEveryone: false;
      author?: string;
      bodyRanges?: HydratedBodyRangesType;
      prefix?: string;
      status?: LastMessageStatus;
      text: string;
    }
  | { deletedForEveryone: true }
>;
export type DraftPreviewType = ReadonlyDeep<{
  text: string;
  prefix?: string;
  bodyRanges?: HydratedBodyRangesType;
}>;

export type ConversationType = ReadonlyDeep<
  {
    id: string;
    serviceId?: ServiceIdString;
    pni?: PniString;
    e164?: string;
    name?: string;
    systemGivenName?: string;
    systemFamilyName?: string;
    systemNickname?: string;
    familyName?: string;
    firstName?: string;
    profileName?: string;
    username?: string;
    about?: string;
    aboutText?: string;
    aboutEmoji?: string;
    avatars?: ReadonlyArray<AvatarDataType>;
    avatarPath?: string;
    avatarHash?: string;
    profileAvatarPath?: string;
    unblurredAvatarPath?: string;
    areWeAdmin?: boolean;
    areWePending?: boolean;
    areWePendingApproval?: boolean;
    canChangeTimer?: boolean;
    canEditGroupInfo?: boolean;
    canAddNewMembers?: boolean;
    color?: AvatarColorType;
    conversationColor?: ConversationColorType;
    customColor?: CustomColorType;
    customColorId?: string;
    discoveredUnregisteredAt?: number;
    hideStory?: boolean;
    isArchived?: boolean;
    isBlocked?: boolean;
    removalStage?: 'justNotification' | 'messageRequest';
    isGroupV1AndDisabled?: boolean;
    isPinned?: boolean;
    isUntrusted?: boolean;
    isVerified?: boolean;
    activeAt?: number;
    timestamp?: number;
    inboxPosition?: number;
    left?: boolean;
    lastMessage?: LastMessageType;
    markedUnread?: boolean;
    phoneNumber?: string;
    membersCount?: number;
    hasMessages?: boolean;
    accessControlAddFromInviteLink?: number;
    accessControlAttributes?: number;
    accessControlMembers?: number;
    announcementsOnly?: boolean;
    announcementsOnlyReady?: boolean;
    expireTimer?: DurationInSeconds;
    memberships?: ReadonlyArray<{
      aci: AciString;
      isAdmin: boolean;
    }>;
    pendingMemberships?: ReadonlyArray<{
      serviceId: ServiceIdString;
      addedByUserId?: AciString;
    }>;
    pendingApprovalMemberships?: ReadonlyArray<{
      aci: AciString;
    }>;
    bannedMemberships?: ReadonlyArray<ServiceIdString>;
    muteExpiresAt?: number;
    dontNotifyForMentionsIfMuted?: boolean;
    isMe: boolean;
    lastUpdated?: number;
    // This is used by the CompositionInput for @mentions
    sortedGroupMembers?: ReadonlyArray<ConversationType>;
    title: string;
    titleNoDefault?: string;
    searchableTitle?: string;
    unreadCount?: number;
    unreadMentionsCount?: number;
    isSelected?: boolean;
    isFetchingUUID?: boolean;
    typingContactIdTimestamps?: Record<string, number>;
    recentMediaItems?: ReadonlyArray<MediaItemType>;
    profileSharing?: boolean;

    shouldShowDraft?: boolean;
    // Full information for re-hydrating composition area
    draftText?: string;
    draftEditMessage?: DraftEditMessageType;
    draftBodyRanges?: DraftBodyRanges;
    // Summary for the left pane
    draftPreview?: DraftPreviewType;

    sharedGroupNames: ReadonlyArray<string>;
    groupDescription?: string;
    groupVersion?: 1 | 2;
    groupId?: string;
    groupLink?: string;
    acceptedMessageRequest: boolean;
    secretParams?: string;
    publicParams?: string;
    profileKey?: string;
    voiceNotePlaybackRate?: number;

    badges: ReadonlyArray<
      | {
          id: string;
        }
      | {
          id: string;
          expiresAt: number;
          isVisible: boolean;
        }
    >;
  } & (
    | {
        type: 'direct';
        storySendMode?: undefined;
        acknowledgedGroupNameCollisions?: undefined;
      }
    | {
        type: 'group';
        storySendMode: StorySendMode;
        acknowledgedGroupNameCollisions: GroupNameCollisionsWithIdsByTitle;
      }
  )
>;
export type ProfileDataType = ReadonlyDeep<
  {
    firstName: string;
  } & Pick<ConversationType, 'aboutEmoji' | 'aboutText' | 'familyName'>
>;

export type ConversationLookupType = ReadonlyDeep<{
  [key: string]: ConversationType;
}>;
export type CustomError = ReadonlyDeep<
  Error & {
    identifier?: string;
    number?: string;
  }
>;

type MessagePointerType = ReadonlyDeep<{
  id: string;
  received_at: number;
  sent_at?: number;
}>;
type MessageMetricsType = ReadonlyDeep<{
  newest?: MessagePointerType;
  oldest?: MessagePointerType;
  oldestUnseen?: MessagePointerType;
  totalUnseen: number;
}>;

// eslint-disable-next-line local-rules/type-alias-readonlydeep
export type MessageLookupType = {
  [key: string]: MessageWithUIFieldsType;
};
export type ConversationMessageType = ReadonlyDeep<{
  isNearBottom?: boolean;
  messageChangeCounter: number;
  messageIds: ReadonlyArray<string>;
  messageLoadingState?: undefined | TimelineMessageLoadingState;
  metrics: MessageMetricsType;
  scrollToMessageId?: string;
  scrollToMessageCounter: number;
}>;

export type MessagesByConversationType = ReadonlyDeep<{
  [key: string]: ConversationMessageType | undefined;
}>;

export type PreJoinConversationType = ReadonlyDeep<{
  avatar?: {
    loading?: boolean;
    url?: string;
  };
  groupDescription?: string;
  memberCount: number;
  title: string;
  approvalRequired: boolean;
}>;

type ComposerGroupCreationState = ReadonlyDeep<{
  groupAvatar: undefined | Uint8Array;
  groupName: string;
  groupExpireTimer: DurationInSeconds;
  maximumGroupSizeModalState: OneTimeModalState;
  recommendedGroupSizeModalState: OneTimeModalState;
  selectedConversationIds: ReadonlyArray<string>;
  userAvatarData: ReadonlyArray<AvatarDataType>;
}>;

type DistributionVerificationData = ReadonlyDeep<{
  serviceIdsNeedingVerification: Array<ServiceIdString>;
}>;

export type ConversationVerificationData = ReadonlyDeep<
  | {
      type: ConversationVerificationState.PendingVerification;
      serviceIdsNeedingVerification: ReadonlyArray<ServiceIdString>;

      byDistributionId?: Record<
        StoryDistributionIdString,
        DistributionVerificationData
      >;
    }
  | {
      type: ConversationVerificationState.VerificationCancelled;
      canceledAt: number;
    }
>;

type VerificationDataByConversation = ReadonlyDeep<
  Record<string, ConversationVerificationData>
>;

type ComposerStateType = ReadonlyDeep<
  | {
      step: ComposerStep.StartDirectConversation;
      searchTerm: string;
      uuidFetchState: UUIDFetchStateType;
    }
  | ({
      step: ComposerStep.ChooseGroupMembers;
      searchTerm: string;
      uuidFetchState: UUIDFetchStateType;
    } & ComposerGroupCreationState)
  | ({
      step: ComposerStep.SetGroupMetadata;
      isEditingAvatar: boolean;
    } & ComposerGroupCreationState &
      (
        | { isCreating: false; hasError: boolean }
        | { isCreating: true; hasError: false }
      ))
>;

type ContactSpoofingReviewStateType = ReadonlyDeep<
  | {
      type: ContactSpoofingType.DirectConversationWithSameTitle;
      safeConversationId: string;
    }
  | {
      type: ContactSpoofingType.MultipleGroupMembersWithSameTitle;
      groupConversationId: string;
    }
>;

// eslint-disable-next-line local-rules/type-alias-readonlydeep -- FIXME
export type ConversationsStateType = Readonly<{
  preJoinConversation?: PreJoinConversationType;
  invitedServiceIdsForNewlyCreatedGroup?: ReadonlyArray<ServiceIdString>;
  conversationLookup: ConversationLookupType;
  conversationsByE164: ConversationLookupType;
  conversationsByServiceId: ConversationLookupType;
  conversationsByGroupId: ConversationLookupType;
  conversationsByUsername: ConversationLookupType;
  selectedConversationId?: string;
  targetedMessage: string | undefined;
  targetedMessageCounter: number;
  targetedMessageSource: TargetedMessageSource | undefined;
  targetedConversationPanels: {
    isAnimating: boolean;
    wasAnimated: boolean;
    direction: 'push' | 'pop' | undefined;
    stack: ReadonlyArray<PanelRenderType>;
    watermark: number;
  };
  targetedMessageForDetails?: MessageAttributesType;

  lastSelectedMessage: MessageTimestamps | undefined;
  selectedMessageIds: ReadonlyArray<string> | undefined;

  showArchived: boolean;
  composer?: ComposerStateType;
  contactSpoofingReview?: ContactSpoofingReviewStateType;

  /**
   * Each key is a conversation ID. Each value is a value representing the state of
   * verification: either a set of pending conversationIds to be approved, or a tombstone
   * telling jobs to cancel themselves up to that timestamp.
   */
  verificationDataByConversation: VerificationDataByConversation;

  // Note: it's very important that both of these locations are always kept up to date
  messagesLookup: MessageLookupType;
  messagesByConversation: MessagesByConversationType;
}>;

// Helpers

export const getConversationCallMode = (
  conversation: ConversationType
): CallMode | null => {
  if (
    conversation.left ||
    conversation.isBlocked ||
    conversation.isMe ||
    !conversation.acceptedMessageRequest
  ) {
    return null;
  }

  if (conversation.type === 'direct') {
    return CallMode.Direct;
  }

  if (conversation.type === 'group' && conversation.groupVersion === 2) {
    return CallMode.Group;
  }

  return null;
};

// Actions

const CANCEL_CONVERSATION_PENDING_VERIFICATION =
  'conversations/CANCEL_CONVERSATION_PENDING_VERIFICATION';
const CLEAR_CANCELLED_VERIFICATION =
  'conversations/CLEAR_CANCELLED_VERIFICATION';
const CLEAR_CONVERSATIONS_PENDING_VERIFICATION =
  'conversations/CLEAR_CONVERSATIONS_PENDING_VERIFICATION';
export const COLORS_CHANGED = 'conversations/COLORS_CHANGED';
export const COLOR_SELECTED = 'conversations/COLOR_SELECTED';
const COMPOSE_TOGGLE_EDITING_AVATAR =
  'conversations/compose/COMPOSE_TOGGLE_EDITING_AVATAR';
const COMPOSE_ADD_AVATAR = 'conversations/compose/ADD_AVATAR';
const COMPOSE_REMOVE_AVATAR = 'conversations/compose/REMOVE_AVATAR';
const COMPOSE_REPLACE_AVATAR = 'conversations/compose/REPLACE_AVATAR';
const CUSTOM_COLOR_REMOVED = 'conversations/CUSTOM_COLOR_REMOVED';
const CONVERSATION_STOPPED_BY_MISSING_VERIFICATION =
  'conversations/CONVERSATION_STOPPED_BY_MISSING_VERIFICATION';
const DISCARD_MESSAGES = 'conversations/DISCARD_MESSAGES';
const REPLACE_AVATARS = 'conversations/REPLACE_AVATARS';
export const TARGETED_CONVERSATION_CHANGED =
  'conversations/TARGETED_CONVERSATION_CHANGED';
const PUSH_PANEL = 'conversations/PUSH_PANEL';
const POP_PANEL = 'conversations/POP_PANEL';
const PANEL_ANIMATION_DONE = 'conversations/PANEL_ANIMATION_DONE';
const PANEL_ANIMATION_STARTED = 'conversations/PANEL_ANIMATION_STARTED';
export const MESSAGE_CHANGED = 'MESSAGE_CHANGED';
export const MESSAGE_DELETED = 'MESSAGE_DELETED';
export const MESSAGE_EXPIRED = 'conversations/MESSAGE_EXPIRED';
export const SET_VOICE_NOTE_PLAYBACK_RATE =
  'conversations/SET_VOICE_NOTE_PLAYBACK_RATE';
export const CONVERSATION_UNLOADED = 'CONVERSATION_UNLOADED';
export const SHOW_SPOILER = 'conversations/SHOW_SPOILER';

export type CancelVerificationDataByConversationActionType = ReadonlyDeep<{
  type: typeof CANCEL_CONVERSATION_PENDING_VERIFICATION;
  payload: {
    canceledAt: number;
  };
}>;
type ClearGroupCreationErrorActionType = ReadonlyDeep<{
  type: 'CLEAR_GROUP_CREATION_ERROR';
}>;
type ClearInvitedServiceIdsForNewlyCreatedGroupActionType = ReadonlyDeep<{
  type: 'CLEAR_INVITED_SERVICE_IDS_FOR_NEWLY_CREATED_GROUP';
}>;
type ClearVerificationDataByConversationActionType = ReadonlyDeep<{
  type: typeof CLEAR_CONVERSATIONS_PENDING_VERIFICATION;
}>;
type ClearCancelledVerificationActionType = ReadonlyDeep<{
  type: typeof CLEAR_CANCELLED_VERIFICATION;
  payload: {
    conversationId: string;
  };
}>;
type CloseContactSpoofingReviewActionType = ReadonlyDeep<{
  type: 'CLOSE_CONTACT_SPOOFING_REVIEW';
}>;
type CloseMaximumGroupSizeModalActionType = ReadonlyDeep<{
  type: 'CLOSE_MAXIMUM_GROUP_SIZE_MODAL';
}>;
type CloseRecommendedGroupSizeModalActionType = ReadonlyDeep<{
  type: 'CLOSE_RECOMMENDED_GROUP_SIZE_MODAL';
}>;
type ColorsChangedActionType = ReadonlyDeep<{
  type: typeof COLORS_CHANGED;
  payload: {
    conversationColor?: ConversationColorType;
    customColorData?: {
      id: string;
      value: CustomColorType;
    };
  };
}>;
type ColorSelectedPayloadType = ReadonlyDeep<{
  conversationId: string;
  conversationColor?: ConversationColorType;
  customColorData?: {
    id: string;
    value: CustomColorType;
  };
}>;
export type ColorSelectedActionType = ReadonlyDeep<{
  type: typeof COLOR_SELECTED;
  payload: ColorSelectedPayloadType;
}>;
type ComposeDeleteAvatarActionType = ReadonlyDeep<{
  type: typeof COMPOSE_REMOVE_AVATAR;
  payload: AvatarDataType;
}>;
type ComposeReplaceAvatarsActionType = ReadonlyDeep<{
  type: typeof COMPOSE_REPLACE_AVATAR;
  payload: {
    curr: AvatarDataType;
    prev?: AvatarDataType;
  };
}>;
type ComposeSaveAvatarActionType = ReadonlyDeep<{
  type: typeof COMPOSE_ADD_AVATAR;
  payload: AvatarDataType;
}>;
type CustomColorRemovedActionType = ReadonlyDeep<{
  type: typeof CUSTOM_COLOR_REMOVED;
  payload: {
    colorId: string;
  };
}>;
type DiscardMessagesActionType = ReadonlyDeep<{
  type: typeof DISCARD_MESSAGES;
  payload: Readonly<
    | {
        conversationId: string;
        numberToKeepAtBottom: number;
      }
    | { conversationId: string; numberToKeepAtTop: number }
  >;
}>;
type SetPreJoinConversationActionType = ReadonlyDeep<{
  type: 'SET_PRE_JOIN_CONVERSATION';
  payload: {
    data: PreJoinConversationType | undefined;
  };
}>;

type ConversationAddedActionType = ReadonlyDeep<{
  type: 'CONVERSATION_ADDED';
  payload: {
    id: string;
    data: ConversationType;
  };
}>;
export type ConversationChangedActionType = ReadonlyDeep<{
  type: 'CONVERSATION_CHANGED';
  payload: {
    id: string;
    data: ConversationType;
  };
}>;
export type ConversationRemovedActionType = ReadonlyDeep<{
  type: 'CONVERSATION_REMOVED';
  payload: {
    id: string;
  };
}>;
export type ConversationUnloadedActionType = ReadonlyDeep<{
  type: typeof CONVERSATION_UNLOADED;
  payload: {
    conversationId: string;
  };
}>;
type CreateGroupPendingActionType = ReadonlyDeep<{
  type: 'CREATE_GROUP_PENDING';
}>;
type CreateGroupFulfilledActionType = ReadonlyDeep<{
  type: 'CREATE_GROUP_FULFILLED';
  payload: {
    invitedServiceIds: ReadonlyArray<ServiceIdString>;
  };
}>;
type CreateGroupRejectedActionType = ReadonlyDeep<{
  type: 'CREATE_GROUP_REJECTED';
}>;
export type RemoveAllConversationsActionType = ReadonlyDeep<{
  type: 'CONVERSATIONS_REMOVE_ALL';
  payload: null;
}>;
export type MessageTargetedActionType = ReadonlyDeep<{
  type: 'MESSAGE_TARGETED';
  payload: {
    messageId: string;
    conversationId: string;
  };
}>;
export type ToggleSelectMessagesActionType = ReadonlyDeep<{
  type: 'TOGGLE_SELECT_MESSAGES';
  payload: {
    toggledMessageId: string;
    messageIds: Array<string>;
    selected: boolean;
  };
}>;
export type ToggleSelectModeActionType = ReadonlyDeep<{
  type: 'TOGGLE_SELECT_MODE';
  payload: {
    on: boolean;
  };
}>;
type ConversationStoppedByMissingVerificationActionType = ReadonlyDeep<{
  type: typeof CONVERSATION_STOPPED_BY_MISSING_VERIFICATION;
  payload: {
    conversationId: string;
    distributionId?: StoryDistributionIdString;
    untrustedServiceIds: ReadonlyArray<ServiceIdString>;
  };
}>;
// eslint-disable-next-line local-rules/type-alias-readonlydeep -- FIXME
export type MessageChangedActionType = {
  type: typeof MESSAGE_CHANGED;
  payload: {
    id: string;
    conversationId: string;
    data: MessageAttributesType;
  };
};
export type MessageDeletedActionType = ReadonlyDeep<{
  type: typeof MESSAGE_DELETED;
  payload: {
    id: string;
    conversationId: string;
  };
}>;
export type MessageExpandedActionType = ReadonlyDeep<{
  type: 'MESSAGE_EXPANDED';
  payload: {
    id: string;
    displayLimit: number;
  };
}>;
export type ShowSpoilerActionType = ReadonlyDeep<{
  type: typeof SHOW_SPOILER;
  payload: {
    id: string;
    data: Record<number, boolean>;
  };
}>;

// eslint-disable-next-line local-rules/type-alias-readonlydeep -- FIXME
export type MessagesAddedActionType = Readonly<{
  type: 'MESSAGES_ADDED';
  payload: {
    conversationId: string;
    isActive: boolean;
    isJustSent: boolean;
    isNewMessage: boolean;
    messages: ReadonlyArray<MessageAttributesType>;
  };
}>;

export type MessageExpiredActionType = ReadonlyDeep<{
  type: typeof MESSAGE_EXPIRED;
  payload: {
    id: string;
  };
}>;

export type RepairNewestMessageActionType = ReadonlyDeep<{
  type: 'REPAIR_NEWEST_MESSAGE';
  payload: {
    conversationId: string;
  };
}>;
export type RepairOldestMessageActionType = ReadonlyDeep<{
  type: 'REPAIR_OLDEST_MESSAGE';
  payload: {
    conversationId: string;
  };
}>;
// eslint-disable-next-line local-rules/type-alias-readonlydeep
export type MessagesResetActionType = {
  type: 'MESSAGES_RESET';
  payload: {
    conversationId: string;
    messages: ReadonlyArray<MessageAttributesType>;
    metrics: MessageMetricsType;
    scrollToMessageId?: string;
    // The set of provided messages should be trusted, even if it conflicts with metrics,
    //   because we weren't looking for a specific time window of messages with our query.
    unboundedFetch: boolean;
  };
};
export type SetMessageLoadingStateActionType = ReadonlyDeep<{
  type: 'SET_MESSAGE_LOADING_STATE';
  payload: {
    conversationId: string;
    messageLoadingState: undefined | TimelineMessageLoadingState;
  };
}>;
export type SetIsNearBottomActionType = ReadonlyDeep<{
  type: 'SET_NEAR_BOTTOM';
  payload: {
    conversationId: string;
    isNearBottom: boolean;
  };
}>;
export type ScrollToMessageActionType = ReadonlyDeep<{
  type: 'SCROLL_TO_MESSAGE';
  payload: {
    conversationId: string;
    messageId: string;
  };
}>;
export type ClearTargetedMessageActionType = ReadonlyDeep<{
  type: 'CLEAR_TARGETED_MESSAGE';
  payload: null;
}>;
export type ClearUnreadMetricsActionType = ReadonlyDeep<{
  type: 'CLEAR_UNREAD_METRICS';
  payload: {
    conversationId: string;
  };
}>;
export type TargetedConversationChangedActionType = ReadonlyDeep<{
  type: typeof TARGETED_CONVERSATION_CHANGED;
  payload: {
    conversationId?: string;
    messageId?: string;
    switchToAssociatedView?: boolean;
  };
}>;
type ReviewGroupMemberNameCollisionActionType = ReadonlyDeep<{
  type: 'REVIEW_GROUP_MEMBER_NAME_COLLISION';
  payload: {
    groupConversationId: string;
  };
}>;
type ReviewMessageRequestNameCollisionActionType = ReadonlyDeep<{
  type: 'REVIEW_MESSAGE_REQUEST_NAME_COLLISION';
  payload: {
    safeConversationId: string;
  };
}>;
type ShowInboxActionType = ReadonlyDeep<{
  type: 'SHOW_INBOX';
  payload: null;
}>;
export type ShowArchivedConversationsActionType = ReadonlyDeep<{
  type: 'SHOW_ARCHIVED_CONVERSATIONS';
  payload: null;
}>;
type SetComposeGroupAvatarActionType = ReadonlyDeep<{
  type: 'SET_COMPOSE_GROUP_AVATAR';
  payload: { groupAvatar: undefined | Uint8Array };
}>;
type SetComposeGroupNameActionType = ReadonlyDeep<{
  type: 'SET_COMPOSE_GROUP_NAME';
  payload: { groupName: string };
}>;
type SetComposeGroupExpireTimerActionType = ReadonlyDeep<{
  type: 'SET_COMPOSE_GROUP_EXPIRE_TIMER';
  payload: { groupExpireTimer: DurationInSeconds };
}>;
type SetComposeSearchTermActionType = ReadonlyDeep<{
  type: 'SET_COMPOSE_SEARCH_TERM';
  payload: { searchTerm: string };
}>;
type SetIsFetchingUUIDActionType = ReadonlyDeep<{
  type: 'SET_IS_FETCHING_UUID';
  payload: {
    identifier: UUIDFetchStateKeyType;
    isFetching: boolean;
  };
}>;
type SetRecentMediaItemsActionType = ReadonlyDeep<{
  type: 'SET_RECENT_MEDIA_ITEMS';
  payload: {
    id: string;
    recentMediaItems: ReadonlyArray<MediaItemType>;
  };
}>;
type ToggleComposeEditingAvatarActionType = ReadonlyDeep<{
  type: typeof COMPOSE_TOGGLE_EDITING_AVATAR;
}>;
type StartComposingActionType = ReadonlyDeep<{
  type: 'START_COMPOSING';
}>;
type ShowChooseGroupMembersActionType = ReadonlyDeep<{
  type: 'SHOW_CHOOSE_GROUP_MEMBERS';
}>;
type StartSettingGroupMetadataActionType = ReadonlyDeep<{
  type: 'START_SETTING_GROUP_METADATA';
}>;
export type ToggleConversationInChooseMembersActionType = ReadonlyDeep<{
  type: 'TOGGLE_CONVERSATION_IN_CHOOSE_MEMBERS';
  payload: {
    conversationId: string;
    maxRecommendedGroupSize: number;
    maxGroupSize: number;
  };
}>;

// eslint-disable-next-line local-rules/type-alias-readonlydeep -- FIXME
type PushPanelActionType = Readonly<{
  type: typeof PUSH_PANEL;
  payload: PanelRenderType;
}>;
type PopPanelActionType = ReadonlyDeep<{
  type: typeof POP_PANEL;
  payload: null;
}>;
type PanelAnimationDoneActionType = ReadonlyDeep<{
  type: typeof PANEL_ANIMATION_DONE;
  payload: null;
}>;
type PanelAnimationStartedActionType = ReadonlyDeep<{
  type: typeof PANEL_ANIMATION_STARTED;
  payload: null;
}>;

type ReplaceAvatarsActionType = ReadonlyDeep<{
  type: typeof REPLACE_AVATARS;
  payload: {
    conversationId: string;
    avatars: ReadonlyArray<AvatarDataType>;
  };
}>;

// eslint-disable-next-line local-rules/type-alias-readonlydeep -- FIXME
export type ConversationActionType =
  | CancelVerificationDataByConversationActionType
  | ClearCancelledVerificationActionType
  | ClearGroupCreationErrorActionType
  | ClearInvitedServiceIdsForNewlyCreatedGroupActionType
  | ClearTargetedMessageActionType
  | ClearUnreadMetricsActionType
  | ClearVerificationDataByConversationActionType
  | CloseContactSpoofingReviewActionType
  | CloseMaximumGroupSizeModalActionType
  | CloseRecommendedGroupSizeModalActionType
  | ColorSelectedActionType
  | ColorsChangedActionType
  | ComposeDeleteAvatarActionType
  | ComposeReplaceAvatarsActionType
  | ComposeSaveAvatarActionType
  | ConversationAddedActionType
  | ConversationChangedActionType
  | ConversationRemovedActionType
  | ConversationStoppedByMissingVerificationActionType
  | ConversationUnloadedActionType
  | CreateGroupFulfilledActionType
  | CreateGroupPendingActionType
  | CreateGroupRejectedActionType
  | CustomColorRemovedActionType
  | DiscardMessagesActionType
  | MessageChangedActionType
  | MessageDeletedActionType
  | MessageExpandedActionType
  | MessageExpiredActionType
  | MessageTargetedActionType
  | MessagesAddedActionType
  | MessagesResetActionType
  | PanelAnimationStartedActionType
  | PanelAnimationDoneActionType
  | PopPanelActionType
  | PushPanelActionType
  | RemoveAllConversationsActionType
  | RepairNewestMessageActionType
  | RepairOldestMessageActionType
  | ReplaceAvatarsActionType
  | ReviewGroupMemberNameCollisionActionType
  | ReviewMessageRequestNameCollisionActionType
  | ScrollToMessageActionType
  | TargetedConversationChangedActionType
  | SetComposeGroupAvatarActionType
  | SetComposeGroupExpireTimerActionType
  | SetComposeGroupNameActionType
  | SetComposeSearchTermActionType
  | SetIsFetchingUUIDActionType
  | SetIsNearBottomActionType
  | SetMessageLoadingStateActionType
  | SetPreJoinConversationActionType
  | SetRecentMediaItemsActionType
  | ShowArchivedConversationsActionType
  | ShowChooseGroupMembersActionType
  | ShowInboxActionType
  | ShowSendAnywayDialogActionType
  | ShowSpoilerActionType
  | StartComposingActionType
  | StartSettingGroupMetadataActionType
  | ToggleComposeEditingAvatarActionType
  | ToggleConversationInChooseMembersActionType
  | ToggleSelectMessagesActionType
  | ToggleSelectModeActionType;

// Action Creators

export const actions = {
  onConversationOpened,
  onConversationClosed,
  acceptConversation,
  acknowledgeGroupMemberNameCollisions,
  addMembersToGroup,
  approvePendingMembershipFromGroupV2,
  blockAndReportSpam,
  blockConversation,
  blockGroupLinkRequests,
  cancelConversationVerification,
  changeHasGroupLink,
  clearCancelledConversationVerification,
  clearGroupCreationError,
  clearInvitedServiceIdsForNewlyCreatedGroup,
  clearTargetedMessage,
  clearUnreadMetrics,
  closeContactSpoofingReview,
  closeMaximumGroupSizeModal,
  closeRecommendedGroupSizeModal,
  colorSelected,
  composeDeleteAvatarFromDisk,
  composeReplaceAvatar,
  composeSaveAvatarToDisk,
  conversationAdded,
  conversationChanged,
  conversationRemoved,
  conversationStoppedByMissingVerification,
  createGroup,
  deleteAvatarFromDisk,
  deleteConversation,
  deleteMessages,
  deleteMessagesForEveryone,
  destroyMessages,
  discardEditMessage,
  discardMessages,
  doubleCheckMissingQuoteReference,
  generateNewGroupLink,
  getProfilesForConversation,
  initiateMigrationToGroupV2,
  kickOffAttachmentDownload,
  leaveGroup,
  loadNewerMessages,
  loadNewestMessages,
  loadOlderMessages,
  loadRecentMediaItems,
  markAttachmentAsCorrupted,
  markMessageRead,
  messageChanged,
  messageDeleted,
  messageExpanded,
  messageExpired,
  messagesAdded,
  messagesReset,
  myProfileChanged,
  onArchive,
  onMarkUnread,
  onMoveToInbox,
  onUndoArchive,
  openGiftBadge,
  popPanelForConversation,
  pushPanelForConversation,
  panelAnimationDone,
  panelAnimationStarted,
  removeAllConversations,
  removeConversation,
  removeCustomColorOnConversations,
  removeMember,
  removeMemberFromGroup,
  repairNewestMessage,
  repairOldestMessage,
  replaceAvatar,
  resetAllChatColors,
  copyMessageText,
  retryDeleteForEveryone,
  retryMessageSend,
  reviewGroupMemberNameCollision,
  reviewMessageRequestNameCollision,
  revokePendingMembershipsFromGroupV2,
  saveAttachment,
  saveAttachmentFromMessage,
  saveAvatarToDisk,
  scrollToMessage,
  scrollToOldestUnreadMention,
  showSpoiler,
  targetMessage,
  setAccessControlAddFromInviteLinkSetting,
  setAccessControlAttributesSetting,
  setAccessControlMembersSetting,
  setAnnouncementsOnly,
  setComposeGroupAvatar,
  setComposeGroupExpireTimer,
  setComposeGroupName,
  setComposeSearchTerm,
  setDisappearingMessages,
  setDontNotifyForMentionsIfMuted,
  setIsFetchingUUID,
  setIsNearBottom,
  setMessageLoadingState,
  setMessageToEdit,
  setMuteExpiration,
  setPinned,
  setPreJoinConversation,
  setVoiceNotePlaybackRate,
  showArchivedConversations,
  showChooseGroupMembers,
  showConversation,
  showExpiredIncomingTapToViewToast,
  showExpiredOutgoingTapToViewToast,
  showInbox,
  startComposing,
  startConversation,
  startSettingGroupMetadata,
  toggleAdmin,
  toggleComposeEditingAvatar,
  toggleConversationInChooseMembers,
  toggleGroupsForStorySend,
  toggleHideStories,
  toggleSelectMessage,
  toggleSelectMode,
  unblurAvatar,
  updateConversationModelSharedGroups,
  updateGroupAttributes,
  updateLastMessage,
  updateSharedGroups,
  verifyConversationsStoppingSend,
};

export const useConversationsActions = (): BoundActionCreatorsMapObject<
  typeof actions
> => useBoundActions(actions);

function onArchive(
  conversationId: string
): ThunkAction<
  void,
  RootStateType,
  unknown,
  ConversationUnloadedActionType | ShowToastActionType
> {
  return (dispatch, getState) => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('onArchive: Conversation not found!');
    }

    conversation.setArchived(true);

    onConversationClosed(conversationId, 'archive')(
      dispatch,
      getState,
      undefined
    );

    dispatch({
      type: SHOW_TOAST,
      payload: {
        toastType: ToastType.ConversationArchived,
        parameters: {
          conversationId,
        },
      },
    });
  };
}
function onUndoArchive(
  conversationId: string
): ThunkAction<
  void,
  RootStateType,
  unknown,
  TargetedConversationChangedActionType
> {
  return (dispatch, getState) => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('onUndoArchive: Conversation not found!');
    }

    conversation.setArchived(false);
    showConversation({
      conversationId,
    })(dispatch, getState, null);
  };
}

function onMarkUnread(conversationId: string): ShowToastActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('onMarkUnread: Conversation not found!');
  }

  conversation.setMarkedUnread(true);

  return {
    type: SHOW_TOAST,
    payload: {
      toastType: ToastType.ConversationMarkedUnread,
    },
  };
}
function onMoveToInbox(conversationId: string): ShowToastActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('onMoveToInbox: Conversation not found!');
  }

  conversation.setArchived(false);

  return {
    type: SHOW_TOAST,
    payload: {
      toastType: ToastType.ConversationUnarchived,
    },
  };
}

function acknowledgeGroupMemberNameCollisions(
  conversationId: string,
  groupNameCollisions: ReadonlyDeep<GroupNameCollisionsWithIdsByTitle>
): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error(
      'acknowledgeGroupMemberNameCollisions: Conversation not found!'
    );
  }

  conversation.acknowledgeGroupMemberNameCollisions(groupNameCollisions);

  return {
    type: 'NOOP',
    payload: null,
  };
}
function blockGroupLinkRequests(
  conversationId: string,
  serviceId: ServiceIdString
): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('blockGroupLinkRequests: Conversation not found!');
  }

  void conversation.blockGroupLinkRequests(serviceId);

  return {
    type: 'NOOP',
    payload: null,
  };
}
function loadNewerMessages(
  conversationId: string,
  newestMessageId: string
): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('loadNewerMessages: Conversation not found!');
  }

  void conversation.loadNewerMessages(newestMessageId);

  return {
    type: 'NOOP',
    payload: null,
  };
}
function loadNewestMessages(
  conversationId: string,
  newestMessageId: string | undefined,
  setFocus: boolean | undefined
): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('loadNewestMessages: Conversation not found!');
  }

  void conversation.loadNewestMessages(newestMessageId, setFocus);

  return {
    type: 'NOOP',
    payload: null,
  };
}

function loadOlderMessages(
  conversationId: string,
  oldestMessageId: string
): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('loadOlderMessages: Conversation not found!');
  }

  void conversation.loadOlderMessages(oldestMessageId);
  return {
    type: 'NOOP',
    payload: null,
  };
}

function markMessageRead(
  conversationId: string,
  messageId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async (_dispatch, getState) => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('markMessageRead: Conversation not found!');
    }

    if (!window.SignalContext.activeWindowService.isActive()) {
      return;
    }

    const activeCall = getActiveCallState(getState());
    if (activeCall && !activeCall.pip) {
      return;
    }

    const message = await __DEPRECATED$getMessageById(messageId);
    if (!message) {
      throw new Error(`markMessageRead: failed to load message ${messageId}`);
    }

    await conversation.markRead(message.get('received_at'), {
      newestSentAt: message.get('sent_at'),
      sendReadReceipts: true,
    });
  };
}

function removeMember(
  conversationId: string,
  memberConversationId: string
): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('removeMember: Conversation not found!');
  }

  void longRunningTaskWrapper({
    idForLogging: conversation.idForLogging(),
    name: 'removeMember',
    task: () => conversation.removeFromGroupV2(memberConversationId),
  });

  return {
    type: 'NOOP',
    payload: null,
  };
}
function unblurAvatar(conversationId: string): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('unblurAvatar: Conversation not found!');
  }

  conversation.unblurAvatar();

  return {
    type: 'NOOP',
    payload: null,
  };
}
function updateSharedGroups(conversationId: string): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('updateSharedGroups: Conversation not found!');
  }

  void conversation.throttledUpdateSharedGroups?.();

  return {
    type: 'NOOP',
    payload: null,
  };
}

function filterAvatarData(
  avatars: ReadonlyArray<AvatarDataType>,
  data: AvatarDataType
): Array<AvatarDataType> {
  return avatars.filter(avatarData => !isSameAvatarData(data, avatarData));
}

function getNextAvatarId(avatars: ReadonlyArray<AvatarDataType>): number {
  return Math.max(...avatars.map(x => Number(x.id))) + 1;
}

async function getAvatarsAndUpdateConversation(
  conversations: ConversationsStateType,
  conversationId: string,
  getNextAvatarsData: (
    avatars: ReadonlyArray<AvatarDataType>,
    nextId: number
  ) => ReadonlyArray<AvatarDataType>
): Promise<ReadonlyArray<AvatarDataType>> {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('getAvatarsAndUpdateConversation: No conversation found');
  }

  const { conversationLookup } = conversations;
  const conversationAttrs = conversationLookup[conversationId];
  const avatars =
    conversationAttrs.avatars || getAvatarData(conversation.attributes);

  const nextAvatarId = getNextAvatarId(avatars);
  const nextAvatars = getNextAvatarsData(avatars, nextAvatarId);
  // We don't save buffers to the db, but we definitely want it in-memory so
  // we don't have to re-generate them.
  //
  // Mutating here because we don't want to trigger a model change
  // because we're updating redux here manually ourselves. Au revoir Backbone!
  conversation.attributes.avatars = nextAvatars.map(avatarData =>
    omit(avatarData, ['buffer'])
  );
  window.Signal.Data.updateConversation(conversation.attributes);

  return nextAvatars;
}

function deleteAvatarFromDisk(
  avatarData: AvatarDataType,
  conversationId?: string
): ThunkAction<void, RootStateType, unknown, ReplaceAvatarsActionType> {
  return async (dispatch, getState) => {
    if (avatarData.imagePath) {
      await window.Signal.Migrations.deleteAvatar(avatarData.imagePath);
    } else {
      log.info(
        'No imagePath for avatarData. Removing from userAvatarData, but not disk'
      );
    }

    strictAssert(conversationId, 'conversationId not provided');

    const avatars = await getAvatarsAndUpdateConversation(
      getState().conversations,
      conversationId,
      prevAvatarsData => filterAvatarData(prevAvatarsData, avatarData)
    );

    dispatch({
      type: REPLACE_AVATARS,
      payload: {
        conversationId,
        avatars,
      },
    });
  };
}

function changeHasGroupLink(
  conversationId: string,
  value: boolean
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('changeHasGroupLink: No conversation found');
    }

    await longRunningTaskWrapper({
      name: 'toggleGroupLink',
      idForLogging: conversation.idForLogging(),
      task: async () => conversation.toggleGroupLink(value),
    });
    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function setAnnouncementsOnly(
  conversationId: string,
  value: boolean
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('setAnnouncementsOnly: No conversation found');
    }

    await longRunningTaskWrapper({
      name: 'updateAnnouncementsOnly',
      idForLogging: conversation.idForLogging(),
      task: async () => conversation.updateAnnouncementsOnly(value),
    });
    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function setAccessControlMembersSetting(
  conversationId: string,
  value: number
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('setAccessControlMembersSetting: No conversation found');
    }

    await longRunningTaskWrapper({
      name: 'updateAccessControlMembers',
      idForLogging: conversation.idForLogging(),
      task: async () => conversation.updateAccessControlMembers(value),
    });
    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function setAccessControlAttributesSetting(
  conversationId: string,
  value: number
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error(
        'setAccessControlAttributesSetting: No conversation found'
      );
    }

    await longRunningTaskWrapper({
      name: 'updateAccessControlAttributes',
      idForLogging: conversation.idForLogging(),
      task: async () => conversation.updateAccessControlAttributes(value),
    });
    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function setDisappearingMessages(
  conversationId: string,
  seconds: DurationInSeconds
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('setDisappearingMessages: No conversation found');
    }

    const valueToSet = seconds > 0 ? seconds : undefined;

    await longRunningTaskWrapper({
      name: 'updateExpirationTimer',
      idForLogging: conversation.idForLogging(),
      task: async () =>
        conversation.updateExpirationTimer(valueToSet, {
          reason: 'setDisappearingMessages',
        }),
    });
    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function setDontNotifyForMentionsIfMuted(
  conversationId: string,
  newValue: boolean
): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('setDontNotifyForMentionsIfMuted: No conversation found');
  }

  conversation.setDontNotifyForMentionsIfMuted(newValue);

  return {
    type: 'NOOP',
    payload: null,
  };
}

function setMuteExpiration(
  conversationId: string,
  muteExpiresAt = 0
): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('setMuteExpiration: No conversation found');
  }

  conversation.setMuteExpiration(
    muteExpiresAt >= Number.MAX_SAFE_INTEGER
      ? muteExpiresAt
      : Date.now() + muteExpiresAt
  );

  return {
    type: 'NOOP',
    payload: null,
  };
}

function setPinned(
  conversationId: string,
  value: boolean
): NoopActionType | ShowToastActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('setPinned: No conversation found');
  }

  if (value) {
    const pinnedConversationIds = window.storage.get(
      'pinnedConversationIds',
      new Array<string>()
    );

    if (pinnedConversationIds.length >= 4) {
      return {
        type: SHOW_TOAST,
        payload: {
          toastType: ToastType.PinnedConversationsFull,
        },
      };
    }
    conversation.pin();
  } else {
    conversation.unpin();
  }

  return {
    type: 'NOOP',
    payload: null,
  };
}

function deleteMessages({
  conversationId,
  messageIds,
  lastSelectedMessage,
}: {
  conversationId: string;
  messageIds: ReadonlyArray<string>;
  lastSelectedMessage?: MessageTimestamps;
}): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async (dispatch, getState) => {
    if (!messageIds || messageIds.length === 0) {
      log.warn('deleteMessages: No message ids provided');
      return;
    }

    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('deleteMessage: No conversation found');
    }

    await Promise.all(
      messageIds.map(async messageId => {
        const message = await __DEPRECATED$getMessageById(messageId);
        if (!message) {
          throw new Error(`deleteMessages: Message ${messageId} missing!`);
        }

        const messageConversationId = message.get('conversationId');
        if (conversationId !== messageConversationId) {
          throw new Error(
            `deleteMessages: message conversation ${messageConversationId} doesn't match provided conversation ${conversationId}`
          );
        }
      })
    );

    let nearbyMessageId: string | null = null;

    if (nearbyMessageId == null && lastSelectedMessage != null) {
      const foundMessageId =
        await window.Signal.Data.getNearbyMessageFromDeletedSet({
          conversationId,
          lastSelectedMessage,
          deletedMessageIds: messageIds,
          includeStoryReplies: false,
          storyId: undefined,
        });

      if (foundMessageId != null) {
        nearbyMessageId = foundMessageId;
      }
    }

    await window.Signal.Data.removeMessages(messageIds);

    popPanelForConversation()(dispatch, getState, undefined);

    if (nearbyMessageId != null) {
      dispatch(scrollToMessage(conversationId, nearbyMessageId));
    }
  };
}

function destroyMessages(
  conversationId: string
): ThunkAction<
  void,
  RootStateType,
  unknown,
  ConversationUnloadedActionType | NoopActionType
> {
  return async (dispatch, getState) => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('destroyMessages: No conversation found');
    }

    await longRunningTaskWrapper({
      name: 'destroymessages',
      idForLogging: conversation.idForLogging(),
      task: async () => {
        onConversationClosed(conversationId, 'delete messages')(
          dispatch,
          getState,
          undefined
        );

        await conversation.destroyMessages();
        drop(conversation.updateLastMessage());
      },
    });

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function discardEditMessage(
  conversationId: string
): ThunkAction<void, RootStateType, unknown, never> {
  return () => {
    window.ConversationController.get(conversationId)?.set(
      {
        draftEditMessage: undefined,
        draftBodyRanges: undefined,
        draft: undefined,
        quotedMessageId: undefined,
      },
      { unset: true }
    );
  };
}

function setMessageToEdit(
  conversationId: string,
  messageId: string
): ThunkAction<
  void,
  RootStateType,
  unknown,
  SetFocusActionType | ShowErrorModalActionType
> {
  return async (dispatch, getState) => {
    const conversation = window.ConversationController.get(conversationId);

    if (!conversation) {
      return;
    }

    const message = (await __DEPRECATED$getMessageById(messageId))?.attributes;
    if (!message) {
      return;
    }

    if (!canEditMessage(message) || !message.body) {
      return;
    }

    if (!isWithinMaxEdits(message)) {
      const i18n = getIntl(getState());
      dispatch({
        type: SHOW_ERROR_MODAL,
        payload: {
          title: i18n('icu:MessageMaxEditsModal__Title'),
          description: i18n('icu:MessageMaxEditsModal__Description', {
            max: MESSAGE_MAX_EDIT_COUNT,
          }),
        },
      });
      return;
    }

    setQuoteByMessageId(conversationId, undefined)(
      dispatch,
      getState,
      undefined
    );

    let attachmentThumbnail: string | undefined;
    if (message.attachments) {
      const thumbnailPath = message.attachments[0]?.thumbnail?.path;
      attachmentThumbnail = thumbnailPath
        ? window.Signal.Migrations.getAbsoluteAttachmentPath(thumbnailPath)
        : undefined;
    }

    conversation.set({
      draftEditMessage: {
        body: message.body,
        editHistoryLength: message.editHistory?.length ?? 0,
        attachmentThumbnail,
        preview: message.preview ? message.preview[0] : undefined,
        targetMessageId: messageId,
        quote: message.quote,
      },
      draftBodyRanges: processBodyRanges(message, {
        conversationSelector: getConversationSelector(getState()),
      }),
    });

    dispatch({
      type: SET_FOCUS,
      payload: {
        conversationId,
      },
    });
  };
}

function generateNewGroupLink(
  conversationId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('generateNewGroupLink: No conversation found');
    }

    await longRunningTaskWrapper({
      name: 'refreshGroupLink',
      idForLogging: conversation.idForLogging(),
      task: async () => conversation.refreshGroupLink(),
    });

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

/**
 * Not an actual redux action creator, so it doesn't produce an action (or dispatch
 * itself) because updates are managed through the backbone model, which will trigger
 * necessary updates and refresh conversation_view.
 *
 * In practice, it's similar to an already-connected thunk action. Later on we will
 * replace it with an actual action that fits in with the redux approach.
 */
export const markViewed = (messageId: string): void => {
  const message = window.MessageCache.__DEPRECATED$getById(messageId);
  if (!message) {
    throw new Error(`markViewed: Message ${messageId} missing!`);
  }

  if (message.get('readStatus') === ReadStatus.Viewed) {
    return;
  }

  const senderE164 = message.get('source');
  const timestamp = getMessageSentTimestamp(message.attributes, { log });

  message.set(messageUpdaterMarkViewed(message.attributes, Date.now()));

  let senderAci: AciString;
  if (isIncoming(message.attributes)) {
    const sourceServiceId = message.get('sourceServiceId');
    strictAssert(
      isAciString(sourceServiceId),
      'Message sourceServiceId must be an ACI'
    );
    senderAci = sourceServiceId;

    const convoAttributes = message.getConversation()?.attributes;
    const conversationId = message.get('conversationId');
    drop(
      conversationJobQueue.add({
        type: conversationQueueJobEnum.enum.Receipts,
        conversationId,
        receiptsType: ReceiptType.Viewed,
        receipts: [
          {
            messageId,
            conversationId,
            senderE164,
            senderAci,
            timestamp,
            isDirectConversation: convoAttributes
              ? isDirectConversation(convoAttributes)
              : true,
          },
        ],
      })
    );
  } else {
    // Use our own ACI for syncing viewed state of an outgoing message.
    senderAci = window.textsecure.storage.user.getCheckedAci();
  }

  drop(
    viewSyncJobQueue.add({
      viewSyncs: [
        {
          messageId,
          senderE164,
          senderAci,
          timestamp,
        },
      ],
    })
  );
};

function setAccessControlAddFromInviteLinkSetting(
  conversationId: string,
  value: boolean
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error(
        'setAccessControlAddFromInviteLinkSetting: No conversation found'
      );
    }

    await longRunningTaskWrapper({
      idForLogging: conversation.idForLogging(),
      name: 'updateAccessControlAddFromInviteLink',
      task: async () =>
        conversation.updateAccessControlAddFromInviteLink(value),
    });

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function discardMessages(
  payload: Readonly<DiscardMessagesActionType['payload']>
): DiscardMessagesActionType {
  return { type: DISCARD_MESSAGES, payload };
}

function replaceAvatar(
  curr: AvatarDataType,
  prev?: AvatarDataType,
  conversationId?: string
): ThunkAction<void, RootStateType, unknown, ReplaceAvatarsActionType> {
  return async (dispatch, getState) => {
    strictAssert(conversationId, 'conversationId not provided');

    const avatars = await getAvatarsAndUpdateConversation(
      getState().conversations,
      conversationId,
      (prevAvatarsData, nextId) => {
        const newAvatarData = {
          ...curr,
          id: prev?.id ?? nextId,
        };
        const existingAvatarsData = prev
          ? filterAvatarData(prevAvatarsData, prev)
          : prevAvatarsData;

        return [newAvatarData, ...existingAvatarsData];
      }
    );

    dispatch({
      type: REPLACE_AVATARS,
      payload: {
        conversationId,
        avatars,
      },
    });
  };
}

function saveAvatarToDisk(
  avatarData: AvatarDataType,
  conversationId?: string
): ThunkAction<void, RootStateType, unknown, ReplaceAvatarsActionType> {
  return async (dispatch, getState) => {
    if (!avatarData.buffer) {
      throw new Error('saveAvatarToDisk: No avatar Uint8Array provided');
    }

    strictAssert(conversationId, 'conversationId not provided');

    const imagePath = await window.Signal.Migrations.writeNewAvatarData(
      avatarData.buffer
    );

    const avatars = await getAvatarsAndUpdateConversation(
      getState().conversations,
      conversationId,
      (prevAvatarsData, id) => {
        const newAvatarData = {
          ...avatarData,
          imagePath,
          id,
        };

        return [newAvatarData, ...prevAvatarsData];
      }
    );

    dispatch({
      type: REPLACE_AVATARS,
      payload: {
        conversationId,
        avatars,
      },
    });
  };
}

function myProfileChanged(
  profileData: ProfileDataType,
  avatar: AvatarUpdateType
): ThunkAction<
  void,
  RootStateType,
  unknown,
  NoopActionType | ToggleProfileEditorErrorActionType
> {
  return async (dispatch, getState) => {
    const conversation = getMe(getState());

    try {
      await writeProfile(
        {
          ...conversation,
          ...profileData,
        },
        avatar
      );

      // writeProfile above updates the backbone model which in turn updates
      // redux through it's on:change event listener. Once we lose Backbone
      // we'll need to manually sync these new changes.
      dispatch({
        type: 'NOOP',
        payload: null,
      });
    } catch (err) {
      log.error('myProfileChanged', Errors.toLogFormat(err));
      dispatch({ type: TOGGLE_PROFILE_EDITOR_ERROR });
    }
  };
}

function removeCustomColorOnConversations(
  colorId: string
): ThunkAction<void, RootStateType, unknown, CustomColorRemovedActionType> {
  return async dispatch => {
    const conversationsToUpdate: Array<ConversationAttributesType> = [];
    // We don't want to trigger a model change because we're updating redux
    // here manually ourselves. Au revoir Backbone!
    window.getConversations().forEach(conversation => {
      if (conversation.get('customColorId') === colorId) {
        // eslint-disable-next-line no-param-reassign
        delete conversation.attributes.conversationColor;
        // eslint-disable-next-line no-param-reassign
        delete conversation.attributes.customColor;
        // eslint-disable-next-line no-param-reassign
        delete conversation.attributes.customColorId;

        conversationsToUpdate.push(conversation.attributes);
      }
    });

    if (conversationsToUpdate.length) {
      await window.Signal.Data.updateConversations(conversationsToUpdate);
    }

    dispatch({
      type: CUSTOM_COLOR_REMOVED,
      payload: {
        colorId,
      },
    });
  };
}

function resetAllChatColors(): ThunkAction<
  void,
  RootStateType,
  unknown,
  ColorsChangedActionType
> {
  return async dispatch => {
    // Calling this with no args unsets all the colors in the db
    await window.Signal.Data.updateAllConversationColors();

    // We don't want to trigger a model change because we're updating redux
    // here manually ourselves. Au revoir Backbone!
    window.getConversations().forEach(conversation => {
      // eslint-disable-next-line no-param-reassign
      delete conversation.attributes.conversationColor;
      // eslint-disable-next-line no-param-reassign
      delete conversation.attributes.customColor;
      // eslint-disable-next-line no-param-reassign
      delete conversation.attributes.customColorId;
    });

    dispatch({
      type: COLORS_CHANGED,
      payload: {
        conversationColor: undefined,
        customColorData: undefined,
      },
    });
  };
}

function kickOffAttachmentDownload(
  options: Readonly<{ messageId: string }>
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const message = await __DEPRECATED$getMessageById(options.messageId);
    if (!message) {
      throw new Error(
        `kickOffAttachmentDownload: Message ${options.messageId} missing!`
      );
    }
    const didUpdateValues = await message.queueAttachmentDownloads();

    if (didUpdateValues) {
      drop(
        window.Signal.Data.saveMessage(message.attributes, {
          ourAci: window.textsecure.storage.user.getCheckedAci(),
        })
      );
    }

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

type AttachmentOptions = ReadonlyDeep<{
  messageId: string;
  attachment: AttachmentType;
}>;

function markAttachmentAsCorrupted(
  options: AttachmentOptions
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const message = await __DEPRECATED$getMessageById(options.messageId);
    if (!message) {
      throw new Error(
        `markAttachmentAsCorrupted: Message ${options.messageId} missing!`
      );
    }
    message.markAttachmentAsCorrupted(options.attachment);

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function openGiftBadge(
  messageId: string
): ThunkAction<void, RootStateType, unknown, ShowToastActionType> {
  return async dispatch => {
    const message = await __DEPRECATED$getMessageById(messageId);
    if (!message) {
      throw new Error(`openGiftBadge: Message ${messageId} missing!`);
    }

    dispatch({
      type: SHOW_TOAST,
      payload: {
        toastType: isIncoming(message.attributes)
          ? ToastType.CannotOpenGiftBadgeIncoming
          : ToastType.CannotOpenGiftBadgeOutgoing,
      },
    });
  };
}

function retryMessageSend(
  messageId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const message = await __DEPRECATED$getMessageById(messageId);
    if (!message) {
      throw new Error(`retryMessageSend: Message ${messageId} missing!`);
    }
    await message.retrySend();

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

export function copyMessageText(
  messageId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const message = await __DEPRECATED$getMessageById(messageId);
    if (!message) {
      throw new Error(`copy: Message ${messageId} missing!`);
    }

    const body = message.getNotificationText();
    clipboard.writeText(body);

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

export function retryDeleteForEveryone(
  messageId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const message = await __DEPRECATED$getMessageById(messageId);
    if (!message) {
      throw new Error(`retryDeleteForEveryone: Message ${messageId} missing!`);
    }

    if (isOlderThan(message.get('sent_at'), DAY)) {
      throw new Error(
        'retryDeleteForEveryone: Message too old to retry delete for everyone!'
      );
    }

    try {
      const conversation = message.getConversation();
      if (!conversation) {
        throw new Error(
          `retryDeleteForEveryone: Conversation for ${messageId} missing!`
        );
      }

      const jobData: ConversationQueueJobData = {
        type: conversationQueueJobEnum.enum.DeleteForEveryone,
        conversationId: conversation.id,
        messageId,
        recipients: conversation.getRecipients(),
        revision: conversation.get('revision'),
        targetTimestamp: message.get('sent_at'),
      };

      log.info(
        `retryDeleteForEveryone: Adding job for message ${message.idForLogging()}!`
      );
      await conversationJobQueue.add(jobData);

      dispatch({
        type: 'NOOP',
        payload: null,
      });
    } catch (error) {
      log.error(
        'retryDeleteForEveryone: Failed to queue delete for everyone',
        Errors.toLogFormat(error)
      );
    }
  };
}

// update the conversation voice note playback rate preference for the conversation
export function setVoiceNotePlaybackRate({
  conversationId,
  rate,
}: {
  conversationId: string;
  rate: number;
}): ThunkAction<void, RootStateType, unknown, ConversationChangedActionType> {
  return async dispatch => {
    const conversationModel = window.ConversationController.get(conversationId);
    if (conversationModel) {
      if (rate === 1) {
        delete conversationModel.attributes.voiceNotePlaybackRate;
      } else {
        conversationModel.attributes.voiceNotePlaybackRate = rate;
      }
      window.Signal.Data.updateConversation(conversationModel.attributes);
    }

    const conversation = conversationModel?.format();

    if (conversation) {
      dispatch({
        type: 'CONVERSATION_CHANGED',
        payload: {
          id: conversationId,
          data: {
            ...conversation,
            voiceNotePlaybackRate: rate,
          },
        },
      });
    }
  };
}

function colorSelected({
  conversationId,
  conversationColor,
  customColorData,
}: ColorSelectedPayloadType): ThunkAction<
  void,
  RootStateType,
  unknown,
  ColorSelectedActionType
> {
  return async dispatch => {
    // We don't want to trigger a model change because we're updating redux
    // here manually ourselves. Au revoir Backbone!
    const conversation = window.ConversationController.get(conversationId);
    if (conversation) {
      if (conversationColor) {
        conversation.attributes.conversationColor = conversationColor;
        if (customColorData) {
          conversation.attributes.customColor = customColorData.value;
          conversation.attributes.customColorId = customColorData.id;
        } else {
          delete conversation.attributes.customColor;
          delete conversation.attributes.customColorId;
        }
      } else {
        delete conversation.attributes.conversationColor;
        delete conversation.attributes.customColor;
        delete conversation.attributes.customColorId;
      }

      window.Signal.Data.updateConversation(conversation.attributes);
    }

    dispatch({
      type: COLOR_SELECTED,
      payload: {
        conversationId,
        conversationColor,
        customColorData,
      },
    });
  };
}

function toggleComposeEditingAvatar(): ToggleComposeEditingAvatarActionType {
  return {
    type: COMPOSE_TOGGLE_EDITING_AVATAR,
  };
}

export function cancelConversationVerification(
  canceledAt?: number
): ThunkAction<
  void,
  RootStateType,
  unknown,
  CancelVerificationDataByConversationActionType
> {
  return (dispatch, getState) => {
    const state = getState();
    const conversationIdsBlocked =
      getConversationIdsStoppedForVerification(state);

    dispatch({
      type: CANCEL_CONVERSATION_PENDING_VERIFICATION,
      payload: {
        canceledAt: canceledAt ?? Date.now(),
      },
    });

    // Start the blocked conversation queues up again
    conversationIdsBlocked.forEach(conversationId => {
      conversationJobQueue.resolveVerificationWaiter(conversationId);
    });
  };
}

function verifyConversationsStoppingSend(): ThunkAction<
  void,
  RootStateType,
  unknown,
  ClearVerificationDataByConversationActionType
> {
  return async (dispatch, getState) => {
    const state = getState();
    const serviceIdsStoppingSend = getConversationServiceIdsStoppingSend(state);
    const conversationIdsBlocked =
      getConversationIdsStoppedForVerification(state);
    log.info(
      `verifyConversationsStoppingSend: Starting with ${conversationIdsBlocked.length} blocked ` +
        `conversations and ${serviceIdsStoppingSend.length} conversations to verify.`
    );

    // Mark conversations as approved/verified as appropriate
    const promises: Array<Promise<unknown>> = [];
    serviceIdsStoppingSend.forEach(async serviceId => {
      const conversation = window.ConversationController.get(serviceId);
      if (!conversation) {
        log.warn(
          `verifyConversationsStoppingSend: Cannot verify missing conversation for serviceId ${serviceId}`
        );
        return;
      }

      log.info(
        `verifyConversationsStoppingSend: Verifying conversation ${conversation.idForLogging()}`
      );
      if (conversation.isUnverified()) {
        promises.push(conversation.setVerifiedDefault());
      }
      promises.push(conversation.setApproved());
    });

    dispatch({
      type: CLEAR_CONVERSATIONS_PENDING_VERIFICATION,
    });

    await Promise.all(promises);

    // Start the blocked conversation queues up again
    conversationIdsBlocked.forEach(conversationId => {
      conversationJobQueue.resolveVerificationWaiter(conversationId);
    });
  };
}

export function clearCancelledConversationVerification(
  conversationId: string
): ClearCancelledVerificationActionType {
  return {
    type: CLEAR_CANCELLED_VERIFICATION,
    payload: {
      conversationId,
    },
  };
}

function composeSaveAvatarToDisk(
  avatarData: AvatarDataType
): ThunkAction<void, RootStateType, unknown, ComposeSaveAvatarActionType> {
  return async dispatch => {
    if (!avatarData.buffer) {
      throw new Error('No avatar Uint8Array provided');
    }

    const imagePath = await window.Signal.Migrations.writeNewAvatarData(
      avatarData.buffer
    );

    dispatch({
      type: COMPOSE_ADD_AVATAR,
      payload: {
        ...avatarData,
        imagePath,
      },
    });
  };
}

function composeDeleteAvatarFromDisk(
  avatarData: AvatarDataType
): ThunkAction<void, RootStateType, unknown, ComposeDeleteAvatarActionType> {
  return async dispatch => {
    if (avatarData.imagePath) {
      await window.Signal.Migrations.deleteAvatar(avatarData.imagePath);
    } else {
      log.info(
        'No imagePath for avatarData. Removing from userAvatarData, but not disk'
      );
    }

    dispatch({
      type: COMPOSE_REMOVE_AVATAR,
      payload: avatarData,
    });
  };
}

function composeReplaceAvatar(
  curr: AvatarDataType,
  prev?: AvatarDataType
): ComposeReplaceAvatarsActionType {
  return {
    type: COMPOSE_REPLACE_AVATAR,
    payload: {
      curr,
      prev,
    },
  };
}

function setPreJoinConversation(
  data: PreJoinConversationType | undefined
): SetPreJoinConversationActionType {
  return {
    type: 'SET_PRE_JOIN_CONVERSATION',
    payload: {
      data,
    },
  };
}
function conversationAdded(
  id: string,
  data: ConversationType
): ConversationAddedActionType {
  return {
    type: 'CONVERSATION_ADDED',
    payload: {
      id,
      data,
    },
  };
}
function conversationChanged(
  id: string,
  data: ConversationType
): ThunkAction<void, RootStateType, unknown, ConversationChangedActionType> {
  return dispatch => {
    calling.groupMembersChanged(id);

    dispatch({
      type: 'CONVERSATION_CHANGED',
      payload: {
        id,
        data,
      },
    });
  };
}
function conversationRemoved(id: string): ConversationRemovedActionType {
  return {
    type: 'CONVERSATION_REMOVED',
    payload: {
      id,
    },
  };
}

function createGroup(
  createGroupV2 = groups.createGroupV2
): ThunkAction<
  void,
  RootStateType,
  unknown,
  | CreateGroupPendingActionType
  | CreateGroupFulfilledActionType
  | CreateGroupRejectedActionType
  | TargetedConversationChangedActionType
> {
  return async (dispatch, getState) => {
    const { composer } = getState().conversations;
    if (
      composer?.step !== ComposerStep.SetGroupMetadata ||
      composer.isCreating
    ) {
      assertDev(false, 'Cannot create group in this stage; doing nothing');
      return;
    }

    dispatch({ type: 'CREATE_GROUP_PENDING' });

    try {
      const conversation = await createGroupV2({
        name: composer.groupName.trim(),
        avatar: composer.groupAvatar,
        avatars: composer.userAvatarData.map(avatarData =>
          omit(avatarData, ['buffer'])
        ),
        expireTimer: composer.groupExpireTimer,
        conversationIds: composer.selectedConversationIds,
      });
      dispatch({
        type: 'CREATE_GROUP_FULFILLED',
        payload: {
          invitedServiceIds: (conversation.get('pendingMembersV2') || []).map(
            member => member.serviceId
          ),
        },
      });
      showConversation({
        conversationId: conversation.id,
        switchToAssociatedView: true,
      })(dispatch, getState, null);
    } catch (err) {
      log.error('Failed to create group', Errors.toLogFormat(err));
      dispatch({ type: 'CREATE_GROUP_REJECTED' });
    }
  };
}

function removeAllConversations(): RemoveAllConversationsActionType {
  return {
    type: 'CONVERSATIONS_REMOVE_ALL',
    payload: null,
  };
}

function targetMessage(
  messageId: string,
  conversationId: string
): MessageTargetedActionType {
  return {
    type: 'MESSAGE_TARGETED',
    payload: {
      messageId,
      conversationId,
    },
  };
}

function toggleSelectMessage(
  conversationId: string,
  messageId: string,
  shift: boolean,
  selected: boolean
): ThunkAction<void, RootStateType, unknown, ToggleSelectMessagesActionType> {
  return async (dispatch, getState) => {
    const state = getState();
    const { conversations } = state;

    let toggledMessageIds: ReadonlyArray<string>;
    if (shift && conversations.lastSelectedMessage != null) {
      if (conversationId !== conversations.selectedConversationId) {
        throw new Error("toggleSelectMessage: conversationId doesn't match");
      }

      const conversation = window.ConversationController.get(conversationId);

      if (conversation == null) {
        throw new Error('toggleSelectMessage: conversation not found');
      }

      const toggledMessage = getOwn(conversations.messagesLookup, messageId);

      strictAssert(
        toggledMessage != null,
        'toggleSelectMessage: toggled message not found'
      );

      // Sort the messages by their order in the conversation
      const [after, before] = sortByMessageOrder(
        [toggledMessage, conversations.lastSelectedMessage],
        message => message
      );

      const betweenIds = await window.Signal.Data.getMessagesBetween(
        conversationId,
        {
          after: {
            sent_at: after.sent_at,
            received_at: after.received_at,
          },
          before: {
            sent_at: before.sent_at,
            received_at: before.received_at,
          },
          includeStoryReplies: !isGroup(conversation.attributes),
        }
      );

      toggledMessageIds = [messageId, ...betweenIds];
    } else {
      toggledMessageIds = [messageId];
    }

    dispatch({
      type: 'TOGGLE_SELECT_MESSAGES',
      payload: {
        toggledMessageId: messageId,
        messageIds: toggledMessageIds,
        selected,
      },
    });
  };
}

function toggleSelectMode(on: boolean): ToggleSelectModeActionType {
  return {
    type: 'TOGGLE_SELECT_MODE',
    payload: { on },
  };
}

function getProfilesForConversation(conversationId: string): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error('getProfilesForConversation: no conversation found');
  }

  void conversation.getProfiles();

  return {
    type: 'NOOP',
    payload: null,
  };
}

function conversationStoppedByMissingVerification(payload: {
  conversationId: string;
  distributionId?: StoryDistributionIdString;
  untrustedServiceIds: ReadonlyArray<ServiceIdString>;
}): ConversationStoppedByMissingVerificationActionType {
  // Fetching profiles to ensure that we have their latest identity key in storage
  payload.untrustedServiceIds.forEach(serviceId => {
    const conversation = window.ConversationController.get(serviceId);
    if (!conversation) {
      log.error(
        `conversationStoppedByMissingVerification: serviceId ${serviceId} not found!`
      );
      return;
    }

    // Intentionally not awaiting here
    void conversation.getProfiles();
  });

  return {
    type: CONVERSATION_STOPPED_BY_MISSING_VERIFICATION,
    payload,
  };
}

export function messageChanged(
  id: string,
  conversationId: string,
  data: MessageAttributesType
): MessageChangedActionType {
  return {
    type: MESSAGE_CHANGED,
    payload: {
      id,
      conversationId,
      data,
    },
  };
}

function messageDeleted(
  id: string,
  conversationId: string
): MessageDeletedActionType {
  return {
    type: MESSAGE_DELETED,
    payload: {
      id,
      conversationId,
    },
  };
}

function messageExpanded(
  id: string,
  displayLimit: number
): MessageExpandedActionType {
  return {
    type: 'MESSAGE_EXPANDED',
    payload: {
      id,
      displayLimit,
    },
  };
}
function showSpoiler(
  id: string,
  data: Record<number, boolean>
): ShowSpoilerActionType {
  return {
    type: SHOW_SPOILER,
    payload: {
      id,
      data,
    },
  };
}

function messageExpired(id: string): MessageExpiredActionType {
  return {
    type: MESSAGE_EXPIRED,
    payload: {
      id,
    },
  };
}

function messagesAdded({
  conversationId,
  isActive,
  isJustSent,
  isNewMessage,
  messages,
}: {
  conversationId: string;
  isActive: boolean;
  isJustSent: boolean;
  isNewMessage: boolean;
  messages: ReadonlyArray<MessageAttributesType>;
}): ThunkAction<void, RootStateType, unknown, MessagesAddedActionType> {
  return (dispatch, getState) => {
    const state = getState();
    if (
      isNewMessage &&
      state.items.audioMessage &&
      conversationId === state.conversations.selectedConversationId &&
      isActive &&
      !isJustSent &&
      messages.some(isIncoming)
    ) {
      drop(new Sound({ soundType: SoundType.Pop }).play());
    }

    dispatch({
      type: 'MESSAGES_ADDED',
      payload: {
        conversationId,
        isActive,
        isJustSent,
        isNewMessage,
        messages,
      },
    });
  };
}

function repairNewestMessage(
  conversationId: string
): RepairNewestMessageActionType {
  return {
    type: 'REPAIR_NEWEST_MESSAGE',
    payload: {
      conversationId,
    },
  };
}
function repairOldestMessage(
  conversationId: string
): RepairOldestMessageActionType {
  return {
    type: 'REPAIR_OLDEST_MESSAGE',
    payload: {
      conversationId,
    },
  };
}

function reviewGroupMemberNameCollision(
  groupConversationId: string
): ReviewGroupMemberNameCollisionActionType {
  return {
    type: 'REVIEW_GROUP_MEMBER_NAME_COLLISION',
    payload: { groupConversationId },
  };
}

function reviewMessageRequestNameCollision(
  payload: Readonly<{
    safeConversationId: string;
  }>
): ReviewMessageRequestNameCollisionActionType {
  return { type: 'REVIEW_MESSAGE_REQUEST_NAME_COLLISION', payload };
}

// eslint-disable-next-line local-rules/type-alias-readonlydeep
export type MessageResetOptionsType = {
  conversationId: string;
  messages: ReadonlyArray<MessageAttributesType>;
  metrics: MessageMetricsType;
  scrollToMessageId?: string;
  unboundedFetch?: boolean;
};

function messagesReset({
  conversationId,
  messages,
  metrics,
  scrollToMessageId,
  unboundedFetch,
}: MessageResetOptionsType): MessagesResetActionType {
  for (const message of messages) {
    strictAssert(
      message.conversationId === conversationId,
      `messagesReset(${conversationId}): invalid message conversationId ` +
        `${message.conversationId}`
    );
  }

  return {
    type: 'MESSAGES_RESET',
    payload: {
      unboundedFetch: Boolean(unboundedFetch),
      conversationId,
      messages,
      metrics,
      scrollToMessageId,
    },
  };
}
function setMessageLoadingState(
  conversationId: string,
  messageLoadingState: undefined | TimelineMessageLoadingState
): SetMessageLoadingStateActionType {
  return {
    type: 'SET_MESSAGE_LOADING_STATE',
    payload: {
      conversationId,
      messageLoadingState,
    },
  };
}
function setIsNearBottom(
  conversationId: string,
  isNearBottom: boolean
): SetIsNearBottomActionType {
  return {
    type: 'SET_NEAR_BOTTOM',
    payload: {
      conversationId,
      isNearBottom,
    },
  };
}
function setIsFetchingUUID(
  identifier: UUIDFetchStateKeyType,
  isFetching: boolean
): SetIsFetchingUUIDActionType {
  return {
    type: 'SET_IS_FETCHING_UUID',
    payload: {
      identifier,
      isFetching,
    },
  };
}

export type PushPanelForConversationActionType = ReadonlyDeep<
  (panel: PanelRequestType) => unknown
>;

function pushPanelForConversation(
  panel: PanelRequestType
): ThunkAction<void, RootStateType, unknown, PushPanelActionType> {
  return async (dispatch, getState) => {
    const { conversations } = getState();
    const { targetedConversationPanels } = conversations;
    const activePanel =
      targetedConversationPanels.stack[targetedConversationPanels.watermark];
    if (panel.type === activePanel?.type && isEqual(panel, activePanel)) {
      return;
    }

    if (panel.type === PanelType.MessageDetails) {
      const { messageId } = panel.args;

      const message =
        conversations.messagesLookup[messageId] ||
        (await __DEPRECATED$getMessageById(messageId))?.attributes;
      if (!message) {
        throw new Error(
          'pushPanelForConversation: could not find message for MessageDetails'
        );
      }
      dispatch({
        type: PUSH_PANEL,
        payload: {
          type: PanelType.MessageDetails,
          args: {
            message,
          },
        },
      });
      return;
    }

    dispatch({
      type: PUSH_PANEL,
      payload: panel,
    });
  };
}

export type PopPanelForConversationActionType = ReadonlyDeep<() => unknown>;

function popPanelForConversation(): ThunkAction<
  void,
  RootStateType,
  unknown,
  PopPanelActionType
> {
  return (dispatch, getState) => {
    const { conversations } = getState();
    const { targetedConversationPanels } = conversations;

    if (!targetedConversationPanels.stack.length) {
      return;
    }

    dispatch({
      type: POP_PANEL,
      payload: null,
    });
  };
}

function panelAnimationStarted(): PanelAnimationStartedActionType {
  return {
    type: PANEL_ANIMATION_STARTED,
    payload: null,
  };
}

function panelAnimationDone(): PanelAnimationDoneActionType {
  return {
    type: PANEL_ANIMATION_DONE,
    payload: null,
  };
}

function deleteMessagesForEveryone(
  messageIds: ReadonlyArray<string>
): ThunkAction<
  void,
  RootStateType,
  unknown,
  NoopActionType | ShowToastActionType
> {
  return async dispatch => {
    let hasError = false;

    await Promise.all(
      messageIds.map(async messageId => {
        try {
          const message = window.MessageCache.__DEPRECATED$getById(messageId);
          if (!message) {
            throw new Error(
              `deleteMessageForEveryone: Message ${messageId} missing!`
            );
          }

          const conversation = message.getConversation();
          if (!conversation) {
            throw new Error('deleteMessageForEveryone: no conversation');
          }

          await sendDeleteForEveryoneMessage(conversation.attributes, {
            id: message.id,
            timestamp: getMessageSentTimestamp(message.attributes, { log }),
          });
        } catch (error) {
          hasError = true;
          log.error(
            'Error queuing delete-for-everyone job',
            Errors.toLogFormat(error),
            messageId
          );
        }
      })
    );

    if (hasError) {
      dispatch({
        type: SHOW_TOAST,
        payload: {
          toastType: ToastType.DeleteForEveryoneFailed,
        },
      });
    } else {
      dispatch({
        type: 'NOOP',
        payload: null,
      });
    }
  };
}

function approvePendingMembershipFromGroupV2(
  conversationId: string,
  memberId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error(
        `approvePendingMembershipFromGroupV2: No conversation found for conversation ${conversationId}`
      );
    }

    const logId = conversation.idForLogging();

    const pendingMember = window.ConversationController.get(memberId);
    if (!pendingMember) {
      throw new Error(
        `approvePendingMembershipFromGroupV2/${logId}: No member found for conversation ${conversationId}`
      );
    }

    const serviceId = pendingMember.getCheckedServiceId(
      `approvePendingMembershipFromGroupV2/${logId}`
    );

    if (
      isGroupV2(conversation.attributes) &&
      isMemberRequestingToJoin(conversation.attributes, serviceId)
    ) {
      strictAssert(
        isAciString(serviceId),
        'Member requesting to join must have ACI'
      );
      await modifyGroupV2({
        conversation,
        usingCredentialsFrom: [pendingMember],
        createGroupChange: async () => {
          // This user's pending state may have changed in the time between the user's
          //   button press and when we get here. It's especially important to check here
          //   in conflict/retry cases.
          if (!isMemberRequestingToJoin(conversation.attributes, serviceId)) {
            log.warn(
              `approvePendingMembershipFromGroupV2/${logId}: ${serviceId} is not requesting ` +
                'to join the group. Returning early.'
            );
            return undefined;
          }

          return buildPromotePendingAdminApprovalMemberChange({
            group: conversation.attributes,
            aci: serviceId,
          });
        },
        name: 'approvePendingMembershipFromGroupV2',
      });
    }

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function revokePendingMembershipsFromGroupV2(
  conversationId: string,
  memberIds: ReadonlyArray<string>
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error(
        `approvePendingMembershipFromGroupV2: No conversation found for conversation ${conversationId}`
      );
    }

    if (!isGroupV2(conversation.attributes)) {
      return;
    }

    // Only pending memberships can be revoked for multiple members at once
    if (memberIds.length > 1) {
      const serviceIds = memberIds.map(id => {
        const serviceId = window.ConversationController.get(id)?.getServiceId();
        strictAssert(serviceId, `serviceId does not exist for ${id}`);
        return serviceId;
      });
      await conversation.modifyGroupV2({
        name: 'removePendingMember',
        usingCredentialsFrom: [],
        createGroupChange: () =>
          removePendingMember(conversation.attributes, serviceIds),
        extraConversationsForSend: memberIds,
      });
      return;
    }

    const [memberId] = memberIds;

    const pendingMember = window.ConversationController.get(memberId);
    if (!pendingMember) {
      const logId = conversation.idForLogging();
      throw new Error(
        `revokePendingMembershipsFromGroupV2/${logId}: No conversation found for conversation ${memberId}`
      );
    }

    const serviceId = pendingMember.getCheckedServiceId(
      'revokePendingMembershipsFromGroupV2'
    );

    if (isMemberRequestingToJoin(conversation.attributes, serviceId)) {
      strictAssert(
        isAciString(serviceId),
        'Member requesting to join must have ACI'
      );
      await conversation.modifyGroupV2({
        name: 'denyPendingApprovalRequest',
        usingCredentialsFrom: [],
        createGroupChange: () =>
          denyPendingApprovalRequest(conversation.attributes, serviceId),
        extraConversationsForSend: [memberId],
      });
    } else if (conversation.isMemberPending(serviceId)) {
      await conversation.modifyGroupV2({
        name: 'removePendingMember',
        usingCredentialsFrom: [],
        createGroupChange: () =>
          removePendingMember(conversation.attributes, [serviceId]),
        extraConversationsForSend: [memberId],
      });
    }

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function blockAndReportSpam(
  conversationId: string
): ThunkAction<void, RootStateType, unknown, ShowToastActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      log.error(
        `blockAndReportSpam: Expected a conversation to be found for ${conversationId}. Doing nothing.`
      );
      return;
    }

    const messageRequestEnum = Proto.SyncMessage.MessageRequestResponse.Type;
    const idForLogging = conversation.idForLogging();

    void longRunningTaskWrapper({
      name: 'blockAndReportSpam',
      idForLogging,
      task: async () => {
        await Promise.all([
          conversation.syncMessageRequestResponse(messageRequestEnum.BLOCK),
          addReportSpamJob({
            conversation: conversation.attributes,
            getMessageServerGuidsForSpam:
              window.Signal.Data.getMessageServerGuidsForSpam,
            jobQueue: reportSpamJobQueue,
          }),
        ]);

        dispatch({
          type: SHOW_TOAST,
          payload: {
            toastType: ToastType.ReportedSpamAndBlocked,
          },
        });
      },
    });
  };
}

function acceptConversation(conversationId: string): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error(
      'acceptConversation: Expected a conversation to be found. Doing nothing'
    );
  }

  const messageRequestEnum = Proto.SyncMessage.MessageRequestResponse.Type;

  void longRunningTaskWrapper({
    name: 'acceptConversation',
    idForLogging: conversation.idForLogging(),
    task: conversation.syncMessageRequestResponse.bind(
      conversation,
      messageRequestEnum.ACCEPT
    ),
  });

  return {
    type: 'NOOP',
    payload: null,
  };
}

function removeConversation(conversationId: string): ShowToastActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error(
      'acceptConversation: Expected a conversation to be found. Doing nothing'
    );
  }

  drop(conversation.removeContact());

  return {
    type: SHOW_TOAST,
    payload: {
      toastType: ToastType.ConversationRemoved,
      parameters: {
        title: conversation.getTitle(),
      },
    },
  };
}

function blockConversation(conversationId: string): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error(
      'blockConversation: Expected a conversation to be found. Doing nothing'
    );
  }

  const messageRequestEnum = Proto.SyncMessage.MessageRequestResponse.Type;

  void longRunningTaskWrapper({
    name: 'blockConversation',
    idForLogging: conversation.idForLogging(),
    task: conversation.syncMessageRequestResponse.bind(
      conversation,
      messageRequestEnum.BLOCK
    ),
  });

  return {
    type: 'NOOP',
    payload: null,
  };
}

function deleteConversation(conversationId: string): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error(
      'deleteConversation: Expected a conversation to be found. Doing nothing'
    );
  }

  const messageRequestEnum = Proto.SyncMessage.MessageRequestResponse.Type;

  void longRunningTaskWrapper({
    name: 'deleteConversation',
    idForLogging: conversation.idForLogging(),
    task: conversation.syncMessageRequestResponse.bind(
      conversation,
      messageRequestEnum.DELETE
    ),
  });

  return {
    type: 'NOOP',
    payload: null,
  };
}

function initiateMigrationToGroupV2(conversationId: string): NoopActionType {
  const conversation = window.ConversationController.get(conversationId);
  if (!conversation) {
    throw new Error(
      'deleteConversation: Expected a conversation to be found. Doing nothing'
    );
  }

  void longRunningTaskWrapper({
    idForLogging: conversation.idForLogging(),
    name: 'initiateMigrationToGroupV2',
    task: () => doInitiateMigrationToGroupV2(conversation),
  });

  return {
    type: 'NOOP',
    payload: null,
  };
}

function loadRecentMediaItems(
  conversationId: string,
  limit: number
): ThunkAction<void, RootStateType, unknown, SetRecentMediaItemsActionType> {
  return async dispatch => {
    const { getAbsoluteAttachmentPath } = window.Signal.Migrations;

    const messages: Array<MessageAttributesType> =
      await window.Signal.Data.getMessagesWithVisualMediaAttachments(
        conversationId,
        {
          limit,
        }
      );

    // Cache these messages in memory to ensure Lightbox can find them
    messages.forEach(message => {
      window.MessageCache.__DEPRECATED$register(
        message.id,
        message,
        'loadRecentMediaItems'
      );
    });

    let index = 0;
    const recentMediaItems = messages
      .filter(message => message.attachments !== undefined)
      .reduce(
        (acc, message) => [
          ...acc,
          ...(message.attachments || []).map(
            (attachment: AttachmentType): MediaItemType => {
              const { thumbnail } = attachment;

              const result = {
                objectURL: getAbsoluteAttachmentPath(attachment.path || ''),
                thumbnailObjectUrl: thumbnail?.path
                  ? getAbsoluteAttachmentPath(thumbnail.path)
                  : '',
                contentType: attachment.contentType,
                index,
                attachment,
                message: {
                  attachments: message.attachments || [],
                  conversationId:
                    window.ConversationController.get(message.sourceServiceId)
                      ?.id || message.conversationId,
                  id: message.id,
                  received_at: message.received_at,
                  received_at_ms: Number(message.received_at_ms),
                  sent_at: message.sent_at,
                },
              };

              index += 1;

              return result;
            }
          ),
        ],
        [] as Array<MediaItemType>
      );

    dispatch({
      type: 'SET_RECENT_MEDIA_ITEMS',
      payload: { id: conversationId, recentMediaItems },
    });
  };
}

export type SaveAttachmentActionCreatorType = ReadonlyDeep<
  (attachment: AttachmentType, timestamp?: number, index?: number) => unknown
>;

function saveAttachment(
  attachment: AttachmentType,
  timestamp = Date.now(),
  index = 0
): ThunkAction<void, RootStateType, unknown, ShowToastActionType> {
  return async dispatch => {
    const { fileName = '' } = attachment;

    const isDangerous = isFileDangerous(fileName);

    if (isDangerous) {
      dispatch({
        type: SHOW_TOAST,
        payload: {
          toastType: ToastType.DangerousFileType,
        },
      });
      return;
    }

    const { readAttachmentData, saveAttachmentToDisk } =
      window.Signal.Migrations;

    const fullPath = await Attachment.save({
      attachment,
      index: index + 1,
      readAttachmentData,
      saveAttachmentToDisk,
      timestamp,
    });

    if (fullPath) {
      dispatch({
        type: SHOW_TOAST,
        payload: {
          toastType: ToastType.FileSaved,
          parameters: {
            fullPath,
          },
        },
      });
    }
  };
}

export function saveAttachmentFromMessage(
  messageId: string,
  providedAttachment?: AttachmentType
): ThunkAction<void, RootStateType, unknown, ShowToastActionType> {
  return async (dispatch, getState) => {
    const message = await __DEPRECATED$getMessageById(messageId);
    if (!message) {
      throw new Error(
        `saveAttachmentFromMessage: Message ${messageId} missing!`
      );
    }

    const { attachments, sent_at: timestamp } = message.attributes;
    if (!attachments || attachments.length < 1) {
      return;
    }

    const attachment =
      providedAttachment && attachments.includes(providedAttachment)
        ? providedAttachment
        : attachments[0];

    saveAttachment(attachment, timestamp)(dispatch, getState, null);
  };
}

function clearInvitedServiceIdsForNewlyCreatedGroup(): ClearInvitedServiceIdsForNewlyCreatedGroupActionType {
  return { type: 'CLEAR_INVITED_SERVICE_IDS_FOR_NEWLY_CREATED_GROUP' };
}
function clearGroupCreationError(): ClearGroupCreationErrorActionType {
  return { type: 'CLEAR_GROUP_CREATION_ERROR' };
}
function clearTargetedMessage(): ClearTargetedMessageActionType {
  return {
    type: 'CLEAR_TARGETED_MESSAGE',
    payload: null,
  };
}
function clearUnreadMetrics(
  conversationId: string
): ClearUnreadMetricsActionType {
  return {
    type: 'CLEAR_UNREAD_METRICS',
    payload: {
      conversationId,
    },
  };
}
function closeContactSpoofingReview(): CloseContactSpoofingReviewActionType {
  return { type: 'CLOSE_CONTACT_SPOOFING_REVIEW' };
}
function closeMaximumGroupSizeModal(): CloseMaximumGroupSizeModalActionType {
  return { type: 'CLOSE_MAXIMUM_GROUP_SIZE_MODAL' };
}
function closeRecommendedGroupSizeModal(): CloseRecommendedGroupSizeModalActionType {
  return { type: 'CLOSE_RECOMMENDED_GROUP_SIZE_MODAL' };
}

export function scrollToOldestUnreadMention(
  conversationId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return async (dispatch, getState) => {
    const conversation = getOwn(
      getState().conversations.conversationLookup,
      conversationId
    );
    if (!conversation) {
      log.warn(`No conversation found: [${conversationId}]`);
      return;
    }

    const oldestUnreadMention =
      await window.Signal.Data.getOldestUnreadMentionOfMeForConversation(
        conversationId,
        {
          includeStoryReplies: !isGroup(conversation),
        }
      );

    if (!oldestUnreadMention) {
      log.warn(`No unread mention found for conversation: [${conversationId}]`);
      return;
    }

    dispatch(scrollToMessage(conversationId, oldestUnreadMention.id));
  };
}

export function scrollToMessage(
  conversationId: string,
  messageId: string
): ThunkAction<void, RootStateType, unknown, ScrollToMessageActionType> {
  return async (dispatch, getState) => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('scrollToMessage: No conversation found');
    }

    const message = await __DEPRECATED$getMessageById(messageId);
    if (!message) {
      throw new Error(`scrollToMessage: failed to load message ${messageId}`);
    }
    if (message.get('conversationId') !== conversationId) {
      throw new Error(
        `scrollToMessage: ${messageId} didn't have conversationId ${conversationId}`
      );
    }

    const state = getState();

    let isInMemory = true;

    if (!window.MessageCache.__DEPRECATED$getById(messageId)) {
      isInMemory = false;
    }

    // Message might be in memory, but not in the redux anymore because
    // we call `messageReset()` in `loadAndScroll()`.
    const messagesByConversation =
      getMessagesByConversation(state)[conversationId];
    if (!messagesByConversation?.messageIds.includes(messageId)) {
      isInMemory = false;
    }

    if (isInMemory) {
      dispatch({
        type: 'SCROLL_TO_MESSAGE',
        payload: {
          conversationId,
          messageId,
        },
      });
      return;
    }

    drop(conversation.loadAndScroll(messageId));
  };
}

function setComposeGroupAvatar(
  groupAvatar: undefined | Uint8Array
): SetComposeGroupAvatarActionType {
  return {
    type: 'SET_COMPOSE_GROUP_AVATAR',
    payload: { groupAvatar },
  };
}

function setComposeGroupName(groupName: string): SetComposeGroupNameActionType {
  return {
    type: 'SET_COMPOSE_GROUP_NAME',
    payload: { groupName },
  };
}

function setComposeGroupExpireTimer(
  groupExpireTimer: DurationInSeconds
): SetComposeGroupExpireTimerActionType {
  return {
    type: 'SET_COMPOSE_GROUP_EXPIRE_TIMER',
    payload: { groupExpireTimer },
  };
}

function setComposeSearchTerm(
  searchTerm: string
): SetComposeSearchTermActionType {
  return {
    type: 'SET_COMPOSE_SEARCH_TERM',
    payload: { searchTerm },
  };
}

function startComposing(): StartComposingActionType {
  return { type: 'START_COMPOSING' };
}

function showChooseGroupMembers(): ShowChooseGroupMembersActionType {
  return { type: 'SHOW_CHOOSE_GROUP_MEMBERS' };
}

function startSettingGroupMetadata(): StartSettingGroupMetadataActionType {
  return { type: 'START_SETTING_GROUP_METADATA' };
}

function toggleConversationInChooseMembers(
  conversationId: string
): ThunkAction<
  void,
  RootStateType,
  unknown,
  ToggleConversationInChooseMembersActionType
> {
  return dispatch => {
    const maxRecommendedGroupSize = getGroupSizeRecommendedLimit(151);
    const maxGroupSize = Math.max(
      getGroupSizeHardLimit(1001),
      maxRecommendedGroupSize + 1
    );

    assertDev(
      maxGroupSize > maxRecommendedGroupSize,
      'Expected the hard max group size to be larger than the recommended maximum'
    );

    dispatch({
      type: 'TOGGLE_CONVERSATION_IN_CHOOSE_MEMBERS',
      payload: { conversationId, maxGroupSize, maxRecommendedGroupSize },
    });
  };
}

function toggleHideStories(
  conversationId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return dispatch => {
    const conversationModel = window.ConversationController.get(conversationId);
    if (conversationModel) {
      conversationModel.toggleHideStories();
    }
    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function removeMemberFromGroup(
  conversationId: string,
  contactId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return dispatch => {
    const conversationModel = window.ConversationController.get(conversationId);
    if (conversationModel) {
      const idForLogging = conversationModel.idForLogging();
      void longRunningTaskWrapper({
        name: 'removeMemberFromGroup',
        idForLogging,
        task: () => conversationModel.removeFromGroupV2(contactId),
      });
    }
    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function addMembersToGroup(
  conversationId: string,
  contactIds: ReadonlyArray<string>,
  {
    onSuccess,
    onFailure,
  }: {
    onSuccess?: () => unknown;
    onFailure?: () => unknown;
  } = {}
): ThunkAction<void, RootStateType, unknown, never> {
  return async () => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('addMembersToGroup: No conversation found');
    }

    const idForLogging = conversation.idForLogging();
    try {
      await longRunningTaskWrapper({
        name: 'addMembersToGroup',
        idForLogging,
        task: () =>
          modifyGroupV2({
            name: 'addMembersToGroup',
            conversation,
            usingCredentialsFrom: contactIds
              .map(id => window.ConversationController.get(id))
              .filter(isNotNil),
            createGroupChange: async () =>
              buildAddMembersChange(conversation.attributes, contactIds),
          }),
      });
      onSuccess?.();
    } catch {
      onFailure?.();
    }
  };
}

function updateGroupAttributes(
  conversationId: string,
  attributes: Readonly<{
    avatar?: undefined | Uint8Array;
    description?: string;
    title?: string;
  }>,
  {
    onSuccess,
    onFailure,
  }: {
    onSuccess?: () => unknown;
    onFailure?: () => unknown;
  } = {}
): ThunkAction<void, RootStateType, unknown, never> {
  return async () => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('updateGroupAttributes: No conversation found');
    }

    const { id, publicParams, revision, secretParams } =
      conversation.attributes;

    try {
      await modifyGroupV2({
        name: 'updateGroupAttributes',
        conversation,
        usingCredentialsFrom: [],
        createGroupChange: async () =>
          buildUpdateAttributesChange(
            { id, publicParams, revision, secretParams },
            attributes
          ),
      });
      onSuccess?.();
    } catch {
      onFailure?.();
    }
  };
}

function leaveGroup(
  conversationId: string
): ThunkAction<void, RootStateType, unknown, never> {
  return async () => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('leaveGroup: No conversation found');
    }

    await longRunningTaskWrapper({
      idForLogging: conversation.idForLogging(),
      name: 'leaveGroup',
      task: () => conversation.leaveGroupV2(),
    });
  };
}

function toggleGroupsForStorySend(
  conversationIds: ReadonlyArray<string>
): ThunkAction<Promise<void>, RootStateType, unknown, NoopActionType> {
  return async dispatch => {
    await Promise.all(
      conversationIds.map(async conversationId => {
        const conversation = window.ConversationController.get(conversationId);
        if (!conversation) {
          return;
        }

        const oldStorySendMode = conversation.getStorySendMode();
        const newStorySendMode =
          oldStorySendMode === StorySendMode.Always
            ? StorySendMode.Never
            : StorySendMode.Always;

        conversation.set({
          storySendMode: newStorySendMode,
        });
        window.Signal.Data.updateConversation(conversation.attributes);
        conversation.captureChange('storySendMode');
      })
    );

    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function toggleAdmin(
  conversationId: string,
  contactId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return dispatch => {
    const conversationModel = window.ConversationController.get(conversationId);
    if (conversationModel) {
      void conversationModel.toggleAdmin(contactId);
    }
    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function updateConversationModelSharedGroups(
  conversationId: string
): ThunkAction<void, RootStateType, unknown, NoopActionType> {
  return dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (conversation && conversation.throttledUpdateSharedGroups) {
      void conversation.throttledUpdateSharedGroups();
    }
    dispatch({
      type: 'NOOP',
      payload: null,
    });
  };
}

function showExpiredIncomingTapToViewToast(): ShowToastActionType {
  log.info(
    'showExpiredIncomingTapToViewToastShowing expired tap-to-view toast for an incoming message'
  );
  return {
    type: SHOW_TOAST,
    payload: {
      toastType: ToastType.TapToViewExpiredIncoming,
    },
  };
}
function showExpiredOutgoingTapToViewToast(): ShowToastActionType {
  log.info('Showing expired tap-to-view toast for an outgoing message');
  return {
    type: SHOW_TOAST,
    payload: {
      toastType: ToastType.TapToViewExpiredOutgoing,
    },
  };
}

function showInbox(): ShowInboxActionType {
  return {
    type: 'SHOW_INBOX',
    payload: null,
  };
}

type ShowConversationArgsType = ReadonlyDeep<{
  conversationId?: string;
  messageId?: string;
  switchToAssociatedView?: boolean;
}>;
export type ShowConversationType = ReadonlyDeep<
  (options: ShowConversationArgsType) => unknown
>;

function showConversation({
  conversationId,
  messageId,
  switchToAssociatedView,
}: ShowConversationArgsType): ThunkAction<
  void,
  RootStateType,
  unknown,
  TargetedConversationChangedActionType | ChangeNavTabActionType
> {
  return (dispatch, getState) => {
    const { conversations, nav } = getState();

    if (nav.selectedNavTab !== NavTab.Chats) {
      dispatch(navActions.changeNavTab(NavTab.Chats));
      const conversation = window.ConversationController.get(conversationId);
      conversation?.setMarkedUnread(false);
    }

    if (conversationId === conversations.selectedConversationId) {
      if (!conversationId) {
        return;
      }

      if (messageId) {
        dispatch(scrollToMessage(conversationId, messageId));
      }
      dispatch(setComposerFocus(conversationId));

      return;
    }

    // notify composer in case we need to stop recording a voice note
    if (conversations.selectedConversationId) {
      dispatch(handleLeaveConversation(conversations.selectedConversationId));
      dispatch(
        onConversationClosed(
          conversations.selectedConversationId,
          'showConversation'
        )
      );
    }

    dispatch({
      type: TARGETED_CONVERSATION_CHANGED,
      payload: {
        conversationId,
        messageId,
        switchToAssociatedView,
      },
    });
  };
}

function onConversationOpened(
  conversationId: string,
  messageId?: string
): ThunkAction<
  void,
  RootStateType,
  unknown,
  | ReplaceAttachmentsActionType
  | ResetComposerActionType
  | SetFocusActionType
  | SetQuotedMessageActionType
> {
  return async (dispatch, getState) => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('onConversationOpened: Conversation not found');
    }

    conversation.onOpenStart();

    if (messageId) {
      const message = await __DEPRECATED$getMessageById(messageId);

      if (message) {
        drop(conversation.loadAndScroll(messageId));
        return;
      }

      log.warn(`onOpened: Did not find message ${messageId}`);
    }

    const { retryPlaceholders } = window.Signal.Services;
    if (retryPlaceholders) {
      await retryPlaceholders.findByConversationAndMarkOpened(conversation.id);
    }

    const loadAndUpdate = async () => {
      drop(
        Promise.all([
          conversation.loadNewestMessages(undefined, undefined),
          conversation.updateLastMessage(),
          conversation.updateUnread(),
        ])
      );
    };

    drop(loadAndUpdate());

    dispatch(setComposerFocus(conversation.id));

    const quotedMessageId = conversation.get('quotedMessageId');
    if (quotedMessageId) {
      setQuoteByMessageId(conversation.id, quotedMessageId)(
        dispatch,
        getState,
        undefined
      );
    }

    drop(conversation.fetchLatestGroupV2Data());
    strictAssert(
      conversation.throttledMaybeMigrateV1Group !== undefined,
      'Conversation model should be initialized'
    );
    drop(conversation.throttledMaybeMigrateV1Group());
    strictAssert(
      conversation.throttledFetchSMSOnlyUUID !== undefined,
      'Conversation model should be initialized'
    );
    drop(conversation.throttledFetchSMSOnlyUUID());

    const ourAci = window.textsecure.storage.user.getAci();
    if (
      !isGroup(conversation.attributes) ||
      (ourAci && conversation.hasMember(ourAci))
    ) {
      strictAssert(
        conversation.throttledGetProfiles !== undefined,
        'Conversation model should be initialized'
      );
      await conversation.throttledGetProfiles();
    }

    drop(conversation.updateVerified());

    replaceAttachments(
      conversation.get('id'),
      conversation.get('draftAttachments') || []
    )(dispatch, getState, undefined);
    dispatch(resetComposer(conversationId));
  };
}

function onConversationClosed(
  conversationId: string,
  reason: string
): ThunkAction<void, RootStateType, unknown, ConversationUnloadedActionType> {
  return async dispatch => {
    const conversation = window.ConversationController.get(conversationId);
    if (!conversation) {
      throw new Error('onConversationClosed: Conversation not found');
    }

    const logId = `onConversationClosed/${conversation.idForLogging()}`;
    log.info(`${logId}: unloading due to ${reason}`);

    if (conversation.get('draftChanged')) {
      if (conversation.hasDraft()) {
        log.info(`${logId}: new draft info needs update`);
        const now = Date.now();
        const activeAt = conversation.get('active_at') || now;

        conversation.set({
          active_at: activeAt,
          draftChanged: false,
          draftTimestamp: now,
          timestamp: now,
        });
      } else {
        log.info(`${logId}: clearing draft info`);
        conversation.set({
          draftChanged: false,
          draftTimestamp: null,
        });
      }

      window.Signal.Data.updateConversation(conversation.attributes);

      drop(conversation.updateLastMessage());
    }

    removeLinkPreview(conversationId);

    dispatch({
      type: CONVERSATION_UNLOADED,
      payload: {
        conversationId,
      },
    });
  };
}

function showArchivedConversations(): ShowArchivedConversationsActionType {
  return {
    type: 'SHOW_ARCHIVED_CONVERSATIONS',
    payload: null,
  };
}

function doubleCheckMissingQuoteReference(messageId: string): NoopActionType {
  const message = window.MessageCache.__DEPRECATED$getById(messageId);
  if (message) {
    void message.doubleCheckMissingQuoteReference();
  }

  return {
    type: 'NOOP',
    payload: null,
  };
}

// Reducer

export function getEmptyState(): ConversationsStateType {
  return {
    conversationLookup: {},
    conversationsByE164: {},
    conversationsByServiceId: {},
    conversationsByGroupId: {},
    conversationsByUsername: {},
    verificationDataByConversation: {},
    messagesByConversation: {},
    messagesLookup: {},
    targetedMessage: undefined,
    targetedMessageCounter: 0,
    targetedMessageSource: undefined,
    lastSelectedMessage: undefined,
    selectedMessageIds: undefined,
    showArchived: false,
    targetedConversationPanels: {
      isAnimating: false,
      wasAnimated: false,
      direction: undefined,
      stack: [],
      watermark: -1,
    },
  };
}

export function updateConversationLookups(
  added: ConversationType | undefined,
  removed: ConversationType | undefined,
  state: ConversationsStateType
): Pick<
  ConversationsStateType,
  | 'conversationsByE164'
  | 'conversationsByServiceId'
  | 'conversationsByGroupId'
  | 'conversationsByUsername'
> {
  const result = {
    conversationsByE164: state.conversationsByE164,
    conversationsByServiceId: state.conversationsByServiceId,
    conversationsByGroupId: state.conversationsByGroupId,
    conversationsByUsername: state.conversationsByUsername,
  };

  if (removed && removed.e164) {
    result.conversationsByE164 = omit(result.conversationsByE164, removed.e164);
  }
  if (removed && removed.serviceId) {
    result.conversationsByServiceId = omit(
      result.conversationsByServiceId,
      removed.serviceId
    );
  }
  if (removed && removed.pni) {
    result.conversationsByServiceId = omit(
      result.conversationsByServiceId,
      removed.pni
    );
  }
  if (removed && removed.groupId) {
    result.conversationsByGroupId = omit(
      result.conversationsByGroupId,
      removed.groupId
    );
  }
  if (removed && removed.username) {
    result.conversationsByUsername = omit(
      result.conversationsByUsername,
      removed.username
    );
  }

  if (added && added.e164) {
    result.conversationsByE164 = {
      ...result.conversationsByE164,
      [added.e164]: added,
    };
  }
  if (added && added.serviceId) {
    result.conversationsByServiceId = {
      ...result.conversationsByServiceId,
      [added.serviceId]: added,
    };
  }
  if (added && added.pni) {
    result.conversationsByServiceId = {
      ...result.conversationsByServiceId,
      [added.pni]: added,
    };
  }
  if (added && added.groupId) {
    result.conversationsByGroupId = {
      ...result.conversationsByGroupId,
      [added.groupId]: added,
    };
  }
  if (added && added.username) {
    result.conversationsByUsername = {
      ...result.conversationsByUsername,
      [added.username]: added,
    };
  }

  return result;
}

function closeComposerModal(
  state: Readonly<ConversationsStateType>,
  modalToClose: 'maximumGroupSizeModalState' | 'recommendedGroupSizeModalState'
): ConversationsStateType {
  const { composer } = state;
  if (composer?.step !== ComposerStep.ChooseGroupMembers) {
    assertDev(
      false,
      "Can't close the modal in this composer step. Doing nothing"
    );
    return state;
  }
  if (composer[modalToClose] !== OneTimeModalState.Showing) {
    return state;
  }
  return {
    ...state,
    composer: {
      ...composer,
      [modalToClose]: OneTimeModalState.Shown,
    },
  };
}

function getVerificationDataForConversation({
  conversationId,
  distributionId,
  state,
  untrustedServiceIds,
}: {
  conversationId: string;
  distributionId?: StoryDistributionIdString;
  state: Readonly<VerificationDataByConversation>;
  untrustedServiceIds: ReadonlyArray<ServiceIdString>;
}): VerificationDataByConversation {
  const existing = getOwn(state, conversationId);

  if (
    !existing ||
    existing.type === ConversationVerificationState.VerificationCancelled
  ) {
    return {
      [conversationId]: {
        type: ConversationVerificationState.PendingVerification as const,
        serviceIdsNeedingVerification: distributionId
          ? []
          : untrustedServiceIds,
        ...(distributionId
          ? {
              byDistributionId: {
                [distributionId]: {
                  serviceIdsNeedingVerification: untrustedServiceIds,
                },
              },
            }
          : undefined),
      },
    };
  }

  const existingServiceIds = distributionId
    ? existing.byDistributionId?.[distributionId]?.serviceIdsNeedingVerification
    : existing.serviceIdsNeedingVerification;

  const serviceIdsNeedingVerification: ReadonlyArray<ServiceIdString> =
    Array.from(
      new Set([...(existingServiceIds || []), ...untrustedServiceIds])
    );

  return {
    [conversationId]: {
      ...existing,
      type: ConversationVerificationState.PendingVerification as const,
      ...(distributionId ? undefined : { serviceIdsNeedingVerification }),
      ...(distributionId
        ? {
            byDistributionId: {
              ...existing.byDistributionId,
              [distributionId]: {
                serviceIdsNeedingVerification,
              },
            },
          }
        : undefined),
    },
  };
}

// Return same data, and we do nothing. Return undefined, and we'll delete the list.
type DistributionVisitor = ReadonlyDeep<
  (
    id: string,
    data: DistributionVerificationData
  ) => DistributionVerificationData | undefined
>;

function visitListsInVerificationData(
  existing: VerificationDataByConversation,
  visitor: DistributionVisitor
): VerificationDataByConversation {
  let result = existing;

  Object.entries(result).forEach(([conversationId, conversationData]) => {
    if (
      conversationData.type !==
      ConversationVerificationState.PendingVerification
    ) {
      return;
    }

    const { byDistributionId } = conversationData;
    if (!byDistributionId) {
      return;
    }

    let updatedByDistributionId = byDistributionId;
    Object.entries(byDistributionId).forEach(
      ([distributionId, distributionData]) => {
        const visitorResult = visitor(distributionId, distributionData);

        if (!visitorResult) {
          updatedByDistributionId = omit(updatedByDistributionId, [
            distributionId,
          ]);
        } else if (visitorResult !== distributionData) {
          updatedByDistributionId = {
            ...updatedByDistributionId,
            [distributionId]: visitorResult,
          };
        }
      }
    );

    const listCount = Object.keys(updatedByDistributionId).length;
    if (
      conversationData.serviceIdsNeedingVerification.length === 0 &&
      listCount === 0
    ) {
      result = omit(result, [conversationId]);
    } else if (listCount === 0) {
      result = {
        ...result,
        [conversationId]: omit(conversationData, ['byDistributionId']),
      };
    } else if (updatedByDistributionId !== byDistributionId) {
      result = {
        ...result,
        [conversationId]: {
          ...conversationData,
          byDistributionId: updatedByDistributionId,
        },
      };
    }
  });

  return result;
}

function maybeUpdateSelectedMessageForDetails(
  {
    messageId,
    targetedMessageForDetails,
  }: {
    messageId: string;
    targetedMessageForDetails: MessageAttributesType | undefined;
  },
  state: ConversationsStateType
): ConversationsStateType {
  if (!state.targetedMessageForDetails) {
    return state;
  }

  if (state.targetedMessageForDetails.id !== messageId) {
    return state;
  }

  return {
    ...state,
    targetedMessageForDetails,
  };
}

export function updateLastMessage(
  conversationId: string
): ThunkAction<void, RootStateType, unknown, never> {
  return async () => {
    const conversationModel = window.ConversationController.get(conversationId);
    if (conversationModel == null) {
      throw new Error(
        `updateLastMessage: Could not find conversation ${conversationId}`
      );
    }
    await conversationModel.updateLastMessage();
  };
}

export function reducer(
  state: Readonly<ConversationsStateType> = getEmptyState(),
  action: Readonly<
    | ConversationActionType
    | StoryDistributionListsActionType
    | ChangeNavTabActionType
  >
): ConversationsStateType {
  if (action.type === CLEAR_CONVERSATIONS_PENDING_VERIFICATION) {
    return {
      ...state,
      verificationDataByConversation: {},
    };
  }

  if (action.type === CLEAR_CANCELLED_VERIFICATION) {
    const { conversationId } = action.payload;
    const { verificationDataByConversation } = state;

    const existing = getOwn(verificationDataByConversation, conversationId);

    // If there are active verifications required, this will do nothing.
    if (
      existing &&
      existing.type === ConversationVerificationState.PendingVerification
    ) {
      return state;
    }

    return {
      ...state,
      verificationDataByConversation: omit(
        verificationDataByConversation,
        conversationId
      ),
    };
  }

  if (action.type === CANCEL_CONVERSATION_PENDING_VERIFICATION) {
    const { canceledAt } = action.payload;
    const { verificationDataByConversation } = state;
    const newverificationDataByConversation: Record<
      string,
      ConversationVerificationData
    > = {};

    const entries = Object.entries(verificationDataByConversation);
    if (!entries.length) {
      log.warn(
        'CANCEL_CONVERSATION_PENDING_VERIFICATION: No conversations pending verification'
      );
      return state;
    }

    for (const [conversationId, data] of entries) {
      if (
        data.type === ConversationVerificationState.VerificationCancelled &&
        data.canceledAt > canceledAt
      ) {
        newverificationDataByConversation[conversationId] = data;
      } else {
        newverificationDataByConversation[conversationId] = {
          type: ConversationVerificationState.VerificationCancelled,
          canceledAt,
        };
      }
    }

    return {
      ...state,
      verificationDataByConversation: newverificationDataByConversation,
    };
  }

  if (action.type === 'CLEAR_INVITED_SERVICE_IDS_FOR_NEWLY_CREATED_GROUP') {
    return omit(state, 'invitedServiceIdsForNewlyCreatedGroup');
  }

  if (action.type === 'CLEAR_GROUP_CREATION_ERROR') {
    const { composer } = state;
    if (composer?.step !== ComposerStep.SetGroupMetadata) {
      assertDev(
        false,
        "Can't clear group creation error in this composer state. Doing nothing"
      );
      return state;
    }
    return {
      ...state,
      composer: {
        ...composer,
        hasError: false,
      },
    };
  }

  if (action.type === 'CLOSE_CONTACT_SPOOFING_REVIEW') {
    return omit(state, 'contactSpoofingReview');
  }

  if (action.type === 'CLOSE_MAXIMUM_GROUP_SIZE_MODAL') {
    return closeComposerModal(state, 'maximumGroupSizeModalState' as const);
  }

  if (action.type === 'CLOSE_RECOMMENDED_GROUP_SIZE_MODAL') {
    return closeComposerModal(state, 'recommendedGroupSizeModalState' as const);
  }

  if (action.type === DISCARD_MESSAGES) {
    if (state.selectedMessageIds != null) {
      log.info('Not discarding messages because we are in select mode');
      return state;
    }

    const { conversationId } = action.payload;
    if ('numberToKeepAtBottom' in action.payload) {
      const { numberToKeepAtBottom } = action.payload;
      const conversationMessages = getOwn(
        state.messagesByConversation,
        conversationId
      );
      if (!conversationMessages) {
        return state;
      }

      const { messageIds: oldMessageIds } = conversationMessages;
      if (oldMessageIds.length <= numberToKeepAtBottom) {
        return state;
      }

      const messageIdsToRemove = oldMessageIds.slice(0, -numberToKeepAtBottom);
      const messageIdsToKeep = oldMessageIds.slice(-numberToKeepAtBottom);

      return {
        ...state,
        messagesLookup: omit(state.messagesLookup, messageIdsToRemove),
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: {
            ...conversationMessages,
            messageIds: messageIdsToKeep,
          },
        },
      };
    }

    if ('numberToKeepAtTop' in action.payload) {
      const { numberToKeepAtTop } = action.payload;
      const conversationMessages = getOwn(
        state.messagesByConversation,
        conversationId
      );
      if (!conversationMessages) {
        return state;
      }

      const { messageIds: oldMessageIds } = conversationMessages;
      if (oldMessageIds.length <= numberToKeepAtTop) {
        return state;
      }

      const messageIdsToRemove = oldMessageIds.slice(numberToKeepAtTop);
      const messageIdsToKeep = oldMessageIds.slice(0, numberToKeepAtTop);

      return {
        ...state,
        messagesLookup: omit(state.messagesLookup, messageIdsToRemove),
        messagesByConversation: {
          ...state.messagesByConversation,
          [conversationId]: {
            ...conversationMessages,
            messageIds: messageIdsToKeep,
          },
        },
      };
    }

    throw missingCaseError(action.payload);
  }

  if (action.type === 'SET_PRE_JOIN_CONVERSATION') {
    const { payload } = action;
    const { data } = payload;

    return {
      ...state,
      preJoinConversation: data,
    };
  }
  if (action.type === 'CONVERSATION_ADDED') {
    const { payload } = action;
    const { id, data } = payload;
    const { conversationLookup } = state;

    return {
      ...state,
      conversationLookup: {
        ...conversationLookup,
        [id]: data,
      },
      ...updateConversationLookups(data, undefined, state),
    };
  }
  if (action.type === 'CONVERSATION_CHANGED') {
    const { payload } = action;
    const { id, data } = payload;
    const { conversationLookup } = state;

    const { selectedConversationId } = state;
    let { showArchived } = state;

    const existing = conversationLookup[id];
    // We only modify the lookup if we already had that conversation and the conversation
    //   changed.
    if (!existing || data === existing) {
      return state;
    }

    const keysToOmit: Array<keyof ConversationsStateType> = [];

    if (selectedConversationId === id) {
      // Archived -> Inbox: we go back to the normal inbox view
      if (existing.isArchived && !data.isArchived) {
        showArchived = false;
      }
      // Inbox -> Archived: no conversation is selected
      // Note: With today's stacked conversations architecture, this can result in weird
      //   behavior - no selected conversation in the left pane, but a conversation show
      //   in the right pane.
      if (!existing.isArchived && data.isArchived) {
        keysToOmit.push('selectedConversationId');
      }

      if (!existing.isBlocked && data.isBlocked) {
        keysToOmit.push('contactSpoofingReview');
      }
    }

    return {
      ...omit(state, keysToOmit),
      selectedConversationId,
      showArchived,
      conversationLookup: {
        ...conversationLookup,
        [id]: data,
      },
      ...updateConversationLookups(data, existing, state),
    };
  }
  if (action.type === 'CONVERSATION_REMOVED') {
    const { payload } = action;
    const { id } = payload;
    const { conversationLookup } = state;
    const existing = getOwn(conversationLookup, id);

    // No need to make a change if we didn't have a record of this conversation!
    if (!existing) {
      return state;
    }

    return {
      ...state,
      conversationLookup: omit(conversationLookup, [id]),
      ...updateConversationLookups(undefined, existing, state),
    };
  }
  if (action.type === CONVERSATION_UNLOADED) {
    const { payload } = action;
    const { conversationId } = payload;
    const existingConversation = state.messagesByConversation[conversationId];
    if (!existingConversation) {
      return state;
    }

    const { messageIds } = existingConversation;
    const selectedConversationId =
      state.selectedConversationId !== conversationId
        ? state.selectedConversationId
        : undefined;

    return {
      ...omit(state, 'contactSpoofingReview'),
      selectedConversationId,
      targetedConversationPanels: {
        isAnimating: false,
        wasAnimated: false,
        direction: undefined,
        stack: [],
        watermark: -1,
      },
      messagesLookup: omit(state.messagesLookup, [...messageIds]),
      messagesByConversation: omit(state.messagesByConversation, [
        conversationId,
      ]),
    };
  }
  if (action.type === 'CONVERSATIONS_REMOVE_ALL') {
    return getEmptyState();
  }
  if (action.type === 'CREATE_GROUP_PENDING') {
    const { composer } = state;
    if (composer?.step !== ComposerStep.SetGroupMetadata) {
      // This should be unlikely, but it can happen if someone closes the composer while
      //   a group is being created.
      return state;
    }
    return {
      ...state,
      composer: {
        ...composer,
        hasError: false,
        isCreating: true,
      },
    };
  }
  if (action.type === 'CREATE_GROUP_FULFILLED') {
    // We don't do much here and instead rely on `showConversation` to do most of
    //   the work.
    return {
      ...state,
      invitedServiceIdsForNewlyCreatedGroup: action.payload.invitedServiceIds,
    };
  }
  if (action.type === 'CREATE_GROUP_REJECTED') {
    const { composer } = state;
    if (composer?.step !== ComposerStep.SetGroupMetadata) {
      // This should be unlikely, but it can happen if someone closes the composer while
      //   a group is being created.
      return state;
    }
    return {
      ...state,
      composer: {
        ...composer,
        hasError: true,
        isCreating: false,
      },
    };
  }
  if (action.type === 'MESSAGE_TARGETED') {
    const { messageId, conversationId } = action.payload;

    if (state.selectedConversationId !== conversationId) {
      return state;
    }

    return {
      ...state,
      targetedMessage: messageId,
      targetedMessageCounter: state.targetedMessageCounter + 1,
      targetedMessageSource: TargetedMessageSource.Focus,
    };
  }

  if (action.type === 'TOGGLE_SELECT_MESSAGES') {
    const { toggledMessageId, messageIds, selected } = action.payload;
    let { selectedMessageIds = [] } = state;

    if (selected) {
      selectedMessageIds = selectedMessageIds.concat(messageIds);
    } else {
      selectedMessageIds = selectedMessageIds.filter(
        id => !messageIds.includes(id)
      );
    }

    const lastSelectedMessage = getOwn(state.messagesLookup, toggledMessageId);

    strictAssert(lastSelectedMessage, 'Message not found in lookup');

    return {
      ...state,
      lastSelectedMessage: selected
        ? pick(lastSelectedMessage, 'sent_at', 'received_at')
        : undefined,
      selectedMessageIds,
    };
  }

  if (action.type === 'TOGGLE_SELECT_MODE') {
    const { on } = action.payload;
    const { selectedMessageIds = [] } = state;
    return {
      ...state,
      lastSelectedMessage: undefined,
      selectedMessageIds: on ? selectedMessageIds : undefined,
    };
  }

  if (action.type === MODIFY_LIST) {
    const {
      id: listId,
      isBlockList,
      membersToRemove,
      membersToAdd,
    } = action.payload;
    const removedServiceIds = new Set(
      isBlockList ? membersToAdd : membersToRemove
    );

    const nextVerificationData = visitListsInVerificationData(
      state.verificationDataByConversation,
      (id, data): DistributionVerificationData | undefined => {
        if (listId === id) {
          const serviceIdsNeedingVerification =
            data.serviceIdsNeedingVerification.filter(
              serviceId => !removedServiceIds.has(serviceId)
            );

          if (!serviceIdsNeedingVerification.length) {
            return undefined;
          }
          return {
            ...data,
            serviceIdsNeedingVerification,
          };
        }

        return data;
      }
    );

    if (nextVerificationData === state.verificationDataByConversation) {
      return state;
    }

    return {
      ...state,
      verificationDataByConversation: nextVerificationData,
    };
  }
  if (action.type === DELETE_LIST) {
    const { listId } = action.payload;

    const nextVerificationData = visitListsInVerificationData(
      state.verificationDataByConversation,
      (id, data): DistributionVerificationData | undefined => {
        if (listId === id) {
          return undefined;
        }

        return data;
      }
    );

    if (nextVerificationData === state.verificationDataByConversation) {
      return state;
    }

    return {
      ...state,
      verificationDataByConversation: nextVerificationData,
    };
  }
  if (action.type === HIDE_MY_STORIES_FROM) {
    const removedServiceIds = new Set(action.payload);

    const nextVerificationData = visitListsInVerificationData(
      state.verificationDataByConversation,
      (id, data): DistributionVerificationData | undefined => {
        if (MY_STORY_ID === id) {
          const serviceIdsNeedingVerification =
            data.serviceIdsNeedingVerification.filter(
              serviceId => !removedServiceIds.has(serviceId)
            );

          if (!serviceIdsNeedingVerification.length) {
            return undefined;
          }

          return {
            ...data,
            serviceIdsNeedingVerification,
          };
        }

        return data;
      }
    );

    if (nextVerificationData === state.verificationDataByConversation) {
      return state;
    }

    return {
      ...state,
      verificationDataByConversation: nextVerificationData,
    };
  }
  if (action.type === VIEWERS_CHANGED) {
    const { listId, memberServiceIds } = action.payload;
    const newServiceIds = new Set(memberServiceIds);

    const nextVerificationData = visitListsInVerificationData(
      state.verificationDataByConversation,
      (id, data): DistributionVerificationData | undefined => {
        if (listId === id) {
          const serviceIdsNeedingVerification =
            data.serviceIdsNeedingVerification.filter(serviceId =>
              newServiceIds.has(serviceId)
            );

          if (!serviceIdsNeedingVerification.length) {
            return undefined;
          }

          return {
            ...data,
            serviceIdsNeedingVerification,
          };
        }

        return data;
      }
    );

    if (nextVerificationData === state.verificationDataByConversation) {
      return state;
    }

    return {
      ...state,
      verificationDataByConversation: nextVerificationData,
    };
  }

  if (action.type === CONVERSATION_STOPPED_BY_MISSING_VERIFICATION) {
    const { conversationId, distributionId, untrustedServiceIds } =
      action.payload;

    const nextVerificationData = getVerificationDataForConversation({
      conversationId,
      distributionId,
      state: state.verificationDataByConversation,
      untrustedServiceIds,
    });

    return {
      ...state,
      verificationDataByConversation: {
        ...state.verificationDataByConversation,
        ...nextVerificationData,
      },
    };
  }
  if (action.type === SHOW_SEND_ANYWAY_DIALOG) {
    const verificationDataByConversation = {
      ...state.verificationDataByConversation,
    };

    Object.entries(action.payload.untrustedByConversation).forEach(
      ([conversationId, conversationData]) => {
        const nextConversation = getVerificationDataForConversation({
          state: verificationDataByConversation,
          conversationId,
          untrustedServiceIds: conversationData.serviceIds,
        });
        Object.assign(verificationDataByConversation, nextConversation);

        if (!conversationData.byDistributionId) {
          return;
        }

        Object.entries(conversationData.byDistributionId).forEach(
          ([distributionId, distributionData]) => {
            const nextDistribution = getVerificationDataForConversation({
              state: verificationDataByConversation,
              distributionId: normalizeStoryDistributionId(
                distributionId,
                'ducks/conversations'
              ),
              conversationId,
              untrustedServiceIds: distributionData.serviceIds,
            });
            Object.assign(verificationDataByConversation, nextDistribution);
          }
        );
      }
    );

    return {
      ...state,
      verificationDataByConversation,
    };
  }

  if (action.type === MESSAGE_CHANGED) {
    const { id, conversationId, data } = action.payload;
    const existingConversation = state.messagesByConversation[conversationId];

    // We don't keep track of messages unless their conversation is loaded...
    if (!existingConversation) {
      return maybeUpdateSelectedMessageForDetails(
        { messageId: id, targetedMessageForDetails: data },
        state
      );
    }

    // ...and we've already loaded that message once
    const existingMessage = getOwn(state.messagesLookup, id);
    if (!existingMessage) {
      return maybeUpdateSelectedMessageForDetails(
        { messageId: id, targetedMessageForDetails: data },
        state
      );
    }

    const conversationAttrs = state.conversationLookup[conversationId];
    const isGroupStoryReply = isGroup(conversationAttrs) && data.storyId;
    if (isGroupStoryReply) {
      return state;
    }

    const hasNewEdit =
      existingMessage.editHistory?.length !== data.editHistory?.length ? 1 : 0;
    const toIncrement = data.reactions?.length || hasNewEdit;

    const updatedMessage = {
      ...data,
      displayLimit: existingMessage.displayLimit,
      isSpoilerExpanded: hasNewEdit
        ? undefined
        : existingMessage.isSpoilerExpanded,
    };

    return {
      ...maybeUpdateSelectedMessageForDetails(
        {
          messageId: id,
          targetedMessageForDetails: updatedMessage,
        },
        state
      ),
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: {
          ...existingConversation,
          messageChangeCounter:
            (existingConversation.messageChangeCounter || 0) + toIncrement,
        },
      },
      messagesLookup: {
        ...state.messagesLookup,
        [id]: updatedMessage,
      },
    };
  }

  if (action.type === MESSAGE_EXPIRED) {
    return maybeUpdateSelectedMessageForDetails(
      { messageId: action.payload.id, targetedMessageForDetails: undefined },
      state
    );
  }

  if (action.type === 'MESSAGE_EXPANDED') {
    const { id, displayLimit } = action.payload;

    const existingMessage = state.messagesLookup[id];
    if (!existingMessage) {
      return state;
    }

    const updatedMessage = {
      ...existingMessage,
      displayLimit,
    };

    return {
      ...state,
      ...maybeUpdateSelectedMessageForDetails(
        {
          messageId: id,
          targetedMessageForDetails: updatedMessage,
        },
        state
      ),
      messagesLookup: {
        ...state.messagesLookup,
        [id]: updatedMessage,
      },
    };
  }
  if (action.type === SHOW_SPOILER) {
    const { id, data } = action.payload;

    const existingMessage = state.messagesLookup[id];
    if (!existingMessage) {
      return state;
    }

    const updatedMessage = {
      ...existingMessage,
      isSpoilerExpanded: data,
    };

    return {
      ...state,
      ...maybeUpdateSelectedMessageForDetails(
        {
          messageId: id,
          targetedMessageForDetails: updatedMessage,
        },
        state
      ),
      messagesLookup: {
        ...state.messagesLookup,
        [id]: updatedMessage,
      },
    };
  }

  if (action.type === 'MESSAGES_RESET') {
    const {
      conversationId,
      messages,
      metrics,
      scrollToMessageId,
      unboundedFetch,
    } = action.payload;
    const { messagesByConversation, messagesLookup } = state;

    const existingConversation = messagesByConversation[conversationId];

    const lookup = fromPairs(messages.map(message => [message.id, message]));
    const sorted = orderBy(
      values(lookup),
      ['received_at', 'sent_at'],
      ['ASC', 'ASC']
    );

    let { newest, oldest } = metrics;

    // If our metrics are a little out of date, we'll fix them up
    if (sorted.length > 0) {
      const first = sorted[0];
      if (first && (!oldest || first.received_at <= oldest.received_at)) {
        oldest = pick(first, ['id', 'received_at', 'sent_at']);
      }

      const last = sorted[sorted.length - 1];
      if (
        last &&
        (!newest || unboundedFetch || last.received_at >= newest.received_at)
      ) {
        newest = pick(last, ['id', 'received_at', 'sent_at']);
      }
    }

    const messageIds = sorted.map(message => message.id);

    return {
      ...state,
      ...(state.selectedConversationId === conversationId
        ? {
            targetedMessage: scrollToMessageId,
            targetedMessageCounter: state.targetedMessageCounter + 1,
            targetedMessageSource: TargetedMessageSource.Reset,
          }
        : {}),
      messagesLookup: {
        ...messagesLookup,
        ...lookup,
      },
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: {
          messageChangeCounter: 0,
          scrollToMessageId,
          scrollToMessageCounter: existingConversation
            ? existingConversation.scrollToMessageCounter + 1
            : 0,
          messageIds,
          metrics: {
            ...metrics,
            newest,
            oldest,
          },
        },
      },
    };
  }
  if (action.type === 'SET_MESSAGE_LOADING_STATE') {
    const { payload } = action;
    const { conversationId, messageLoadingState } = payload;

    const { messagesByConversation } = state;
    const existingConversation = messagesByConversation[conversationId];

    if (!existingConversation) {
      return state;
    }

    return {
      ...state,
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: {
          ...existingConversation,
          messageLoadingState,
        },
      },
    };
  }
  if (action.type === 'SET_NEAR_BOTTOM') {
    const { payload } = action;
    const { conversationId, isNearBottom } = payload;

    const { messagesByConversation } = state;
    const existingConversation = messagesByConversation[conversationId];

    if (
      !existingConversation ||
      existingConversation.isNearBottom === isNearBottom
    ) {
      return state;
    }

    return {
      ...state,
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: {
          ...existingConversation,
          isNearBottom,
        },
      },
    };
  }
  if (action.type === 'SCROLL_TO_MESSAGE') {
    const { payload } = action;
    const { conversationId, messageId } = payload;

    const { messagesByConversation, messagesLookup } = state;
    const existingConversation = messagesByConversation[conversationId];

    if (!existingConversation) {
      return state;
    }
    if (!messagesLookup[messageId]) {
      return state;
    }
    if (!existingConversation.messageIds.includes(messageId)) {
      return state;
    }

    return {
      ...state,
      targetedMessage: messageId,
      targetedMessageCounter: state.targetedMessageCounter + 1,
      targetedMessageSource: TargetedMessageSource.NavigateToMessage,
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: {
          ...existingConversation,
          messageLoadingState: undefined,
          scrollToMessageId: messageId,
          scrollToMessageCounter:
            existingConversation.scrollToMessageCounter + 1,
        },
      },
      targetedConversationPanels: {
        ...state.targetedConversationPanels,
        watermark: -1,
      },
    };
  }
  if (action.type === MESSAGE_DELETED) {
    const { id, conversationId } = action.payload;
    const { messagesByConversation, messagesLookup } = state;

    const existingConversation = messagesByConversation[conversationId];
    if (!existingConversation) {
      return maybeUpdateSelectedMessageForDetails(
        { messageId: id, targetedMessageForDetails: undefined },
        state
      );
    }

    // Assuming that we always have contiguous groups of messages in memory, the removal
    //   of one message at one end of our message set be replaced with the message right
    //   next to it.
    const oldIds = existingConversation.messageIds;
    let { newest, oldest } = existingConversation.metrics;

    if (oldIds.length > 1) {
      const firstId = oldIds[0];
      const lastId = oldIds[oldIds.length - 1];

      if (oldest && oldest.id === firstId && firstId === id) {
        const second = messagesLookup[oldIds[1]];
        oldest = second
          ? pick(second, ['id', 'received_at', 'sent_at'])
          : undefined;
      }
      if (newest && newest.id === lastId && lastId === id) {
        const penultimate = messagesLookup[oldIds[oldIds.length - 2]];
        newest = penultimate
          ? pick(penultimate, ['id', 'received_at', 'sent_at'])
          : undefined;
      }
    }

    // Removing it from our caches
    const messageIds = without(existingConversation.messageIds, id);

    let metrics;
    if (messageIds.length === 0) {
      metrics = {
        totalUnseen: 0,
      };
    } else {
      metrics = {
        ...existingConversation.metrics,
        oldest,
        newest,
      };
    }

    return {
      ...maybeUpdateSelectedMessageForDetails(
        { messageId: id, targetedMessageForDetails: undefined },
        state
      ),
      messagesLookup: omit(messagesLookup, id),
      messagesByConversation: {
        [conversationId]: {
          ...existingConversation,
          messageIds,
          metrics,
        },
      },
    };
  }

  if (action.type === 'REPAIR_NEWEST_MESSAGE') {
    const { conversationId } = action.payload;
    const { messagesByConversation, messagesLookup } = state;

    const existingConversation = getOwn(messagesByConversation, conversationId);
    if (!existingConversation) {
      return state;
    }

    const { messageIds } = existingConversation;
    const lastId =
      messageIds && messageIds.length
        ? messageIds[messageIds.length - 1]
        : undefined;
    const last = lastId ? getOwn(messagesLookup, lastId) : undefined;
    const newest = last
      ? pick(last, ['id', 'received_at', 'sent_at'])
      : undefined;

    return {
      ...state,
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: {
          ...existingConversation,
          metrics: {
            ...existingConversation.metrics,
            newest,
          },
        },
      },
    };
  }

  if (action.type === 'REPAIR_OLDEST_MESSAGE') {
    const { conversationId } = action.payload;
    const { messagesByConversation, messagesLookup } = state;

    const existingConversation = getOwn(messagesByConversation, conversationId);
    if (!existingConversation) {
      return state;
    }

    const { messageIds } = existingConversation;
    const firstId = messageIds && messageIds.length ? messageIds[0] : undefined;
    const first = firstId ? getOwn(messagesLookup, firstId) : undefined;
    const oldest = first
      ? pick(first, ['id', 'received_at', 'sent_at'])
      : undefined;

    return {
      ...state,
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: {
          ...existingConversation,
          metrics: {
            ...existingConversation.metrics,
            oldest,
          },
        },
      },
    };
  }

  if (action.type === 'REVIEW_GROUP_MEMBER_NAME_COLLISION') {
    return {
      ...state,
      contactSpoofingReview: {
        type: ContactSpoofingType.MultipleGroupMembersWithSameTitle,
        ...action.payload,
      },
    };
  }

  if (action.type === 'REVIEW_MESSAGE_REQUEST_NAME_COLLISION') {
    return {
      ...state,
      contactSpoofingReview: {
        type: ContactSpoofingType.DirectConversationWithSameTitle,
        ...action.payload,
      },
    };
  }

  if (action.type === 'MESSAGES_ADDED') {
    const { conversationId, isActive, isJustSent, isNewMessage, messages } =
      action.payload;
    const { messagesByConversation, messagesLookup } = state;

    const existingConversation = messagesByConversation[conversationId];
    if (!existingConversation) {
      return state;
    }

    let { newest, oldest, oldestUnseen, totalUnseen } =
      existingConversation.metrics;

    if (messages.length < 1) {
      return state;
    }

    const lookup = fromPairs(
      existingConversation.messageIds.map(id => [id, messagesLookup[id]])
    );
    messages.forEach(message => {
      lookup[message.id] = message;
    });

    const sorted = orderBy(
      values(lookup),
      ['received_at', 'sent_at'],
      ['ASC', 'ASC']
    );
    const messageIds = sorted.map(message => message.id);

    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    if (!newest) {
      newest = pick(first, ['id', 'received_at', 'sent_at']);
    }
    if (!oldest) {
      oldest = pick(last, ['id', 'received_at', 'sent_at']);
    }

    const existingTotal = existingConversation.messageIds.length;
    if (isNewMessage && existingTotal > 0) {
      const lastMessageId = existingConversation.messageIds[existingTotal - 1];

      // If our messages in memory don't include the most recent messages, then we
      //   won't add new messages to our message list.
      const haveLatest = newest && newest.id === lastMessageId;
      if (!haveLatest) {
        if (isJustSent) {
          log.warn(
            'reducer/MESSAGES_ADDED: isJustSent is true, but haveLatest is false'
          );
        }

        return state;
      }
    }

    // Update oldest and newest if we receive older/newer
    // messages (or duplicated timestamps!)
    if (first && oldest && first.received_at <= oldest.received_at) {
      oldest = pick(first, ['id', 'received_at', 'sent_at']);
    }
    if (last && newest && last.received_at >= newest.received_at) {
      newest = pick(last, ['id', 'received_at', 'sent_at']);
    }

    const newIds = messages.map(message => message.id);
    const newMessageIds = difference(newIds, existingConversation.messageIds);
    const { isNearBottom } = existingConversation;

    if ((!isNearBottom || !isActive) && !oldestUnseen) {
      const oldestId = newMessageIds.find(messageId => {
        const message = lookup[messageId];

        return message && isMessageUnread(message);
      });

      if (oldestId) {
        oldestUnseen = pick(lookup[oldestId], [
          'id',
          'received_at',
          'sent_at',
        ]) as MessagePointerType;
      }
    }

    // If this is a new incoming message, we'll increment our totalUnseen count
    if (isNewMessage && !isJustSent && oldestUnseen) {
      const newUnread: number = newMessageIds.reduce((sum, messageId) => {
        const message = lookup[messageId];

        return sum + (message && isMessageUnread(message) ? 1 : 0);
      }, 0);
      totalUnseen = (totalUnseen || 0) + newUnread;
    }

    return {
      ...state,
      messagesLookup: {
        ...messagesLookup,
        ...lookup,
      },
      messagesByConversation: {
        ...messagesByConversation,
        [conversationId]: {
          ...existingConversation,
          messageIds,
          messageLoadingState: undefined,
          scrollToMessageId: isJustSent ? last.id : undefined,
          metrics: {
            ...existingConversation.metrics,
            newest,
            oldest,
            totalUnseen,
            oldestUnseen,
          },
        },
      },
    };
  }
  if (action.type === 'CLEAR_TARGETED_MESSAGE') {
    return {
      ...state,
      targetedMessage: undefined,
      targetedMessageCounter: 0,
      targetedMessageSource: undefined,
    };
  }
  if (action.type === 'CLEAR_UNREAD_METRICS') {
    const { payload } = action;
    const { conversationId } = payload;
    const existingConversation = state.messagesByConversation[conversationId];

    if (!existingConversation) {
      return state;
    }

    return {
      ...state,
      messagesByConversation: {
        ...state.messagesByConversation,
        [conversationId]: {
          ...existingConversation,
          metrics: {
            ...existingConversation.metrics,
            oldestUnseen: undefined,
            totalUnseen: 0,
          },
        },
      },
    };
  }
  if (action.type === TARGETED_CONVERSATION_CHANGED) {
    const { payload } = action;
    const { conversationId, messageId, switchToAssociatedView } = payload;

    let conversation: ConversationType | undefined;

    if (conversationId) {
      conversation = getOwn(state.conversationLookup, conversationId);
      if (!conversation) {
        log.error(`Unknown conversation selected, id: [${conversationId}]`);
        return state;
      }
    }

    const nextState = {
      ...omit(state, 'contactSpoofingReview'),
      selectedConversationId: conversationId,
      targetedMessage: messageId,
      targetedMessageSource: TargetedMessageSource.NavigateToMessage,
    };

    if (switchToAssociatedView && conversation) {
      return {
        ...omit(nextState, 'composer', 'selectedMessageIds'),
        showArchived: Boolean(conversation.isArchived),
      };
    }

    return nextState;
  }
  if (action.type === 'SHOW_INBOX') {
    return {
      ...omit(state, 'composer'),
      showArchived: false,
    };
  }
  if (action.type === 'SHOW_ARCHIVED_CONVERSATIONS') {
    return {
      ...omit(state, 'composer'),
      showArchived: true,
    };
  }

  if (action.type === PUSH_PANEL) {
    const currentStack = state.targetedConversationPanels.stack;
    const watermark = Math.min(
      state.targetedConversationPanels.watermark + 1,
      currentStack.length
    );
    const stack = [...currentStack.slice(0, watermark), action.payload];

    const targetedConversationPanels = {
      isAnimating: false,
      wasAnimated: false,
      direction: 'push' as const,
      stack,
      watermark,
    };

    if (action.payload.type === PanelType.MessageDetails) {
      return {
        ...state,
        targetedConversationPanels,
        targetedMessageForDetails: action.payload.args.message,
      };
    }

    return {
      ...state,
      targetedConversationPanels,
    };
  }

  if (action.type === POP_PANEL) {
    if (state.targetedConversationPanels.watermark === -1) {
      return state;
    }

    const poppedPanel =
      state.targetedConversationPanels.stack[
        state.targetedConversationPanels.watermark
      ];

    if (!poppedPanel) {
      return state;
    }

    const watermark = Math.max(
      state.targetedConversationPanels.watermark - 1,
      -1
    );

    const targetedConversationPanels = {
      isAnimating: false,
      wasAnimated: false,
      direction: 'pop' as const,
      stack: state.targetedConversationPanels.stack,
      watermark,
    };

    if (poppedPanel.type === PanelType.MessageDetails) {
      return {
        ...state,
        targetedConversationPanels,
        targetedMessageForDetails: undefined,
      };
    }

    return {
      ...state,
      targetedConversationPanels,
    };
  }

  if (action.type === PANEL_ANIMATION_STARTED) {
    return {
      ...state,
      targetedConversationPanels: {
        ...state.targetedConversationPanels,
        isAnimating: true,
      },
    };
  }

  if (action.type === PANEL_ANIMATION_DONE) {
    return {
      ...state,
      targetedConversationPanels: {
        ...state.targetedConversationPanels,
        isAnimating: false,
        wasAnimated: true,
      },
    };
  }

  if (action.type === 'SET_RECENT_MEDIA_ITEMS') {
    const { id, recentMediaItems } = action.payload;
    const { conversationLookup } = state;

    const conversationData = conversationLookup[id];

    if (!conversationData) {
      return state;
    }

    const data = {
      ...conversationData,
      recentMediaItems,
    };

    return {
      ...state,
      conversationLookup: {
        ...conversationLookup,
        [id]: data,
      },
      ...updateConversationLookups(data, undefined, state),
    };
  }

  if (action.type === 'START_COMPOSING') {
    if (state.composer?.step === ComposerStep.StartDirectConversation) {
      return state;
    }

    return {
      ...state,
      showArchived: false,
      composer: {
        step: ComposerStep.StartDirectConversation,
        searchTerm: '',
        uuidFetchState: {},
      },
    };
  }

  if (action.type === 'SHOW_CHOOSE_GROUP_MEMBERS') {
    let selectedConversationIds: ReadonlyArray<string>;
    let recommendedGroupSizeModalState: OneTimeModalState;
    let maximumGroupSizeModalState: OneTimeModalState;
    let groupName: string;
    let groupAvatar: undefined | Uint8Array;
    let groupExpireTimer: DurationInSeconds;
    let userAvatarData = getDefaultAvatars(true);

    switch (state.composer?.step) {
      case ComposerStep.ChooseGroupMembers:
        return state;
      case ComposerStep.SetGroupMetadata:
        ({
          selectedConversationIds,
          recommendedGroupSizeModalState,
          maximumGroupSizeModalState,
          groupName,
          groupAvatar,
          groupExpireTimer,
          userAvatarData,
        } = state.composer);
        break;
      default:
        selectedConversationIds = [];
        recommendedGroupSizeModalState = OneTimeModalState.NeverShown;
        maximumGroupSizeModalState = OneTimeModalState.NeverShown;
        groupName = '';
        groupExpireTimer = universalExpireTimer.get();
        break;
    }

    return {
      ...state,
      showArchived: false,
      composer: {
        step: ComposerStep.ChooseGroupMembers,
        searchTerm: '',
        uuidFetchState: {},
        selectedConversationIds,
        recommendedGroupSizeModalState,
        maximumGroupSizeModalState,
        groupName,
        groupAvatar,
        groupExpireTimer,
        userAvatarData,
      },
    };
  }

  if (action.type === 'START_SETTING_GROUP_METADATA') {
    const { composer } = state;

    switch (composer?.step) {
      case ComposerStep.ChooseGroupMembers:
        return {
          ...state,
          showArchived: false,
          composer: {
            step: ComposerStep.SetGroupMetadata,
            isEditingAvatar: false,
            isCreating: false,
            hasError: false,
            ...pick(composer, [
              'groupAvatar',
              'groupName',
              'groupExpireTimer',
              'maximumGroupSizeModalState',
              'recommendedGroupSizeModalState',
              'selectedConversationIds',
              'userAvatarData',
            ]),
          },
        };
      case ComposerStep.SetGroupMetadata:
        return state;
      default:
        assertDev(
          false,
          'Cannot transition to setting group metadata from this state'
        );
        return state;
    }
  }

  if (action.type === 'SET_COMPOSE_GROUP_AVATAR') {
    const { composer } = state;

    switch (composer?.step) {
      case ComposerStep.ChooseGroupMembers:
      case ComposerStep.SetGroupMetadata:
        return {
          ...state,
          composer: {
            ...composer,
            groupAvatar: action.payload.groupAvatar,
          },
        };
      default:
        assertDev(
          false,
          'Setting compose group avatar at this step is a no-op'
        );
        return state;
    }
  }

  if (action.type === 'SET_COMPOSE_GROUP_NAME') {
    const { composer } = state;

    switch (composer?.step) {
      case ComposerStep.ChooseGroupMembers:
      case ComposerStep.SetGroupMetadata:
        return {
          ...state,
          composer: {
            ...composer,
            groupName: action.payload.groupName,
          },
        };
      default:
        assertDev(false, 'Setting compose group name at this step is a no-op');
        return state;
    }
  }

  if (action.type === 'SET_COMPOSE_GROUP_EXPIRE_TIMER') {
    const { composer } = state;

    switch (composer?.step) {
      case ComposerStep.ChooseGroupMembers:
      case ComposerStep.SetGroupMetadata:
        return {
          ...state,
          composer: {
            ...composer,
            groupExpireTimer: action.payload.groupExpireTimer,
          },
        };
      default:
        assertDev(false, 'Setting compose group name at this step is a no-op');
        return state;
    }
  }

  if (action.type === 'SET_COMPOSE_SEARCH_TERM') {
    const { composer } = state;
    if (!composer) {
      assertDev(
        false,
        'Setting compose search term with the composer closed is a no-op'
      );
      return state;
    }
    if (
      composer.step !== ComposerStep.StartDirectConversation &&
      composer.step !== ComposerStep.ChooseGroupMembers
    ) {
      assertDev(
        false,
        `Setting compose search term at step ${composer.step} is a no-op`
      );
      return state;
    }

    return {
      ...state,
      composer: {
        ...composer,
        searchTerm: action.payload.searchTerm,
      },
    };
  }

  if (action.type === 'SET_IS_FETCHING_UUID') {
    const { composer } = state;
    if (!composer) {
      assertDev(
        false,
        'Setting compose serviceId fetch state with the composer closed is a no-op'
      );
      return state;
    }
    if (
      composer.step !== ComposerStep.StartDirectConversation &&
      composer.step !== ComposerStep.ChooseGroupMembers
    ) {
      assertDev(
        false,
        'Setting compose serviceId fetch state at this step is a no-op'
      );
      return state;
    }
    const { identifier, isFetching } = action.payload;

    const { uuidFetchState } = composer;

    return {
      ...state,
      composer: {
        ...composer,
        uuidFetchState: isFetching
          ? {
              ...composer.uuidFetchState,
              [identifier]: isFetching,
            }
          : omit(uuidFetchState, identifier),
      },
    };
  }

  if (action.type === COMPOSE_TOGGLE_EDITING_AVATAR) {
    const { composer } = state;

    switch (composer?.step) {
      case ComposerStep.SetGroupMetadata:
        return {
          ...state,
          composer: {
            ...composer,
            isEditingAvatar: !composer.isEditingAvatar,
          },
        };
      default:
        assertDev(false, 'Setting editing avatar at this step is a no-op');
        return state;
    }
  }

  if (action.type === COMPOSE_ADD_AVATAR) {
    const { payload } = action;
    const { composer } = state;

    switch (composer?.step) {
      case ComposerStep.ChooseGroupMembers:
      case ComposerStep.SetGroupMetadata:
        return {
          ...state,
          composer: {
            ...composer,
            userAvatarData: [
              {
                ...payload,
                id: getNextAvatarId(composer.userAvatarData),
              },
              ...composer.userAvatarData,
            ],
          },
        };
      default:
        assertDev(false, 'Adding an avatar at this step is a no-op');
        return state;
    }
  }

  if (action.type === COMPOSE_REMOVE_AVATAR) {
    const { payload } = action;
    const { composer } = state;

    switch (composer?.step) {
      case ComposerStep.ChooseGroupMembers:
      case ComposerStep.SetGroupMetadata:
        return {
          ...state,
          composer: {
            ...composer,
            userAvatarData: filterAvatarData(composer.userAvatarData, payload),
          },
        };
      default:
        assertDev(false, 'Removing an avatar at this step is a no-op');
        return state;
    }
  }

  if (action.type === COMPOSE_REPLACE_AVATAR) {
    const { curr, prev } = action.payload;
    const { composer } = state;

    switch (composer?.step) {
      case ComposerStep.ChooseGroupMembers:
      case ComposerStep.SetGroupMetadata:
        return {
          ...state,
          composer: {
            ...composer,
            userAvatarData: [
              {
                ...curr,
                id: prev?.id ?? getNextAvatarId(composer.userAvatarData),
              },
              ...(prev
                ? filterAvatarData(composer.userAvatarData, prev)
                : composer.userAvatarData),
            ],
          },
        };
      default:
        assertDev(false, 'Replacing an avatar at this step is a no-op');
        return state;
    }
  }

  if (action.type === 'TOGGLE_CONVERSATION_IN_CHOOSE_MEMBERS') {
    const { composer } = state;
    if (composer?.step !== ComposerStep.ChooseGroupMembers) {
      assertDev(
        false,
        'Toggling conversation members is a no-op in this composer step'
      );
      return state;
    }

    return {
      ...state,
      composer: {
        ...composer,
        ...toggleSelectedContactForGroupAddition(
          action.payload.conversationId,
          {
            maxGroupSize: action.payload.maxGroupSize,
            maxRecommendedGroupSize: action.payload.maxRecommendedGroupSize,
            maximumGroupSizeModalState: composer.maximumGroupSizeModalState,
            // We say you're already in the group, even though it hasn't been created yet.
            numberOfContactsAlreadyInGroup: 1,
            recommendedGroupSizeModalState:
              composer.recommendedGroupSizeModalState,
            selectedConversationIds: composer.selectedConversationIds,
          }
        ),
      },
    };
  }

  if (action.type === COLORS_CHANGED) {
    const { conversationLookup } = state;
    const { conversationColor, customColorData } = action.payload;

    const nextState = {
      ...state,
    };

    Object.keys(conversationLookup).forEach(id => {
      const existing = conversationLookup[id];
      const added = {
        ...existing,
        conversationColor,
        customColor: customColorData?.value,
        customColorId: customColorData?.id,
      };

      Object.assign(
        nextState,
        updateConversationLookups(added, existing, nextState),
        {
          conversationLookup: {
            ...nextState.conversationLookup,
            [id]: added,
          },
        }
      );
    });

    return nextState;
  }

  if (action.type === COLOR_SELECTED) {
    const { conversationLookup } = state;
    const { conversationId, conversationColor, customColorData } =
      action.payload;

    const existing = conversationLookup[conversationId];
    if (!existing) {
      return state;
    }

    const changed = {
      ...existing,
      conversationColor,
      customColor: customColorData?.value,
      customColorId: customColorData?.id,
    };

    return {
      ...state,
      conversationLookup: {
        ...conversationLookup,
        [conversationId]: changed,
      },
      ...updateConversationLookups(changed, existing, state),
    };
  }

  if (action.type === CUSTOM_COLOR_REMOVED) {
    const { conversationLookup } = state;
    const { colorId } = action.payload;

    const nextState = {
      ...state,
    };

    Object.keys(conversationLookup).forEach(id => {
      const existing = conversationLookup[id];

      if (existing.customColorId !== colorId) {
        return;
      }

      const changed = {
        ...existing,
        conversationColor: undefined,
        customColor: undefined,
        customColorId: undefined,
      };

      Object.assign(
        nextState,
        updateConversationLookups(changed, existing, nextState),
        {
          conversationLookup: {
            ...nextState.conversationLookup,
            [id]: changed,
          },
        }
      );
    });

    return nextState;
  }

  if (action.type === REPLACE_AVATARS) {
    const { conversationLookup } = state;
    const { conversationId, avatars } = action.payload;

    const conversation = conversationLookup[conversationId];
    if (!conversation) {
      return state;
    }

    const changed = {
      ...conversation,
      avatars,
    };

    return {
      ...state,
      conversationLookup: {
        ...conversationLookup,
        [conversationId]: changed,
      },
      ...updateConversationLookups(changed, conversation, state),
    };
  }

  if (
    action.type === CHANGE_NAV_TAB &&
    action.payload.selectedNavTab === NavTab.Chats
  ) {
    const { messagesByConversation, selectedConversationId } = state;
    if (selectedConversationId == null) {
      return state;
    }

    const existingConversation = messagesByConversation[selectedConversationId];
    if (existingConversation == null) {
      return state;
    }

    return {
      ...state,
      messagesByConversation: {
        ...messagesByConversation,
        [selectedConversationId]: {
          ...existingConversation,
          isNearBottom: true,
        },
      },
    };
  }

  return state;
}
