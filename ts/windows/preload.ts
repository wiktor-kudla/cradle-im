// Copyright 2017 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { installCallback, installSetting } from '../util/preload';

// ChatColorPicker redux hookups
installCallback('getCustomColors');
installCallback('getConversationsWithCustomColor');
installCallback('addCustomColor');
installCallback('editCustomColor');
installCallback('removeCustomColor');
installCallback('removeCustomColorOnConversations');
installCallback('resetAllChatColors');
installCallback('resetDefaultChatColor');
installCallback('setGlobalDefaultConversationColor');
installCallback('getDefaultConversationColor');
installCallback('persistZoomFactor');

// Getters only. These are set by the primary device
installSetting('blockedCount', {
  setter: false,
});
installSetting('linkPreviewSetting', {
  setter: false,
});
installSetting('readReceiptSetting', {
  setter: false,
});
installSetting('typingIndicatorSetting', {
  setter: false,
});

installCallback('deleteAllMyStories');
installCallback('isPhoneNumberSharingEnabled');
installCallback('isPrimary');
installCallback('syncRequest');

installSetting('alwaysRelayCalls');
installSetting('audioMessage');
installSetting('audioNotification');
installSetting('autoDownloadUpdate');
installSetting('autoLaunch');
installSetting('callRingtoneNotification');
installSetting('callSystemNotification');
installSetting('countMutedConversations');
installSetting('deviceName');
installSetting('hasStoriesDisabled');
installSetting('hideMenuBar');
installSetting('incomingCallNotification');
installSetting('lastSyncTime');
installSetting('localeOverride');
installSetting('notificationDrawAttention');
installSetting('notificationSetting');
installSetting('spellCheck');
installSetting('systemTraySetting');
installSetting('sentMediaQualitySetting');
installSetting('textFormatting');
installSetting('themeSetting');
installSetting('universalExpireTimer');
installSetting('zoomFactor');
installSetting('phoneNumberDiscoverabilitySetting');
installSetting('phoneNumberSharingSetting');

// Media Settings
installCallback('getAvailableIODevices');
installSetting('preferredAudioInputDevice');
installSetting('preferredAudioOutputDevice');
installSetting('preferredVideoInputDevice');
