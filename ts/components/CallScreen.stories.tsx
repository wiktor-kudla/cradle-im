// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as React from 'react';
import { sample, shuffle, times } from 'lodash';
import { action } from '@storybook/addon-actions';

import type { Meta } from '@storybook/react';
import type {
  ActiveCallReactionsType,
  ActiveGroupCallType,
  GroupCallRemoteParticipantType,
} from '../types/Calling';
import {
  CallMode,
  CallViewMode,
  CallState,
  GroupCallConnectionState,
  GroupCallJoinState,
} from '../types/Calling';
import { generateAci } from '../types/ServiceId';
import type { ConversationType } from '../state/ducks/conversations';
import { AvatarColors } from '../types/Colors';
import type { PropsType } from './CallScreen';
import { CallScreen as UnwrappedCallScreen } from './CallScreen';
import { DEFAULT_PREFERRED_REACTION_EMOJI } from '../reactions/constants';
import { setupI18n } from '../util/setupI18n';
import { missingCaseError } from '../util/missingCaseError';
import {
  getDefaultConversation,
  getDefaultConversationWithServiceId,
} from '../test-both/helpers/getDefaultConversation';
import { fakeGetGroupCallVideoFrameSource } from '../test-both/helpers/fakeGetGroupCallVideoFrameSource';
import enMessages from '../../_locales/en/messages.json';
import { CallingToastProvider, useCallingToasts } from './CallingToast';

const MAX_PARTICIPANTS = 75;
const LOCAL_DEMUX_ID = 1;

const i18n = setupI18n('en', enMessages);

const conversation = getDefaultConversation({
  id: '3051234567',
  avatarPath: undefined,
  color: AvatarColors[0],
  title: 'Rick Sanchez',
  name: 'Rick Sanchez',
  phoneNumber: '3051234567',
  profileName: 'Rick Sanchez',
});

type OverridePropsBase = {
  hasLocalAudio?: boolean;
  hasLocalVideo?: boolean;
  localAudioLevel?: number;
  viewMode?: CallViewMode;
  reactions?: ActiveCallReactionsType;
};

type DirectCallOverrideProps = OverridePropsBase & {
  callMode: CallMode.Direct;
  callState?: CallState;
  hasRemoteVideo?: boolean;
};

type GroupCallOverrideProps = OverridePropsBase & {
  callMode: CallMode.Group;
  connectionState?: GroupCallConnectionState;
  peekedParticipants?: Array<ConversationType>;
  raisedHands?: Set<number>;
  remoteParticipants?: Array<GroupCallRemoteParticipantType>;
  remoteAudioLevel?: number;
};

const createActiveDirectCallProp = (
  overrideProps: DirectCallOverrideProps
) => ({
  callMode: CallMode.Direct as CallMode.Direct,
  conversation,
  callState: overrideProps.callState ?? CallState.Accepted,
  peekedParticipants: [] as [],
  remoteParticipants: [
    {
      hasRemoteVideo: overrideProps.hasRemoteVideo ?? false,
      presenting: false,
      title: 'test',
    },
  ] as [
    {
      hasRemoteVideo: boolean;
      presenting: boolean;
      title: string;
    }
  ],
});

const getConversationsByDemuxId = (overrideProps: GroupCallOverrideProps) => {
  const conversationsByDemuxId = new Map<number, ConversationType>(
    overrideProps.remoteParticipants?.map((participant, index) => [
      participant.demuxId,
      getDefaultConversationWithServiceId({
        isBlocked: index === 10 || index === MAX_PARTICIPANTS - 1,
        title: `Participant ${index + 1}`,
      }),
    ])
  );
  conversationsByDemuxId.set(LOCAL_DEMUX_ID, conversation);
  return conversationsByDemuxId;
};

const getRaisedHands = (overrideProps: GroupCallOverrideProps) => {
  if (!overrideProps.remoteParticipants) {
    return;
  }

  return new Set<number>(
    overrideProps.remoteParticipants
      .filter(participant => participant.isHandRaised)
      .map(participant => participant.demuxId)
  );
};

