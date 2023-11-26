// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { connect } from 'react-redux';
import { get } from 'lodash';
import { mapDispatchToProps } from '../actions';
import type { PropsType as LeftPanePropsType } from '../../components/LeftPane';
import { LeftPane, LeftPaneMode } from '../../components/LeftPane';
import type { StateType } from '../reducer';
import { missingCaseError } from '../../util/missingCaseError';
import { lookupConversationWithoutServiceId } from '../../util/lookupConversationWithoutServiceId';
import { isDone as isRegistrationDone } from '../../util/registration';

import { ComposerStep, OneTimeModalState } from '../ducks/conversationsEnums';
import {
  getIsSearching,
  getQuery,
  getSearchConversation,
  getSearchResults,
  getStartSearchCounter,
  isSearching,
} from '../selectors/search';
import {
  getIntl,
  getRegionCode,
  getTheme,
  getIsMacOS,
} from '../selectors/user';
import { hasExpired } from '../selectors/expiration';
import {
  isUpdateDialogVisible,
  isUpdateDownloaded,
  isOSUnsupported,
} from '../selectors/updates';
import { getPreferredBadgeSelector } from '../selectors/badges';
import { hasNetworkDialog } from '../selectors/network';
import {
  getPreferredLeftPaneWidth,
  getUsernamesEnabled,
  getContactManagementEnabled,
  getNavTabsCollapsed,
} from '../selectors/items';
import {
  getComposeAvatarData,
  getComposeGroupAvatar,
  getComposeGroupExpireTimer,
  getComposeGroupName,
  getComposerConversationSearchTerm,
  getComposerStep,
  getComposerUUIDFetchState,
  getComposeSelectedContacts,
  getFilteredCandidateContactsForNewGroup,
  getFilteredComposeContacts,
  getFilteredComposeGroups,
  getLeftPaneLists,
  getMaximumGroupSizeModalState,
  getRecommendedGroupSizeModalState,
  getSelectedConversationId,
  getTargetedMessage,
  getShowArchived,
  hasGroupCreationError,
  isCreatingGroup,
  isEditingAvatar,
} from '../selectors/conversations';
import type { WidthBreakpoint } from '../../components/_util';
import {
  getGroupSizeRecommendedLimit,
  getGroupSizeHardLimit,
} from '../../groups/limits';

import { SmartMessageSearchResult } from './MessageSearchResult';
import { SmartNetworkStatus } from './NetworkStatus';
import { SmartRelinkDialog } from './RelinkDialog';
import { SmartUnsupportedOSDialog } from './UnsupportedOSDialog';
import type { PropsType as SmartUnsupportedOSDialogPropsType } from './UnsupportedOSDialog';
import { SmartUpdateDialog } from './UpdateDialog';
import { SmartCaptchaDialog } from './CaptchaDialog';
import { SmartCrashReportDialog } from './CrashReportDialog';

function renderMessageSearchResult(id: string): JSX.Element {
  return <SmartMessageSearchResult id={id} />;
}
function renderNetworkStatus(
  props: Readonly<{ containerWidthBreakpoint: WidthBreakpoint }>
): JSX.Element {
  return <SmartNetworkStatus {...props} />;
}
function renderRelinkDialog(
  props: Readonly<{ containerWidthBreakpoint: WidthBreakpoint }>
): JSX.Element {
  return <SmartRelinkDialog {...props} />;
}
function renderUpdateDialog(
  props: Readonly<{ containerWidthBreakpoint: WidthBreakpoint }>
): JSX.Element {
  return <SmartUpdateDialog {...props} />;
}
function renderCaptchaDialog({ onSkip }: { onSkip(): void }): JSX.Element {
  return <SmartCaptchaDialog onSkip={onSkip} />;
}
function renderCrashReportDialog(): JSX.Element {
  return <SmartCrashReportDialog />;
}
function renderUnsupportedOSDialog(
  props: Readonly<SmartUnsupportedOSDialogPropsType>
): JSX.Element {
  return <SmartUnsupportedOSDialog {...props} />;
}

