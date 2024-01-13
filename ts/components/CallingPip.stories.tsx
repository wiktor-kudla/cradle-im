// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as React from 'react';
import { times } from 'lodash';
import { action } from '@storybook/addon-actions';
import type { Meta } from '@storybook/react';
import { AvatarColors } from '../types/Colors';
import type { ConversationType } from '../state/ducks/conversations';
import type { PropsType } from './CallingPip';
import { CallingPip } from './CallingPip';
import type { ActiveDirectCallType } from '../types/Calling';
import {
  CallMode,
  CallViewMode,
  CallState,
  GroupCallConnectionState,
  GroupCallJoinState,
} from '../types/Calling';
import { getDefaultConversation } from '../test-both/helpers/getDefaultConversation';
import { fakeGetGroupCallVideoFrameSource } from '../test-both/helpers/fakeGetGroupCallVideoFrameSource';
import { setupI18n } from '../util/setupI18n';
import enMessages from '../../_locales/en/messages.json';

const i18n = setupI18n('en', enMessages);

const conversation: ConversationType = getDefaultConversation({
  id: '3051234567',
  avatarPath: undefined,
  color: AvatarColors[0],
  title: 'Rick Sanchez',
  name: 'Rick Sanchez',
  phoneNumber: '3051234567',
  profileName: 'Rick Sanchez',
});

type Overrides = {
  hasLocalAudio?: boolean;
  hasLocalVideo?: boolean;
  localAudioLevel?: number;
  viewMode?: CallViewMode;
};

const getCommonActiveCallData = (overrides: Overrides) => ({
  conversation,
  hasLocalAudio: overrides.hasLocalAudio ?? true,
  hasLocalVideo: overrides.hasLocalVideo ?? false,
  localAudioLevel: overrides.localAudioLevel ?? 0,
  viewMode: overrides.viewMode ?? CallViewMode.Paginated,
  joinedAt: Date.now(),
  outgoingRing: true,
  pip: true,
  settingsDialogOpen: false,
  showParticipantsList: false,
});

const getDefaultCall = (overrides: Overrides): ActiveDirectCallType => {
  return {
    ...getCommonActiveCallData(overrides),
    callMode: CallMode.Direct as CallMode.Direct,
    callState: CallState.Accepted,
    peekedParticipants: [],
    remoteParticipants: [
      { hasRemoteVideo: true, presenting: false, title: 'Arsene' },
    ],
  };
};

export default {
  title: 'Components/CallingPip',
  argTypes: {
    hasLocalVideo: { control: { type: 'boolean' } },
  },
  args: {
    activeCall: getDefaultCall({}),
    getGroupCallVideoFrameSource: fakeGetGroupCallVideoFrameSource,
    hangUpActiveCall: action('hang-up-active-call'),
    hasLocalVideo: false,
    i18n,
    setGroupCallVideoRequest: action('set-group-call-video-request'),
    setLocalPreview: action('set-local-preview'),
    setRendererCanvas: action('set-renderer-canvas'),
    switchFromPresentationView: action('switch-to-presentation-view'),
    switchToPresentationView: action('switch-to-presentation-view'),
    togglePip: action('toggle-pip'),
  },
} satisfies Meta<PropsType>;

export function Default(args: PropsType): JSX.Element {
  return <CallingPip {...args} />;
}

export function ContactWithAvatarAndNoVideo(args: PropsType): JSX.Element {
  return (
    <CallingPip
      {...args}
      activeCall={{
        ...getDefaultCall({}),
        conversation: {
          ...conversation,
          avatarPath: 'https://www.fillmurray.com/64/64',
        },
        remoteParticipants: [
          { hasRemoteVideo: false, presenting: false, title: 'Julian' },
        ],
      }}
    />
  );
}

export function ContactNoColor(args: PropsType): JSX.Element {
  return (
    <CallingPip
      {...args}
      activeCall={{
        ...getDefaultCall({}),
        conversation: {
          ...conversation,
          color: undefined,
        },
      }}
    />
  );
}

export function GroupCall(args: PropsType): JSX.Element {
  return (
    <CallingPip
      {...args}
      activeCall={{
        ...getCommonActiveCallData({}),
        callMode: CallMode.Group as CallMode.Group,
        connectionState: GroupCallConnectionState.Connected,
        conversationsWithSafetyNumberChanges: [],
        conversationsByDemuxId: new Map<number, ConversationType>(),
        groupMembers: times(3, () => getDefaultConversation()),
        isConversationTooBigToRing: false,
        joinState: GroupCallJoinState.Joined,
        localDemuxId: 1,
        maxDevices: 5,
        deviceCount: 0,
        peekedParticipants: [],
        raisedHands: new Set<number>(),
        remoteParticipants: [],
        remoteAudioLevels: new Map<number, number>(),
      }}
    />
  );
}