const createActiveGroupCallProp = (overrideProps: GroupCallOverrideProps) => ({
  callMode: CallMode.Group as CallMode.Group,
  connectionState:
    overrideProps.connectionState || GroupCallConnectionState.Connected,
  conversationsWithSafetyNumberChanges: [],
  conversationsByDemuxId: getConversationsByDemuxId(overrideProps),
  joinState: GroupCallJoinState.Joined,
  localDemuxId: LOCAL_DEMUX_ID,
  maxDevices: 5,
  deviceCount: (overrideProps.remoteParticipants || []).length,
  groupMembers: overrideProps.remoteParticipants || [],
  // Because remote participants are a superset, we can use them in place of peeked
  //   participants.
  isConversationTooBigToRing: false,
  peekedParticipants:
    overrideProps.peekedParticipants || overrideProps.remoteParticipants || [],
  raisedHands:
    overrideProps.raisedHands ||
    getRaisedHands(overrideProps) ||
    new Set<number>(),
  remoteParticipants: overrideProps.remoteParticipants || [],
  remoteAudioLevels: new Map<number, number>(
    overrideProps.remoteParticipants?.map((_participant, index) => [
      index,
      overrideProps.remoteAudioLevel ?? 0,
    ])
  ),
  reactions: overrideProps.reactions || [],
});

const createActiveCallProp = (
  overrideProps: DirectCallOverrideProps | GroupCallOverrideProps
) => {
  const baseResult = {
    joinedAt: Date.now(),
    conversation,
    hasLocalAudio: overrideProps.hasLocalAudio ?? false,
    hasLocalVideo: overrideProps.hasLocalVideo ?? false,
    localAudioLevel: overrideProps.localAudioLevel ?? 0,
    viewMode: overrideProps.viewMode ?? CallViewMode.Overflow,
    outgoingRing: true,
    pip: false,
    settingsDialogOpen: false,
    showParticipantsList: false,
  };

  switch (overrideProps.callMode) {
    case CallMode.Direct:
      return { ...baseResult, ...createActiveDirectCallProp(overrideProps) };
    case CallMode.Group:
      return { ...baseResult, ...createActiveGroupCallProp(overrideProps) };
    default:
      throw missingCaseError(overrideProps);
  }
};

const createProps = (
  overrideProps: DirectCallOverrideProps | GroupCallOverrideProps = {
    callMode: CallMode.Direct as CallMode.Direct,
  }
): PropsType => ({
  activeCall: createActiveCallProp(overrideProps),
  changeCallView: action('change-call-view'),
  getGroupCallVideoFrameSource: fakeGetGroupCallVideoFrameSource,
  getPresentingSources: action('get-presenting-sources'),
  hangUpActiveCall: action('hang-up'),
  i18n,
  isGroupCallRaiseHandEnabled: true,
  isGroupCallReactionsEnabled: true,
  me: getDefaultConversation({
    color: AvatarColors[1],
    id: '6146087e-f7ef-457e-9a8d-47df1fdd6b25',
    name: 'Morty Smith',
    profileName: 'Morty Smith',
    title: 'Morty Smith',
    serviceId: generateAci(),
  }),
  openSystemPreferencesAction: action('open-system-preferences-action'),
  renderEmojiPicker: () => <>EmojiPicker</>,
  renderReactionPicker: () => <div />,
  sendGroupCallRaiseHand: action('send-group-call-raise-hand'),
  sendGroupCallReaction: action('send-group-call-reaction'),
  setGroupCallVideoRequest: action('set-group-call-video-request'),
  setLocalAudio: action('set-local-audio'),
  setLocalPreview: action('set-local-preview'),
  setLocalVideo: action('set-local-video'),
  setPresenting: action('toggle-presenting'),
  setRendererCanvas: action('set-renderer-canvas'),
  stickyControls: false,
  switchToPresentationView: action('switch-to-presentation-view'),
  switchFromPresentationView: action('switch-from-presentation-view'),
  toggleParticipants: action('toggle-participants'),
  togglePip: action('toggle-pip'),
  toggleScreenRecordingPermissionsDialog: action(
    'toggle-screen-recording-permissions-dialog'
  ),
  toggleSettings: action('toggle-settings'),
});

function CallScreen(props: ReturnType<typeof createProps>): JSX.Element {
  return (
    <CallingToastProvider i18n={i18n}>
      <UnwrappedCallScreen {...props} />
    </CallingToastProvider>
  );
}

