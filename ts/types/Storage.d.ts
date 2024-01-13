// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { AudioDevice } from '@signalapp/ringrtc';
import type {
  CustomColorsItemType,
  DefaultConversationColorType,
} from './Colors';
import type { AudioDeviceModule } from '../calling/audioDeviceModule';
import type { PhoneNumberDiscoverability } from '../util/phoneNumberDiscoverability';
import type { PhoneNumberSharingMode } from '../util/phoneNumberSharingMode';
import type { RetryItemType } from '../util/retryPlaceholders';
import type { ConfigMapType as RemoteConfigType } from '../RemoteConfig';
import type { SystemTraySetting } from './SystemTraySetting';
import type { ExtendedStorageID, UnknownRecord } from './StorageService.d';

import type { GroupCredentialType } from '../textsecure/WebAPI';
import type {
  SessionResetsType,
  StorageServiceCredentials,
} from '../textsecure/Types.d';
import type { ThemeSettingType } from './StorageUIKeys';
import type { ServiceIdString } from './ServiceId';

import type { RegisteredChallengeType } from '../challenge';

export type SerializedCertificateType = {
  expires: number;
  serialized: Uint8Array;
};

export type ZoomFactorType = 0.75 | 1 | 1.25 | 1.5 | 2 | number;

export type SentMediaQualitySettingType = 'standard' | 'high';

export type NotificationSettingType = 'message' | 'name' | 'count' | 'off';

export type IdentityKeyMap = Record<
  ServiceIdString,
  {
    privKey: Uint8Array;
    pubKey: Uint8Array;
  }
>;

// This should be in sync with `STORAGE_UI_KEYS` in `ts/types/StorageUIKeys.ts`.

