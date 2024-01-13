// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { ChatsTab } from '../../components/ChatsTab';
import { SmartConversationView } from './ConversationView';
import { SmartMiniPlayer } from './MiniPlayer';
import { SmartLeftPane } from './LeftPane';
import type { NavTabPanelProps } from '../../components/NavTabs';
import { useGlobalModalActions } from '../ducks/globalModals';
import { getIntl } from '../selectors/user';
import { usePrevious } from '../../hooks/usePrevious';
import { TargetedMessageSource } from '../ducks/conversationsEnums';
import type { ConversationsStateType } from '../ducks/conversations';
import { useConversationsActions } from '../ducks/conversations';
import type { StateType } from '../reducer';
import { strictAssert } from '../../util/assert';
import { showToast } from '../../util/showToast';
import { ToastStickerPackInstallFailed } from '../../components/ToastStickerPackInstallFailed';
import { getNavTabsCollapsed } from '../selectors/items';
import { useItemsActions } from '../ducks/items';
import { getHasAnyFailedStorySends } from '../selectors/stories';
import { getHasPendingUpdate } from '../selectors/updates';
import { getOtherTabsUnreadStats } from '../selectors/nav';

function renderConversationView() {
  return <SmartConversationView />;
}

function renderLeftPane(props: NavTabPanelProps) {
  return <SmartLeftPane {...props} />;
}

function renderMiniPlayer(options: { shouldFlow: boolean }) {
  return <SmartMiniPlayer {...options} />;
}

export function SmartChatsTab(): JSX.Element {
  const i18n = useSelector(getIntl);
  const navTabsCollapsed = useSelector(getNavTabsCollapsed);
  const hasFailedStorySends = useSelector(getHasAnyFailedStorySends);
  const hasPendingUpdate = useSelector(getHasPendingUpdate);
  const otherTabsUnreadStats = useSelector(getOtherTabsUnreadStats);

  const { selectedConversationId, targetedMessage, targetedMessageSource } =
    useSelector<StateType, ConversationsStateType>(
      state => state.conversations
    );

  const {
    onConversationClosed,
    onConversationOpened,
    scrollToMessage,
    showConversation,
  } = useConversationsActions();
  const { showWhatsNewModal } = useGlobalModalActions();
  const { toggleNavTabsCollapse } = useItemsActions();

  const lastOpenedConversationId = useRef<string | undefined>();

  useEffect(() => {
    if (selectedConversationId !== lastOpenedConversationId.current) {
      lastOpenedConversationId.current = selectedConversationId;
      if (selectedConversationId) {
        onConversationOpened(selectedConversationId, targetedMessage);
      }
    } else if (
      selectedConversationId &&
      targetedMessage &&
      targetedMessageSource !== TargetedMessageSource.Focus
    ) {
      scrollToMessage(selectedConversationId, targetedMessage);
    }
  }, [
    onConversationOpened,
    selectedConversationId,
    scrollToMessage,
    targetedMessage,
    targetedMessageSource,
  ]);

  const prevConversationId = usePrevious(
    selectedConversationId,
    selectedConversationId
  );

  useEffect(() => {
    if (
      selectedConversationId != null &&
      selectedConversationId !== prevConversationId
    ) {
      const conversation = window.ConversationController.get(
        selectedConversationId
      );
      strictAssert(conversation, 'Conversation must be found');
      conversation.setMarkedUnread(false);
    }
  }, [prevConversationId, selectedConversationId]);

  useEffect(() => {
    function refreshConversation({
      newId,
      oldId,
    }: {
      newId: string;
      oldId: string;
    }) {
      if (prevConversationId === oldId) {
        showConversation({ conversationId: newId });
      }
    }

    // Close current opened conversation to reload the group information once
    // linked.
    function unload() {
      if (!prevConversationId) {
        return;
      }
      onConversationClosed(prevConversationId, 'force unload requested');
    }

    function packInstallFailed() {
      showToast(ToastStickerPackInstallFailed);
    }

    window.Whisper.events.on('pack-install-failed', packInstallFailed);
    window.Whisper.events.on('refreshConversation', refreshConversation);
    window.Whisper.events.on('setupAsNewDevice', unload);

    return () => {
      window.Whisper.events.off('pack-install-failed', packInstallFailed);
      window.Whisper.events.off('refreshConversation', refreshConversation);
      window.Whisper.events.off('setupAsNewDevice', unload);
    };
  }, [onConversationClosed, prevConversationId, showConversation]);

  useEffect(() => {
    if (!selectedConversationId) {
      window.SignalCI?.handleEvent('empty-inbox:rendered', null);
    }
  }, [selectedConversationId]);

  return (
    <ChatsTab
      otherTabsUnreadStats={otherTabsUnreadStats}
      i18n={i18n}
      hasFailedStorySends={hasFailedStorySends}
      hasPendingUpdate={hasPendingUpdate}
      navTabsCollapsed={navTabsCollapsed}
      onToggleNavTabsCollapse={toggleNavTabsCollapse}
      prevConversationId={prevConversationId}
      renderConversationView={renderConversationView}
      renderLeftPane={renderLeftPane}
      renderMiniPlayer={renderMiniPlayer}
      selectedConversationId={selectedConversationId}
      showWhatsNewModal={showWhatsNewModal}
    />
  );
}