export default {
  title: 'Components/CallScreen',
  argTypes: {},
  args: {},
} satisfies Meta<PropsType>;

export function Default(): JSX.Element {
  return <CallScreen {...createProps()} />;
}

export function PreRing(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Direct,
        callState: CallState.Prering,
      })}
    />
  );
}

export function Ringing(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Direct,
        callState: CallState.Ringing,
      })}
    />
  );
}

export function Reconnecting(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Direct,
        callState: CallState.Reconnecting,
      })}
    />
  );
}

export function Ended(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Direct,
        callState: CallState.Ended,
      })}
    />
  );
}

export function HasLocalAudio(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Direct,
        hasLocalAudio: true,
      })}
    />
  );
}

export function HasLocalVideo(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Direct,
        hasLocalVideo: true,
      })}
    />
  );
}

export function HasRemoteVideo(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Direct,
        hasRemoteVideo: true,
      })}
    />
  );
}

export function GroupCall1(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Group,
        remoteParticipants: [
          {
            aci: generateAci(),
            demuxId: 0,
            hasRemoteAudio: true,
            hasRemoteVideo: true,
            isHandRaised: false,
            presenting: false,
            sharingScreen: false,
            videoAspectRatio: 1.3,
            ...getDefaultConversation({
              isBlocked: false,
              serviceId: generateAci(),
              title: 'Tyler',
            }),
          },
        ],
      })}
    />
  );
}

export function GroupCallYourHandRaised(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Group,
        remoteParticipants: [
          {
            aci: generateAci(),
            demuxId: 0,
            hasRemoteAudio: true,
            hasRemoteVideo: true,
            isHandRaised: false,
            presenting: false,
            sharingScreen: false,
            videoAspectRatio: 1.3,
            ...getDefaultConversation({
              isBlocked: false,
              serviceId: generateAci(),
              title: 'Tyler',
            }),
          },
        ],
        raisedHands: new Set([LOCAL_DEMUX_ID]),
      })}
    />
  );
}

// We generate these upfront so that the list is stable when you move the slider.
const allRemoteParticipants = times(MAX_PARTICIPANTS).map(index => ({
  aci: generateAci(),
  demuxId: index,
  hasRemoteAudio: index % 3 !== 0,
  hasRemoteVideo: index % 4 !== 0,
  isHandRaised: (index - 3) % 10 === 0,
  presenting: false,
  sharingScreen: false,
  videoAspectRatio: Math.random() < 0.7 ? 1.3 : Math.random() * 0.4 + 0.6,
  ...getDefaultConversationWithServiceId({
    isBlocked: index === 10 || index === MAX_PARTICIPANTS - 1,
    title: `Participant ${index + 1}`,
  }),
}));

export function GroupCallManyPaginated(): JSX.Element {
  const props = createProps({
    callMode: CallMode.Group,
    remoteParticipants: allRemoteParticipants,
    viewMode: CallViewMode.Paginated,
  });

  return <CallScreen {...props} />;
}
export function GroupCallManyPaginatedEveryoneTalking(): JSX.Element {
  const [props] = React.useState(
    createProps({
      callMode: CallMode.Group,
      remoteParticipants: allRemoteParticipants,
      viewMode: CallViewMode.Paginated,
    })
  );

  const activeCall = useMakeEveryoneTalk(
    props.activeCall as ActiveGroupCallType
  );

  return <CallScreen {...props} activeCall={activeCall} />;
}

export function GroupCallManyOverflow(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Group,
        remoteParticipants: allRemoteParticipants,
        viewMode: CallViewMode.Overflow,
      })}
    />
  );
}

export function GroupCallManyOverflowEveryoneTalking(): JSX.Element {
  const [props] = React.useState(
    createProps({
      callMode: CallMode.Group,
      remoteParticipants: allRemoteParticipants,
      viewMode: CallViewMode.Overflow,
    })
  );

  const activeCall = useMakeEveryoneTalk(
    props.activeCall as ActiveGroupCallType
  );

  return <CallScreen {...props} activeCall={activeCall} />;
}

export function GroupCallSpeakerView(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Group,
        viewMode: CallViewMode.Speaker,
        remoteParticipants: allRemoteParticipants.slice(0, 3),
      })}
    />
  );
}