export type StorageAccessType = {
  'always-relay-calls': boolean;
  'audio-notification': boolean;
  'auto-download-update': boolean;
  'badge-count-muted-conversations': boolean;
  'blocked-groups': ReadonlyArray<string>;
  'blocked-uuids': ReadonlyArray<ServiceIdString>;
  'call-ringtone-notification': boolean;
  'call-system-notification': boolean;
  'hide-menu-bar': boolean;
  'incoming-call-notification': boolean;
  localeOverride: string | null;
  'notification-draw-attention': boolean;
  'notification-setting': NotificationSettingType;
  'read-receipt-setting': boolean;
  'sent-media-quality': SentMediaQualitySettingType;
  'spell-check': boolean;
  'system-tray-setting': SystemTraySetting;
  'theme-setting': ThemeSettingType;
  audioMessage: boolean;
  attachmentMigration_isComplete: boolean;
  attachmentMigration_lastProcessedIndex: number;
  blocked: ReadonlyArray<string>;
  defaultConversationColor: DefaultConversationColorType;
  customColors: CustomColorsItemType;
  device_name: string;
  existingOnboardingStoryMessageIds: ReadonlyArray<string> | undefined;
  formattingWarningShown: boolean;
  hasRegisterSupportForUnauthenticatedDelivery: boolean;
  hasSetMyStoriesPrivacy: boolean;
  hasCompletedUsernameOnboarding: boolean;
  hasCompletedUsernameLinkOnboarding: boolean;
  hasCompletedSafetyNumberOnboarding: boolean;
  hasViewedOnboardingStory: boolean;
  hasStoriesDisabled: boolean;
  storyViewReceiptsEnabled: boolean;
  identityKeyMap: IdentityKeyMap;
  lastHeartbeat: number;
  lastStartup: number;
  lastAttemptedToRefreshProfilesAt: number;
  lastResortKeyUpdateTime: number;
  lastResortKeyUpdateTimePNI: number;
  masterKey: string;
  masterKeyLastRequestTime: number;
  maxPreKeyId: number;
  maxPreKeyIdPNI: number;
  maxKyberPreKeyId: number;
  maxKyberPreKeyIdPNI: number;
  number_id: string;
  password: string;
  profileKey: Uint8Array;
  regionCode: string;
  registrationIdMap: Record<ServiceIdString, number>;
  remoteBuildExpiration: number;
  sendEditWarningShown: boolean;
  sessionResets: SessionResetsType;
  showStickerPickerHint: boolean;
  showStickersIntroduction: boolean;
  signedKeyId: number;
  signedKeyIdPNI: number;
  signedKeyUpdateTime: number;
  signedKeyUpdateTimePNI: number;
  storageKey: string;
  synced_at: number;
  userAgent: string;
  uuid_id: string;
  pni: string;
  version: string;
  linkPreviews: boolean;
  universalExpireTimer: number;
  retryPlaceholders: ReadonlyArray<RetryItemType>;
  chromiumRegistrationDoneEver: '';
  chromiumRegistrationDone: '';
  phoneNumberSharingMode: PhoneNumberSharingMode;
  phoneNumberDiscoverability: PhoneNumberDiscoverability;
  pinnedConversationIds: ReadonlyArray<string>;
  preferContactAvatars: boolean;
  primarySendsSms: boolean;
  // Unlike `number_id` (which also includes device id) this field is only
  // updated whenever we receive a new storage manifest
  accountE164: string;
  textFormatting: boolean;
  typingIndicators: boolean;
  sealedSenderIndicators: boolean;
  storageFetchComplete: boolean;
  avatarUrl: string | undefined;
  manifestVersion: number;
  storageCredentials: StorageServiceCredentials;
  'storage-service-error-records': ReadonlyArray<UnknownRecord>;
  'storage-service-unknown-records': ReadonlyArray<UnknownRecord>;
  'storage-service-pending-deletes': ReadonlyArray<ExtendedStorageID>;
  'preferred-video-input-device': string;
  'preferred-audio-input-device': AudioDevice;
  'preferred-audio-output-device': AudioDevice;
  previousAudioDeviceModule: AudioDeviceModule;
  remoteConfig: RemoteConfigType;
  serverTimeSkew: number;
  unidentifiedDeliveryIndicators: boolean;
  groupCredentials: ReadonlyArray<GroupCredentialType>;
  lastReceivedAtCounter: number;
  preferredReactionEmoji: ReadonlyArray<string>;
  skinTone: number;
  unreadCount: number;
  'challenge:conversations': ReadonlyArray<RegisteredChallengeType>;

  deviceNameEncrypted: boolean;
  'indexeddb-delete-needed': boolean;
  senderCertificate: SerializedCertificateType;
  senderCertificateNoE164: SerializedCertificateType;
  paymentAddress: string;
  zoomFactor: ZoomFactorType;
  preferredLeftPaneWidth: number;
  nextScheduledUpdateKeyTime: number;
  navTabsCollapsed: boolean;
  areWeASubscriber: boolean;
  subscriberId: Uint8Array;
  subscriberCurrencyCode: string;
  displayBadgesOnProfile: boolean;
  keepMutedChatsArchived: boolean;
  usernameLastIntegrityCheck: number;
  usernameCorrupted: boolean;
  usernameLinkCorrupted: boolean;
  usernameLinkColor: number;
  usernameLink: {
    entropy: Uint8Array;
    serverId: Uint8Array;
  };

  // Deprecated
  'challenge:retry-message-ids': never;
  nextSignedKeyRotationTime: number;
  senderCertificateWithUuid: never;
  signaling_key: never;
  signedKeyRotationRejected: number;
};
/* eslint-enable camelcase */

export type StorageInterface = {
  onready(callback: () => void): void;

  get<K extends keyof StorageAccessType, V extends StorageAccessType[K]>(
    key: K
  ): V | undefined;

  get<K extends keyof StorageAccessType, V extends StorageAccessType[K]>(
    key: K,
    defaultValue: V
  ): V;

  put<K extends keyof StorageAccessType>(
    key: K,
    value: StorageAccessType[K]
  ): Promise<void>;

  remove<K extends keyof StorageAccessType>(key: K): Promise<void>;
};