const getModeSpecificProps = (
  state: StateType
): LeftPanePropsType['modeSpecificProps'] => {
  const composerStep = getComposerStep(state);
  switch (composerStep) {
    case undefined:
      if (getShowArchived(state)) {
        const { archivedConversations } = getLeftPaneLists(state);
        const searchConversation = getSearchConversation(state);
        const searchTerm = getQuery(state);
        return {
          mode: LeftPaneMode.Archive,
          archivedConversations,
          searchConversation,
          searchTerm,
          startSearchCounter: getStartSearchCounter(state),
          ...(searchConversation && searchTerm ? getSearchResults(state) : {}),
        };
      }
      if (isSearching(state)) {
        const primarySendsSms = Boolean(
          get(state.items, ['primarySendsSms'], false)
        );

        return {
          mode: LeftPaneMode.Search,
          primarySendsSms,
          searchConversation: getSearchConversation(state),
          searchDisabled: state.network.challengeStatus !== 'idle',
          startSearchCounter: getStartSearchCounter(state),
          ...getSearchResults(state),
        };
      }
      return {
        mode: LeftPaneMode.Inbox,
        isAboutToSearch: getIsSearching(state),
        searchConversation: getSearchConversation(state),
        searchDisabled: state.network.challengeStatus !== 'idle',
        searchTerm: getQuery(state),
        startSearchCounter: getStartSearchCounter(state),
        ...getLeftPaneLists(state),
      };
    case ComposerStep.StartDirectConversation:
      return {
        mode: LeftPaneMode.Compose,
        composeContacts: getFilteredComposeContacts(state),
        composeGroups: getFilteredComposeGroups(state),
        regionCode: getRegionCode(state),
        searchTerm: getComposerConversationSearchTerm(state),
        isUsernamesEnabled: getUsernamesEnabled(state),
        uuidFetchState: getComposerUUIDFetchState(state),
      };
    case ComposerStep.ChooseGroupMembers:
      return {
        mode: LeftPaneMode.ChooseGroupMembers,
        candidateContacts: getFilteredCandidateContactsForNewGroup(state),
        groupSizeRecommendedLimit: getGroupSizeRecommendedLimit(),
        groupSizeHardLimit: getGroupSizeHardLimit(),
        isShowingRecommendedGroupSizeModal:
          getRecommendedGroupSizeModalState(state) ===
          OneTimeModalState.Showing,
        isShowingMaximumGroupSizeModal:
          getMaximumGroupSizeModalState(state) === OneTimeModalState.Showing,
        regionCode: getRegionCode(state),
        searchTerm: getComposerConversationSearchTerm(state),
        selectedContacts: getComposeSelectedContacts(state),
        isUsernamesEnabled: getUsernamesEnabled(state),
        uuidFetchState: getComposerUUIDFetchState(state),
      };
    case ComposerStep.SetGroupMetadata:
      return {
        mode: LeftPaneMode.SetGroupMetadata,
        groupAvatar: getComposeGroupAvatar(state),
        groupName: getComposeGroupName(state),
        groupExpireTimer: getComposeGroupExpireTimer(state),
        hasError: hasGroupCreationError(state),
        isCreating: isCreatingGroup(state),
        isEditingAvatar: isEditingAvatar(state),
        selectedContacts: getComposeSelectedContacts(state),
        userAvatarData: getComposeAvatarData(state),
      };
    default:
      throw missingCaseError(composerStep);
  }
};

const mapStateToProps = (state: StateType) => {
  const hasUpdateDialog = isUpdateDialogVisible(state);
  const hasUnsupportedOS = isOSUnsupported(state);

  let hasExpiredDialog = false;
  let unsupportedOSDialogType: 'error' | 'warning' | undefined;
  if (hasExpired(state)) {
    if (hasUnsupportedOS) {
      unsupportedOSDialogType = 'error';
    } else {
      hasExpiredDialog = true;
    }
  } else if (hasUnsupportedOS) {
    unsupportedOSDialogType = 'warning';
  }

  return {
    hasNetworkDialog: hasNetworkDialog(state),
    hasExpiredDialog,
    hasRelinkDialog: !isRegistrationDone(),
    hasUpdateDialog,
    isUpdateDownloaded: isUpdateDownloaded(state),
    unsupportedOSDialogType,

    modeSpecificProps: getModeSpecificProps(state),
    navTabsCollapsed: getNavTabsCollapsed(state),
    preferredWidthFromStorage: getPreferredLeftPaneWidth(state),
    selectedConversationId: getSelectedConversationId(state),
    targetedMessageId: getTargetedMessage(state)?.id,
    showArchived: getShowArchived(state),
    getPreferredBadge: getPreferredBadgeSelector(state),
    isContactManagementEnabled: getContactManagementEnabled(state),
    i18n: getIntl(state),
    isMacOS: getIsMacOS(state),
    regionCode: getRegionCode(state),
    challengeStatus: state.network.challengeStatus,
    crashReportCount: state.crashReports.count,
    renderMessageSearchResult,
    renderNetworkStatus,
    renderRelinkDialog,
    renderUpdateDialog,
    renderCaptchaDialog,
    renderCrashReportDialog,
    renderUnsupportedOSDialog,
    lookupConversationWithoutServiceId,
    theme: getTheme(state),
  };
};

const smart = connect(mapStateToProps, mapDispatchToProps);

export const SmartLeftPane = smart(LeftPane);
