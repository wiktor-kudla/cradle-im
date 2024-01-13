// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { webFrame } from 'electron';
import type { AudioDevice } from '@signalapp/ringrtc';
import { noop } from 'lodash';

import type { ZoomFactorType } from '../types/Storage.d';
import type {
  ConversationColorType,
  CustomColorType,
  DefaultConversationColorType,
} from '../types/Colors';
import { DEFAULT_CONVERSATION_COLOR } from '../types/Colors';
import * as Errors from '../types/errors';
import * as Stickers from '../types/Stickers';
import type { SystemTraySetting } from '../types/SystemTraySetting';
import { parseSystemTraySetting } from '../types/SystemTraySetting';

import type { ConversationType } from '../state/ducks/conversations';
import type { AuthorizeArtCreatorDataType } from '../state/ducks/globalModals';
import { calling } from '../services/calling';
import { resolveUsernameByLinkBase64 } from '../services/username';
import { getConversationsWithCustomColorSelector } from '../state/selectors/conversations';
import { getCustomColors } from '../state/selectors/items';
import { themeChanged } from '../shims/themeChanged';
import { renderClearingDataView } from '../shims/renderClearingDataView';

import * as universalExpireTimer from './universalExpireTimer';
import { PhoneNumberDiscoverability } from './phoneNumberDiscoverability';
import { PhoneNumberSharingMode } from './phoneNumberSharingMode';
import { strictAssert, assertDev } from './assert';
import * as durations from './durations';
import type { DurationInSeconds } from './durations';
import { isPhoneNumberSharingEnabled } from './isPhoneNumberSharingEnabled';
import * as Registration from './registration';
import { lookupConversationWithoutServiceId } from './lookupConversationWithoutServiceId';
import * as log from '../logging/log';
import { deleteAllMyStories } from './deleteAllMyStories';
import type { NotificationClickData } from '../services/notifications';
import { StoryViewModeType, StoryViewTargetType } from '../types/Stories';
import { isValidE164 } from './isValidE164';
import { fromWebSafeBase64 } from './webSafeBase64';

type SentMediaQualityType = 'standard' | 'high';
type ThemeType = 'light' | 'dark' | 'system';
type NotificationSettingType = 'message' | 'name' | 'count' | 'off';

export type IPCEventsValuesType = {
  alwaysRelayCalls: boolean | undefined;
  audioNotification: boolean | undefined;
  audioMessage: boolean;
  autoDownloadUpdate: boolean;
  autoLaunch: boolean;
  callRingtoneNotification: boolean;
  callSystemNotification: boolean;
  countMutedConversations: boolean;
  hasStoriesDisabled: boolean;
  hideMenuBar: boolean | undefined;
  incomingCallNotification: boolean;
  lastSyncTime: number | undefined;
  localeOverride: string | null;
  notificationDrawAttention: boolean;
  notificationSetting: NotificationSettingType;
  preferredAudioInputDevice: AudioDevice | undefined;
  preferredAudioOutputDevice: AudioDevice | undefined;
  preferredVideoInputDevice: string | undefined;
  sentMediaQualitySetting: SentMediaQualityType;
  spellCheck: boolean;
  systemTraySetting: SystemTraySetting;
  textFormatting: boolean;
  themeSetting: ThemeType;
  universalExpireTimer: DurationInSeconds;
  zoomFactor: ZoomFactorType;
  storyViewReceiptsEnabled: boolean;

  // Optional
  mediaPermissions: boolean;
  mediaCameraPermissions: boolean;

  // Only getters

  blockedCount: number;
  linkPreviewSetting: boolean;
  phoneNumberDiscoverabilitySetting: PhoneNumberDiscoverability;
  phoneNumberSharingSetting: PhoneNumberSharingMode;
  readReceiptSetting: boolean;
  typingIndicatorSetting: boolean;
  deviceName: string | undefined;
};