export function GroupCallReconnecting(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Group,
        connectionState: GroupCallConnectionState.Reconnecting,
        remoteParticipants: [
          {
            aci: generateAci(),
            demuxId: 0,
            hasRemoteAudio: true,
            hasRemoteVideo: true,
            isHandRaised: false,
            presenting: false,
            sharingScreen: false,
            videoAspectRatio: 1.3,
            ...getDefaultConversation({
              isBlocked: false,
              title: 'Tyler',
              serviceId: generateAci(),
            }),
          },
        ],
      })}
    />
  );
}

export function GroupCall0(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Group,
        remoteParticipants: [],
      })}
    />
  );
}

export function GroupCallSomeoneIsSharingScreen(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Group,
        remoteParticipants: allRemoteParticipants
          .slice(0, 5)
          .map((participant, index) => ({
            ...participant,
            presenting: index === 1,
            sharingScreen: index === 1,
          })),
      })}
    />
  );
}

export function GroupCallSomeoneIsSharingScreenAndYoureReconnecting(): JSX.Element {
  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Group,
        connectionState: GroupCallConnectionState.Reconnecting,
        remoteParticipants: allRemoteParticipants
          .slice(0, 5)
          .map((participant, index) => ({
            ...participant,
            presenting: index === 1,
            sharingScreen: index === 1,
          })),
      })}
    />
  );
}

export function GroupCallSomeoneStoppedSharingScreen(): JSX.Element {
  const [remoteParticipants, setRemoteParticipants] = React.useState(
    allRemoteParticipants.slice(0, 5).map((participant, index) => ({
      ...participant,
      presenting: index === 1,
      sharingScreen: index === 1,
    }))
  );

  React.useEffect(() => {
    setTimeout(
      () => setRemoteParticipants(allRemoteParticipants.slice(0, 5)),
      1000
    );
  });

  return (
    <CallScreen
      {...createProps({
        callMode: CallMode.Group,
        remoteParticipants,
      })}
    />
  );
}

function ToastEmitter(): null {
  const { showToast } = useCallingToasts();
  const toastCount = React.useRef(0);
  React.useEffect(() => {
    const interval = setInterval(() => {
      const autoClose = toastCount.current % 2 === 0;
      showToast({
        key: Date.now().toString(),
        content: `${
          autoClose ? 'Disappearing' : 'Non-disappearing'
        } toast sent: ${Date.now()}`,
        dismissable: true,
        autoClose,
      });
      toastCount.current += 1;
    }, 1500);
    return () => clearInterval(interval);
  }, [showToast]);
  return null;
}

export function CallScreenToastAPalooza(): JSX.Element {
  return (
    <CallingToastProvider i18n={i18n}>
      <UnwrappedCallScreen {...createProps()} />
      <ToastEmitter />
    </CallingToastProvider>
  );
}

function useMakeEveryoneTalk(
  activeCall: ActiveGroupCallType,
  frequency = 2000
) {
  const [call, setCall] = React.useState(activeCall);
  React.useEffect(() => {
    const interval = setInterval(() => {
      const idxToStartSpeaking = Math.floor(
        Math.random() * call.remoteParticipants.length
      );

      const demuxIdToStartSpeaking = (
        call.remoteParticipants[
          idxToStartSpeaking
        ] as GroupCallRemoteParticipantType
      ).demuxId;

      const remoteAudioLevels = new Map();

      for (const [demuxId] of call.remoteAudioLevels.entries()) {
        if (demuxId === demuxIdToStartSpeaking) {
          remoteAudioLevels.set(demuxId, 1);
        } else {
          remoteAudioLevels.set(demuxId, 0);
        }
      }
      setCall(state => ({
        ...state,
        remoteParticipants: state.remoteParticipants.map((part, idx) => {
          return {
            ...part,
            hasRemoteAudio:
              idx === idxToStartSpeaking ? true : part.hasRemoteAudio,
            speakerTime:
              idx === idxToStartSpeaking
                ? Date.now()
                : (part as GroupCallRemoteParticipantType).speakerTime,
          };
        }),
        remoteAudioLevels,
      }));
    }, frequency);
    return () => clearInterval(interval);
  }, [frequency, call]);
  return call;
}

