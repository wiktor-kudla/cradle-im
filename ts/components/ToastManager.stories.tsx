// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { Meta, StoryFn } from '@storybook/react';
import React from 'react';

import { action } from '@storybook/addon-actions';
import enMessages from '../../_locales/en/messages.json';
import { ToastManager } from './ToastManager';
import type { AnyToast } from '../types/Toast';
import { ToastType } from '../types/Toast';
import { setupI18n } from '../util/setupI18n';
import { missingCaseError } from '../util/missingCaseError';
import type { PropsType } from './ToastManager';

const i18n = setupI18n('en', enMessages);

function getToast(toastType: ToastType): AnyToast {
  switch (toastType) {
    case ToastType.AddingUserToGroup:
      return { toastType, parameters: { contact: 'Sam Mirete' } };
    case ToastType.AlreadyGroupMember:
      return { toastType: ToastType.AlreadyGroupMember };
    case ToastType.AlreadyRequestedToJoin:
      return { toastType: ToastType.AlreadyRequestedToJoin };
    case ToastType.Blocked:
      return { toastType: ToastType.Blocked };
    case ToastType.BlockedGroup:
      return { toastType: ToastType.BlockedGroup };
    case ToastType.CallHistoryCleared:
      return { toastType: ToastType.CallHistoryCleared };
    case ToastType.CannotEditMessage:
      return { toastType: ToastType.CannotEditMessage };
    case ToastType.CannotForwardEmptyMessage:
      return { toastType: ToastType.CannotForwardEmptyMessage };
    case ToastType.CannotMixMultiAndNonMultiAttachments:
      return { toastType: ToastType.CannotMixMultiAndNonMultiAttachments };
    case ToastType.CannotOpenGiftBadgeIncoming:
      return { toastType: ToastType.CannotOpenGiftBadgeIncoming };
    case ToastType.CannotOpenGiftBadgeOutgoing:
      return { toastType: ToastType.CannotOpenGiftBadgeOutgoing };
    case ToastType.CannotStartGroupCall:
      return { toastType: ToastType.CannotStartGroupCall };
    case ToastType.ConversationArchived:
      return {
        toastType: ToastType.ConversationArchived,
        parameters: { conversationId: 'some-conversation-id' },
      };
    case ToastType.ConversationMarkedUnread:
      return { toastType: ToastType.ConversationMarkedUnread };
    case ToastType.ConversationRemoved:
      return {
        toastType: ToastType.ConversationRemoved,
        parameters: { title: 'Alice' },
      };
    case ToastType.ConversationUnarchived:
      return { toastType: ToastType.ConversationUnarchived };
    case ToastType.CopiedUsername:
      return { toastType: ToastType.CopiedUsername };
    case ToastType.CopiedUsernameLink:
      return { toastType: ToastType.CopiedUsernameLink };
    case ToastType.DangerousFileType:
      return { toastType: ToastType.DangerousFileType };
    case ToastType.DeleteForEveryoneFailed:
      return { toastType: ToastType.DeleteForEveryoneFailed };
    case ToastType.Error:
      return { toastType: ToastType.Error };
    case ToastType.Expired:
      return { toastType: ToastType.Expired };
    case ToastType.FailedToDeleteUsername:
      return { toastType: ToastType.FailedToDeleteUsername };
    case ToastType.FileSaved:
      return {
        toastType: ToastType.FileSaved,
        parameters: { fullPath: '/image.png' },
      };
    case ToastType.FileSize:
      return {
        toastType: ToastType.FileSize,
        parameters: { limit: 100, units: 'MB' },
      };
    case ToastType.InvalidConversation:
      return { toastType: ToastType.InvalidConversation };
    case ToastType.LeftGroup:
      return { toastType: ToastType.LeftGroup };
    case ToastType.MaxAttachments:
      return { toastType: ToastType.MaxAttachments };
    case ToastType.MessageBodyTooLong:
      return { toastType: ToastType.MessageBodyTooLong };
    case ToastType.OriginalMessageNotFound:
      return { toastType: ToastType.OriginalMessageNotFound };
    case ToastType.PinnedConversationsFull:
      return { toastType: ToastType.PinnedConversationsFull };
    case ToastType.ReactionFailed:
      return { toastType: ToastType.ReactionFailed };
    case ToastType.ReportedSpamAndBlocked:
      return { toastType: ToastType.ReportedSpamAndBlocked };
    case ToastType.StoryMuted:
      return { toastType: ToastType.StoryMuted };
    case ToastType.StoryReact:
      return { toastType: ToastType.StoryReact };
    case ToastType.StoryReply:
      return { toastType: ToastType.StoryReply };
    case ToastType.StoryVideoError:
      return { toastType: ToastType.StoryVideoError };
    case ToastType.StoryVideoUnsupported:
      return { toastType: ToastType.StoryVideoUnsupported };
    case ToastType.TapToViewExpiredIncoming:
      return { toastType: ToastType.TapToViewExpiredIncoming };
    case ToastType.TapToViewExpiredOutgoing:
      return { toastType: ToastType.TapToViewExpiredOutgoing };
    case ToastType.TooManyMessagesToDeleteForEveryone:
      return {
        toastType: ToastType.TooManyMessagesToDeleteForEveryone,
        parameters: { count: 30 },
      };
    case ToastType.TooManyMessagesToForward:
      return { toastType: ToastType.TooManyMessagesToForward };
    case ToastType.UnableToLoadAttachment:
      return { toastType: ToastType.UnableToLoadAttachment };
    case ToastType.UnsupportedMultiAttachment:
      return { toastType: ToastType.UnsupportedMultiAttachment };
    case ToastType.UnsupportedOS:
      return { toastType: ToastType.UnsupportedOS };
    case ToastType.UserAddedToGroup:
      return {
        toastType: ToastType.UserAddedToGroup,
        parameters: {
          contact: 'Sam Mirete',
          group: 'Hike Group 🏔',
        },
      };
    default:
      throw missingCaseError(toastType);
  }
}

type Args = Omit<PropsType, 'toast'> & {
  toastType: ToastType;
};

export default {
  title: 'Components/ToastManager',
  component: ToastManager,
  argTypes: {
    toastType: {
      options: ToastType,
      control: { type: 'select' },
    },
  },
  args: {
    hideToast: action('hideToast'),
    openFileInFolder: action('openFileInFolder'),
    onUndoArchive: action('onUndoArchive'),
    i18n,
    toastType: ToastType.AddingUserToGroup,
    OS: 'macOS',
  },
} satisfies Meta<Args>;

// eslint-disable-next-line react/function-component-definition
const Template: StoryFn<Args> = args => {
  const { toastType, ...rest } = args;
  return (
    <>
      <p>Select a toast type in controls</p>
      <ToastManager toast={getToast(toastType)} {...rest} />
    </>
  );
};

export const BasicUsage = Template.bind({});
