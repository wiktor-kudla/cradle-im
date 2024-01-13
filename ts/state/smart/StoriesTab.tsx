// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';

import type { LocalizerType } from '../../types/Util';
import type { StateType } from '../reducer';
import { SmartStoryCreator } from './StoryCreator';
import { StoriesTab } from '../../components/StoriesTab';
import { getMaximumOutgoingAttachmentSizeInKb } from '../../types/AttachmentSize';
import type { ConfigKeyType } from '../../RemoteConfig';
import { getMe } from '../selectors/conversations';
import { getIntl, getTheme } from '../selectors/user';
import { getPreferredBadgeSelector } from '../selectors/badges';
import {
  getHasStoryViewReceiptSetting,
  getNavTabsCollapsed,
  getPreferredLeftPaneWidth,
  getRemoteConfig,
} from '../selectors/items';
import {
  getAddStoryData,
  getHasAnyFailedStorySends,
  getSelectedStoryData,
  getStories,
} from '../selectors/stories';
import { useConversationsActions } from '../ducks/conversations';
import { useGlobalModalActions } from '../ducks/globalModals';
import { useStoriesActions } from '../ducks/stories';
import { useToastActions } from '../ducks/toast';
import { useAudioPlayerActions } from '../ducks/audioPlayer';
import { useItemsActions } from '../ducks/items';
import { getHasPendingUpdate } from '../selectors/updates';
import { getOtherTabsUnreadStats } from '../selectors/nav';

function renderStoryCreator(): JSX.Element {
  return <SmartStoryCreator />;
}

export function SmartStoriesTab(): JSX.Element | null {
  const storiesActions = useStoriesActions();
  const {
    retryMessageSend,
    saveAttachment,
    showConversation,
    toggleHideStories,
  } = useConversationsActions();
  const { showStoriesSettings, toggleForwardMessagesModal } =
    useGlobalModalActions();
  const { showToast } = useToastActions();

  const i18n = useSelector<StateType, LocalizerType>(getIntl);

  const preferredWidthFromStorage = useSelector<StateType, number>(
    getPreferredLeftPaneWidth
  );
  const getPreferredBadge = useSelector(getPreferredBadgeSelector);

  const addStoryData = useSelector(getAddStoryData);
  const { hiddenStories, myStories, stories } = useSelector(getStories);

  const me = useSelector(getMe);

  const selectedStoryData = useSelector(getSelectedStoryData);

  const isStoriesSettingsVisible = useSelector(
    (state: StateType) => state.globalModals.isStoriesSettingsVisible
  );

  const hasViewReceiptSetting = useSelector(getHasStoryViewReceiptSetting);
  const hasPendingUpdate = useSelector(getHasPendingUpdate);
  const hasFailedStorySends = useSelector(getHasAnyFailedStorySends);
  const otherTabsUnreadStats = useSelector(getOtherTabsUnreadStats);

  const remoteConfig = useSelector(getRemoteConfig);
  const maxAttachmentSizeInKb = getMaximumOutgoingAttachmentSizeInKb(
    (name: ConfigKeyType) => {
      const value = remoteConfig[name]?.value;
      return value ? String(value) : undefined;
    }
  );
  const { pauseVoiceNotePlayer } = useAudioPlayerActions();

  const preferredLeftPaneWidth = useSelector(getPreferredLeftPaneWidth);
  const navTabsCollapsed = useSelector(getNavTabsCollapsed);
  const { savePreferredLeftPaneWidth, toggleNavTabsCollapse } =
    useItemsActions();

  const theme = useSelector(getTheme);

  useEffect(() => {
    storiesActions.markStoriesTabViewed();
    return () => {
      storiesActions.clearStoriesTabState();
    };
  }, [storiesActions]);

  return (
    <StoriesTab
      otherTabsUnreadStats={otherTabsUnreadStats}
      addStoryData={addStoryData}
      getPreferredBadge={getPreferredBadge}
      hasFailedStorySends={hasFailedStorySends}
      hasPendingUpdate={hasPendingUpdate}
      hiddenStories={hiddenStories}
      i18n={i18n}
      maxAttachmentSizeInKb={maxAttachmentSizeInKb}
      me={me}
      myStories={myStories}
      navTabsCollapsed={navTabsCollapsed}
      onForwardStory={messageId => {
        toggleForwardMessagesModal([messageId]);
      }}
      onSaveStory={story => {
        if (story.attachment) {
          saveAttachment(story.attachment, story.timestamp);
        }
      }}
      onToggleNavTabsCollapse={toggleNavTabsCollapse}
      onMediaPlaybackStart={pauseVoiceNotePlayer}
      preferredLeftPaneWidth={preferredLeftPaneWidth}
      preferredWidthFromStorage={preferredWidthFromStorage}
      renderStoryCreator={renderStoryCreator}
      retryMessageSend={retryMessageSend}
      savePreferredLeftPaneWidth={savePreferredLeftPaneWidth}
      showConversation={showConversation}
      showStoriesSettings={showStoriesSettings}
      showToast={showToast}
      stories={stories}
      theme={theme}
      toggleHideStories={toggleHideStories}
      isViewingStory={selectedStoryData !== undefined}
      isStoriesSettingsVisible={isStoriesSettingsVisible}
      hasViewReceiptSetting={hasViewReceiptSetting}
      {...storiesActions}
    />
  );
}