export type IPCEventsCallbacksType = {
  openArtCreator(): Promise<void>;
  getAvailableIODevices(): Promise<{
    availableCameras: Array<
      Pick<MediaDeviceInfo, 'deviceId' | 'groupId' | 'kind' | 'label'>
    >;
    availableMicrophones: Array<AudioDevice>;
    availableSpeakers: Array<AudioDevice>;
  }>;
  addCustomColor: (customColor: CustomColorType) => void;
  addDarkOverlay: () => void;
  authorizeArtCreator: (data: AuthorizeArtCreatorDataType) => void;
  deleteAllData: () => Promise<void>;
  deleteAllMyStories: () => Promise<void>;
  editCustomColor: (colorId: string, customColor: CustomColorType) => void;
  getConversationsWithCustomColor: (x: string) => Array<ConversationType>;
  getMediaAccessStatus: (
    mediaType: 'screen' | 'microphone' | 'camera'
  ) => Promise<string | unknown>;
  installStickerPack: (packId: string, key: string) => Promise<void>;
  isPhoneNumberSharingEnabled: () => boolean;
  isPrimary: () => boolean;
  removeCustomColor: (x: string) => void;
  removeCustomColorOnConversations: (x: string) => void;
  removeDarkOverlay: () => void;
  resetAllChatColors: () => void;
  resetDefaultChatColor: () => void;
  showConversationViaNotification: (data: NotificationClickData) => void;
  showConversationViaSignalDotMe: (
    kind: string,
    value: string
  ) => Promise<void>;
  showKeyboardShortcuts: () => void;
  showGroupViaLink: (value: string) => Promise<void>;
  showReleaseNotes: () => void;
  showStickerPack: (packId: string, key: string) => void;
  shutdown: () => Promise<void>;
  unknownSignalLink: () => void;
  getCustomColors: () => Record<string, CustomColorType>;
  syncRequest: () => Promise<void>;
  setGlobalDefaultConversationColor: (
    color: ConversationColorType,
    customColor?: { id: string; value: CustomColorType }
  ) => void;
  getDefaultConversationColor: () => DefaultConversationColorType;
  persistZoomFactor: (factor: number) => Promise<void>;
};

type ValuesWithGetters = Omit<
  IPCEventsValuesType,
  // Optional
  'mediaPermissions' | 'mediaCameraPermissions' | 'autoLaunch'
>;

type ValuesWithSetters = Omit<
  IPCEventsValuesType,
  | 'blockedCount'
  | 'defaultConversationColor'
  | 'linkPreviewSetting'
  | 'readReceiptSetting'
  | 'typingIndicatorSetting'
  | 'deviceName'

  // Optional
  | 'mediaPermissions'
  | 'mediaCameraPermissions'
>;

export type IPCEventGetterType<Key extends keyof IPCEventsValuesType> =
  `get${Capitalize<Key>}`;

export type IPCEventSetterType<Key extends keyof IPCEventsValuesType> =
  `set${Capitalize<Key>}`;

export type IPCEventsGettersType = {
  [Key in keyof ValuesWithGetters as IPCEventGetterType<Key>]: () => ValuesWithGetters[Key];
} & {
  getMediaPermissions?: () => Promise<boolean>;
  getMediaCameraPermissions?: () => Promise<boolean>;
  getAutoLaunch?: () => Promise<boolean>;
};

export type IPCEventsSettersType = {
  [Key in keyof ValuesWithSetters as IPCEventSetterType<Key>]: (
    value: NonNullable<ValuesWithSetters[Key]>
  ) => Promise<void>;
} & {
  setMediaPermissions?: (value: boolean) => Promise<void>;
  setMediaCameraPermissions?: (value: boolean) => Promise<void>;
};

export type IPCEventsType = IPCEventsGettersType &
  IPCEventsSettersType &
  IPCEventsCallbacksType;