export function GroupCallReactions(): JSX.Element {
  const remoteParticipants = allRemoteParticipants.slice(0, 5);
  const [props] = React.useState(
    createProps({
      callMode: CallMode.Group,
      remoteParticipants,
      viewMode: CallViewMode.Overflow,
    })
  );

  const activeCall = useReactionsEmitter(
    props.activeCall as ActiveGroupCallType
  );

  return <CallScreen {...props} activeCall={activeCall} />;
}

export function GroupCallReactionsSpam(): JSX.Element {
  const remoteParticipants = allRemoteParticipants.slice(0, 5);
  const [props] = React.useState(
    createProps({
      callMode: CallMode.Group,
      remoteParticipants,
      viewMode: CallViewMode.Overflow,
    })
  );

  const activeCall = useReactionsEmitter(
    props.activeCall as ActiveGroupCallType,
    250
  );

  return <CallScreen {...props} activeCall={activeCall} />;
}

export function GroupCallReactionsBurstInOrder(): JSX.Element {
  const timestamp = Date.now();
  const remoteParticipants = allRemoteParticipants.slice(0, 5);
  const reactions = remoteParticipants.map((participant, i) => {
    const { demuxId } = participant;
    const value =
      DEFAULT_PREFERRED_REACTION_EMOJI[
        i % DEFAULT_PREFERRED_REACTION_EMOJI.length
      ];
    return { timestamp, demuxId, value };
  });
  const [props] = React.useState(
    createProps({
      callMode: CallMode.Group,
      remoteParticipants,
      viewMode: CallViewMode.Overflow,
      reactions,
    })
  );

  return <CallScreen {...props} />;
}

function useReactionsEmitter(
  activeCall: ActiveGroupCallType,
  frequency = 2000,
  removeAfter = 5000
) {
  const [call, setCall] = React.useState(activeCall);
  React.useEffect(() => {
    const interval = setInterval(() => {
      setCall(state => {
        const timeNow = Date.now();
        const expireAt = timeNow - removeAfter;

        const participantIndex = Math.floor(
          Math.random() * call.remoteParticipants.length
        );
        const { demuxId } = call.remoteParticipants[participantIndex];

        const reactions: ActiveCallReactionsType = [
          ...(state.reactions ?? []).filter(
            ({ timestamp }) => timestamp > expireAt
          ),
          {
            timestamp: timeNow,
            demuxId,
            value: sample(DEFAULT_PREFERRED_REACTION_EMOJI) as string,
          },
        ];

        return {
          ...state,
          reactions,
        };
      });
    }, frequency);
    return () => clearInterval(interval);
  }, [frequency, removeAfter, call]);
  return call;
}

export function GroupCallHandRaising(): JSX.Element {
  const remoteParticipants = allRemoteParticipants.slice(0, 10);
  const [props] = React.useState(
    createProps({
      callMode: CallMode.Group,
      remoteParticipants,
      viewMode: CallViewMode.Overflow,
    })
  );

  const activeCall = useHandRaiser(props.activeCall as ActiveGroupCallType);

  return <CallScreen {...props} activeCall={activeCall} />;
}

// Every [frequency] ms, all hands are lowered and [random min to max] random hands
// are raised
function useHandRaiser(
  activeCall: ActiveGroupCallType,
  frequency = 3000,
  min = 0,
  max = 5
) {
  const [call, setCall] = React.useState(activeCall);
  React.useEffect(() => {
    const interval = setInterval(() => {
      setCall(state => {
        const participantsCount = call.remoteParticipants.length;
        const usableMax = Math.min(max, participantsCount);
        const raiseCount = Math.floor(min + (usableMax - min) * Math.random());
        const participantIndices = shuffle(
          Array.from(Array(participantsCount).keys())
        ).slice(0, raiseCount);

        const participantIndicesSet = new Set(participantIndices);
        const remoteParticipants = [...call.remoteParticipants].map(
          (participant, index) => {
            return {
              ...participant,
              isHandRaised: participantIndicesSet.has(index),
            };
          }
        );

        const raisedHands = new Set(
          participantIndices.map(
            index => call.remoteParticipants[index].demuxId
          )
        );

        return {
          ...state,
          remoteParticipants,
          raisedHands,
        };
      });
    }, frequency);
    return () => clearInterval(interval);
  }, [frequency, call, max, min]);
  return call;
}