export function createIPCEvents(
  overrideEvents: Partial<IPCEventsType> = {}
): IPCEventsType {
  const setPhoneNumberDiscoverabilitySetting = async (
    newValue: PhoneNumberDiscoverability
  ): Promise<void> => {
    strictAssert(window.textsecure.server, 'WebAPI must be available');
    await window.storage.put('phoneNumberDiscoverability', newValue);
    await window.textsecure.server.setPhoneNumberDiscoverability(
      newValue === PhoneNumberDiscoverability.Discoverable
    );
    const account = window.ConversationController.getOurConversationOrThrow();
    account.captureChange('phoneNumberDiscoverability');
  };

  return {
    openArtCreator: async () => {
      const auth = await window.textsecure.server?.getArtAuth();
      if (!auth) {
        return;
      }

      window.openArtCreator(auth);
    },

    getDeviceName: () => window.textsecure.storage.user.getDeviceName(),

    getZoomFactor: () => window.storage.get('zoomFactor', 1),
    setZoomFactor: async (zoomFactor: ZoomFactorType) => {
      webFrame.setZoomFactor(zoomFactor);
    },

    setPhoneNumberDiscoverabilitySetting,
    setPhoneNumberSharingSetting: async (newValue: PhoneNumberSharingMode) => {
      const account = window.ConversationController.getOurConversationOrThrow();
      const promises = new Array<Promise<void>>();
      promises.push(window.storage.put('phoneNumberSharingMode', newValue));
      if (newValue === PhoneNumberSharingMode.Everybody) {
        promises.push(
          setPhoneNumberDiscoverabilitySetting(
            PhoneNumberDiscoverability.Discoverable
          )
        );
      }
      account.captureChange('phoneNumberSharingMode');
      await Promise.all(promises);
    },

    getHasStoriesDisabled: () =>
      window.storage.get('hasStoriesDisabled', false),
    setHasStoriesDisabled: async (value: boolean) => {
      await window.storage.put('hasStoriesDisabled', value);
      const account = window.ConversationController.getOurConversationOrThrow();
      account.captureChange('hasStoriesDisabled');
      window.textsecure.server?.onHasStoriesDisabledChange(value);
    },
    getStoryViewReceiptsEnabled: () => {
      return (
        window.storage.get('storyViewReceiptsEnabled') ??
        window.storage.get('read-receipt-setting') ??
        false
      );
    },
    setStoryViewReceiptsEnabled: async (value: boolean) => {
      await window.storage.put('storyViewReceiptsEnabled', value);
      const account = window.ConversationController.getOurConversationOrThrow();
      account.captureChange('storyViewReceiptsEnabled');
    },

    getPreferredAudioInputDevice: () =>
      window.storage.get('preferred-audio-input-device'),
    setPreferredAudioInputDevice: device =>
      window.storage.put('preferred-audio-input-device', device),
    getPreferredAudioOutputDevice: () =>
      window.storage.get('preferred-audio-output-device'),
    setPreferredAudioOutputDevice: device =>
      window.storage.put('preferred-audio-output-device', device),
    getPreferredVideoInputDevice: () =>
      window.storage.get('preferred-video-input-device'),
    setPreferredVideoInputDevice: device =>
      window.storage.put('preferred-video-input-device', device),

    deleteAllMyStories: async () => {
      await deleteAllMyStories();
    },

    // Chat Color redux hookups
    getCustomColors: () => {
      return getCustomColors(window.reduxStore.getState()) || {};
    },
    getConversationsWithCustomColor: colorId => {
      return getConversationsWithCustomColorSelector(
        window.reduxStore.getState()
      )(colorId);
    },
    addCustomColor: (...args) =>
      window.reduxActions.items.addCustomColor(...args),
    editCustomColor: (...args) =>
      window.reduxActions.items.editCustomColor(...args),
    removeCustomColor: colorId =>
      window.reduxActions.items.removeCustomColor(colorId),
    removeCustomColorOnConversations: colorId =>
      window.reduxActions.conversations.removeCustomColorOnConversations(
        colorId
      ),
    resetAllChatColors: () =>
      window.reduxActions.conversations.resetAllChatColors(),
    resetDefaultChatColor: () =>
      window.reduxActions.items.resetDefaultChatColor(),
    setGlobalDefaultConversationColor: (...args) =>
      window.reduxActions.items.setGlobalDefaultConversationColor(...args),

    // Getters only
    getAvailableIODevices: async () => {
      const { availableCameras, availableMicrophones, availableSpeakers } =
        await calling.getAvailableIODevices();

      return {
        // mapping it to a pojo so that it is IPC friendly
        availableCameras: availableCameras.map(
          (inputDeviceInfo: MediaDeviceInfo) => ({
            deviceId: inputDeviceInfo.deviceId,
            groupId: inputDeviceInfo.groupId,
            kind: inputDeviceInfo.kind,
            label: inputDeviceInfo.label,
          })
        ),
        availableMicrophones,
        availableSpeakers,
      };
    },
    getBlockedCount: () =>
      window.storage.blocked.getBlockedServiceIds().length +
      window.storage.blocked.getBlockedGroups().length,
    getDefaultConversationColor: () =>
      window.storage.get(
        'defaultConversationColor',
        DEFAULT_CONVERSATION_COLOR
      ),
    getLinkPreviewSetting: () => window.storage.get('linkPreviews', false),
    getPhoneNumberDiscoverabilitySetting: () =>
      window.storage.get(
        'phoneNumberDiscoverability',
        PhoneNumberDiscoverability.NotDiscoverable
      ),
    getPhoneNumberSharingSetting: () =>
      window.storage.get(
        'phoneNumberSharingMode',
        PhoneNumberSharingMode.Nobody
      ),
    getReadReceiptSetting: () =>
      window.storage.get('read-receipt-setting', false),
    getTypingIndicatorSetting: () =>
      window.storage.get('typingIndicators', false),

    // Configurable settings
    getAutoDownloadUpdate: () =>
      window.storage.get('auto-download-update', true),
    setAutoDownloadUpdate: value =>
      window.storage.put('auto-download-update', value),
    getSentMediaQualitySetting: () =>
      window.storage.get('sent-media-quality', 'standard'),
    setSentMediaQualitySetting: value =>
      window.storage.put('sent-media-quality', value),
    getThemeSetting: () => window.storage.get('theme-setting', 'system'),
    setThemeSetting: value => {
      const promise = window.storage.put('theme-setting', value);
      themeChanged();
      return promise;
    },
    getHideMenuBar: () => window.storage.get('hide-menu-bar'),
    setHideMenuBar: value => {
      const promise = window.storage.put('hide-menu-bar', value);
      window.IPC.setAutoHideMenuBar(value);
      window.IPC.setMenuBarVisibility(!value);
      return promise;
    },
    getSystemTraySetting: () =>
      parseSystemTraySetting(window.storage.get('system-tray-setting')),
    setSystemTraySetting: value => {
      const promise = window.storage.put('system-tray-setting', value);
      window.IPC.updateSystemTraySetting(value);
      return promise;
    },

    getLocaleOverride: () => {
      return window.storage.get('localeOverride') ?? null;
    },
    setLocaleOverride: async (locale: string | null) => {
      await window.storage.put('localeOverride', locale);
    },
    getNotificationSetting: () =>
      window.storage.get('notification-setting', 'message'),
    setNotificationSetting: (value: 'message' | 'name' | 'count' | 'off') =>
      window.storage.put('notification-setting', value),
    getNotificationDrawAttention: () =>
      window.storage.get('notification-draw-attention', false),
    setNotificationDrawAttention: value =>
      window.storage.put('notification-draw-attention', value),
    getAudioMessage: () => window.storage.get('audioMessage', false),
    setAudioMessage: value => window.storage.put('audioMessage', value),
    getAudioNotification: () => window.storage.get('audio-notification'),
    setAudioNotification: value =>
      window.storage.put('audio-notification', value),
    getCountMutedConversations: () =>
      window.storage.get('badge-count-muted-conversations', false),
    setCountMutedConversations: value => {
      const promise = window.storage.put(
        'badge-count-muted-conversations',
        value
      );
      window.Whisper.events.trigger('updateUnreadCount');
      return promise;
    },
    getCallRingtoneNotification: () =>
      window.storage.get('call-ringtone-notification', true),
    setCallRingtoneNotification: value =>
      window.storage.put('call-ringtone-notification', value),
    getCallSystemNotification: () =>
      window.storage.get('call-system-notification', true),
    setCallSystemNotification: value =>
      window.storage.put('call-system-notification', value),
    getIncomingCallNotification: () =>
      window.storage.get('incoming-call-notification', true),
    setIncomingCallNotification: value =>
      window.storage.put('incoming-call-notification', value),

    getSpellCheck: () => window.storage.get('spell-check', true),
    setSpellCheck: value => window.storage.put('spell-check', value),
    getTextFormatting: () => window.storage.get('textFormatting', true),
    setTextFormatting: value => window.storage.put('textFormatting', value),

    getAlwaysRelayCalls: () => window.storage.get('always-relay-calls'),
    setAlwaysRelayCalls: value =>
      window.storage.put('always-relay-calls', value),

    getAutoLaunch: () => window.IPC.getAutoLaunch(),
    setAutoLaunch: async (value: boolean) => {
      return window.IPC.setAutoLaunch(value);
    },

    isPhoneNumberSharingEnabled: () => isPhoneNumberSharingEnabled(),
    isPrimary: () => window.textsecure.storage.user.getDeviceId() === 1,
    syncRequest: () =>
      new Promise<void>((resolve, reject) => {
        const FIVE_MINUTES = 5 * durations.MINUTE;
        const syncRequest = window.getSyncRequest(FIVE_MINUTES);
        syncRequest.addEventListener('success', () => resolve());
        syncRequest.addEventListener('timeout', () =>
          reject(new Error('timeout'))
        );
      }),
    getLastSyncTime: () => window.storage.get('synced_at'),
    setLastSyncTime: value => window.storage.put('synced_at', value),
    getUniversalExpireTimer: () => universalExpireTimer.get(),
    setUniversalExpireTimer: async newValue => {
      await universalExpireTimer.set(newValue);

      // Update account in Storage Service
      const account = window.ConversationController.getOurConversationOrThrow();
      account.captureChange('universalExpireTimer');

      // Add a notification to the currently open conversation
      const state = window.reduxStore.getState();
      const selectedId = state.conversations.selectedConversationId;
      if (selectedId) {
        const conversation = window.ConversationController.get(selectedId);
        assertDev(conversation, "Conversation wasn't found");

        await conversation.updateLastMessage();
      }
    },

    addDarkOverlay: () => {
      const elems = document.querySelectorAll('.dark-overlay');
      if (elems.length) {
        return;
      }
      const newOverlay = document.createElement('div');
      newOverlay.className = 'dark-overlay';
      newOverlay.addEventListener('click', () => {
        newOverlay.remove();
      });
      document.body.prepend(newOverlay);
    },
    authorizeArtCreator: (data: AuthorizeArtCreatorDataType) => {
      // We can get these events even if the user has never linked this instance.
      if (!Registration.everDone()) {
        log.warn('authorizeArtCreator: Not registered, returning early');
        return;
      }
      window.reduxActions.globalModals.showAuthorizeArtCreator(data);
    },
    removeDarkOverlay: () => {
      const elems = document.querySelectorAll('.dark-overlay');

      for (const elem of elems) {
        elem.remove();
      }
    },
    showKeyboardShortcuts: () =>
      window.reduxActions.globalModals.showShortcutGuideModal(),

    deleteAllData: async () => {
      renderClearingDataView();
    },

    showStickerPack: (packId, key) => {
      // We can get these events even if the user has never linked this instance.
      if (!Registration.everDone()) {
        log.warn('showStickerPack: Not registered, returning early');
        return;
      }
      window.reduxActions.globalModals.showStickerPackPreview(packId, key);
    },
    showGroupViaLink: async value => {
      // We can get these events even if the user has never linked this instance.
      if (!Registration.everDone()) {
        log.warn('showGroupViaLink: Not registered, returning early');
        return;
      }
      try {
        await window.Signal.Groups.joinViaLink(value);
      } catch (error) {
        log.error(
          'showGroupViaLink: Ran into an error!',
          Errors.toLogFormat(error)
        );
        window.reduxActions.globalModals.showErrorModal({
          title: window.i18n('icu:GroupV2--join--general-join-failure--title'),
          description: window.i18n('icu:GroupV2--join--general-join-failure'),
        });
      }
    },

    showConversationViaNotification({
      conversationId,
      messageId,
      storyId,
    }: NotificationClickData) {
      if (conversationId) {
        if (storyId) {
          window.reduxActions.stories.viewStory({
            storyId,
            storyViewMode: StoryViewModeType.Single,
            viewTarget: StoryViewTargetType.Replies,
          });
        } else {
          window.reduxActions.conversations.showConversation({
            conversationId,
            messageId: messageId ?? undefined,
          });
        }
      } else {
        window.reduxActions.app.openInbox();
      }
    },
    async showConversationViaSignalDotMe(kind: string, value: string) {
      if (!Registration.everDone()) {
        log.info(
          'showConversationViaSignalDotMe: Not registered, returning early'
        );
        return;
      }

      const { showUserNotFoundModal } = window.reduxActions.globalModals;

      let conversationId: string | undefined;

      if (kind === 'phoneNumber') {
        if (isValidE164(value, true)) {
          conversationId = await lookupConversationWithoutServiceId({
            type: 'e164',
            e164: value,
            phoneNumber: value,
            showUserNotFoundModal,
            setIsFetchingUUID: noop,
          });
        }
      } else if (kind === 'encryptedUsername') {
        const usernameBase64 = fromWebSafeBase64(value);
        const username = await resolveUsernameByLinkBase64(usernameBase64);
        if (username != null) {
          conversationId = await lookupConversationWithoutServiceId({
            type: 'username',
            username,
            showUserNotFoundModal,
            setIsFetchingUUID: noop,
          });
        }
      }

      if (conversationId != null) {
        window.reduxActions.conversations.showConversation({
          conversationId,
        });
        return;
      }

      log.info('showConversationViaSignalDotMe: invalid E164');
      showUnknownSgnlLinkModal();
    },

    unknownSignalLink: () => {
      log.warn('unknownSignalLink: Showing error dialog');
      showUnknownSgnlLinkModal();
    },

    installStickerPack: async (packId, key) => {
      void Stickers.downloadStickerPack(packId, key, {
        finalStatus: 'installed',
      });
    },

    shutdown: () => Promise.resolve(),
    showReleaseNotes: () => {
      const { showWhatsNewModal } = window.reduxActions.globalModals;
      showWhatsNewModal();
    },

    getMediaAccessStatus: async (
      mediaType: 'screen' | 'microphone' | 'camera'
    ) => {
      return window.IPC.getMediaAccessStatus(mediaType);
    },
    getMediaPermissions: window.IPC.getMediaPermissions,
    getMediaCameraPermissions: window.IPC.getMediaCameraPermissions,

    persistZoomFactor: zoomFactor =>
      window.storage.put('zoomFactor', zoomFactor),

    ...overrideEvents,
  };
}

function showUnknownSgnlLinkModal(): void {
  window.reduxActions.globalModals.showErrorModal({
    description: window.i18n('icu:unknown-sgnl-link'),
  });
}
