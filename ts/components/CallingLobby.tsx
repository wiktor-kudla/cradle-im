// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import FocusTrap from 'focus-trap-react';
import classNames from 'classnames';
import type {
  SetLocalAudioType,
  SetLocalPreviewType,
  SetLocalVideoType,
} from '../state/ducks/calling';
import { CallingButton, CallingButtonType } from './CallingButton';
import { TooltipPlacement } from './Tooltip';
import { CallBackgroundBlur } from './CallBackgroundBlur';
import { CallParticipantCount } from './CallParticipantCount';
import { CallingHeader } from './CallingHeader';
import { CallingPreCallInfo, RingMode } from './CallingPreCallInfo';
import {
  CallingLobbyJoinButton,
  CallingLobbyJoinButtonVariant,
} from './CallingLobbyJoinButton';
import type { LocalizerType } from '../types/Util';
import { useIsOnline } from '../hooks/useIsOnline';
import * as KeyboardLayout from '../services/keyboardLayout';
import type { ConversationType } from '../state/ducks/conversations';
import { useCallingToasts } from './CallingToast';
import { CallingButtonToastsContainer } from './CallingToastManager';

export type PropsType = {
  availableCameras: Array<MediaDeviceInfo>;
  conversation: Pick<
    ConversationType,
    | 'acceptedMessageRequest'
    | 'avatarPath'
    | 'color'
    | 'isMe'
    | 'memberships'
    | 'name'
    | 'phoneNumber'
    | 'profileName'
    | 'sharedGroupNames'
    | 'title'
    | 'type'
    | 'unblurredAvatarPath'
  >;
  groupMembers?: Array<Pick<ConversationType, 'id' | 'firstName' | 'title'>>;
  hasLocalAudio: boolean;
  hasLocalVideo: boolean;
  i18n: LocalizerType;
  isConversationTooBigToRing: boolean;
  isGroupCall: boolean;
  isCallFull?: boolean;
  me: Readonly<
    Pick<ConversationType, 'avatarPath' | 'color' | 'id' | 'serviceId'>
  >;
  onCallCanceled: () => void;
  onJoinCall: () => void;
  outgoingRing: boolean;
  peekedParticipants: Array<ConversationType>;
  setLocalAudio: (_: SetLocalAudioType) => void;
  setLocalVideo: (_: SetLocalVideoType) => void;
  setLocalPreview: (_: SetLocalPreviewType) => void;
  setOutgoingRing: (_: boolean) => void;
  showParticipantsList: boolean;
  toggleParticipants: () => void;
  toggleSettings: () => void;
};

export function CallingLobby({
  availableCameras,
  conversation,
  groupMembers,
  hasLocalAudio,
  hasLocalVideo,
  i18n,
  isGroupCall = false,
  isCallFull = false,
  isConversationTooBigToRing,
  me,
  onCallCanceled,
  onJoinCall,
  peekedParticipants,
  setLocalAudio,
  setLocalPreview,
  setLocalVideo,
  setOutgoingRing,
  toggleParticipants,
  toggleSettings,
  outgoingRing,
}: PropsType): JSX.Element {
  const localVideoRef = React.useRef<null | HTMLVideoElement>(null);

  const shouldShowLocalVideo = hasLocalVideo && availableCameras.length > 0;

  const toggleAudio = React.useCallback((): void => {
    setLocalAudio({ enabled: !hasLocalAudio });
  }, [hasLocalAudio, setLocalAudio]);

  const toggleVideo = React.useCallback((): void => {
    setLocalVideo({ enabled: !hasLocalVideo });
  }, [hasLocalVideo, setLocalVideo]);

  const toggleOutgoingRing = React.useCallback((): void => {
    setOutgoingRing(!outgoingRing);
  }, [outgoingRing, setOutgoingRing]);

  React.useEffect(() => {
    setLocalPreview({ element: localVideoRef });

    return () => {
      setLocalPreview({ element: undefined });
    };
  }, [setLocalPreview]);

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      let eventHandled = false;

      const key = KeyboardLayout.lookup(event);
      if (event.shiftKey && (key === 'V' || key === 'v')) {
        toggleVideo();
        eventHandled = true;
      } else if (event.shiftKey && (key === 'M' || key === 'm')) {
        toggleAudio();
        eventHandled = true;
      }

      if (eventHandled) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleVideo, toggleAudio]);

  const isOnline = useIsOnline();

  const [isCallConnecting, setIsCallConnecting] = React.useState(false);

  // eslint-disable-next-line no-nested-ternary
  const videoButtonType = hasLocalVideo
    ? CallingButtonType.VIDEO_ON
    : availableCameras.length === 0
    ? CallingButtonType.VIDEO_DISABLED
    : CallingButtonType.VIDEO_OFF;

  const audioButtonType = hasLocalAudio
    ? CallingButtonType.AUDIO_ON
    : CallingButtonType.AUDIO_OFF;

  const isRingButtonVisible: boolean =
    isGroupCall &&
    peekedParticipants.length === 0 &&
    (groupMembers || []).length > 1;

  let preCallInfoRingMode: RingMode;
  if (isGroupCall) {
    preCallInfoRingMode =
      outgoingRing && !isConversationTooBigToRing
        ? RingMode.WillRing
        : RingMode.WillNotRing;
  } else {
    preCallInfoRingMode = RingMode.WillRing;
  }

  let ringButtonType:
    | CallingButtonType.RING_DISABLED
    | CallingButtonType.RING_ON
    | CallingButtonType.RING_OFF;
  if (isRingButtonVisible) {
    if (isConversationTooBigToRing) {
      ringButtonType = CallingButtonType.RING_DISABLED;
    } else if (outgoingRing) {
      ringButtonType = CallingButtonType.RING_ON;
    } else {
      ringButtonType = CallingButtonType.RING_OFF;
    }
  } else {
    ringButtonType = CallingButtonType.RING_DISABLED;
  }

  const canJoin = !isCallFull && !isCallConnecting && isOnline;

  let callingLobbyJoinButtonVariant: CallingLobbyJoinButtonVariant;
  if (isCallFull) {
    callingLobbyJoinButtonVariant = CallingLobbyJoinButtonVariant.CallIsFull;
  } else if (isCallConnecting) {
    callingLobbyJoinButtonVariant = CallingLobbyJoinButtonVariant.Loading;
  } else if (peekedParticipants.length) {
    callingLobbyJoinButtonVariant = CallingLobbyJoinButtonVariant.Join;
  } else {
    callingLobbyJoinButtonVariant = CallingLobbyJoinButtonVariant.Start;
  }

  const callStatus = React.useMemo(() => {
    if (isGroupCall) {
      return (
        <CallParticipantCount
          i18n={i18n}
          groupMemberCount={groupMembers?.length ?? 0}
          participantCount={peekedParticipants.length}
          toggleParticipants={toggleParticipants}
        />
      );
    }
    if (hasLocalVideo) {
      return i18n('icu:ContactListItem__menu__video-call');
    }
    if (hasLocalAudio) {
      return i18n('icu:CallControls__InfoDisplay--audio-call');
    }
    return null;
  }, [
    isGroupCall,
    peekedParticipants.length,
    i18n,
    hasLocalVideo,
    hasLocalAudio,
    groupMembers?.length,
    toggleParticipants,
  ]);

  useWasInitiallyMutedToast(hasLocalAudio, i18n);

  return (
    <FocusTrap>
      <div className="module-calling__container dark-theme">
        {shouldShowLocalVideo ? (
          <video
            className="module-CallingLobby__local-preview module-CallingLobby__local-preview--camera-is-on"
            ref={localVideoRef}
            autoPlay
          />
        ) : (
          <CallBackgroundBlur
            className="module-CallingLobby__local-preview module-CallingLobby__local-preview--camera-is-off"
            avatarPath={me.avatarPath}
            color={me.color}
          />
        )}

        <CallingHeader
          i18n={i18n}
          isGroupCall={isGroupCall}
          participantCount={peekedParticipants.length}
          toggleSettings={toggleSettings}
          onCancel={onCallCanceled}
        />

        <div className="module-calling__spacer module-CallingPreCallInfo-spacer" />
        <CallingPreCallInfo
          conversation={conversation}
          groupMembers={groupMembers}
          i18n={i18n}
          isCallFull={isCallFull}
          me={me}
          peekedParticipants={peekedParticipants}
          ringMode={preCallInfoRingMode}
        />

        <div
          className={classNames(
            'module-calling__camera-is-off module-CallingLobby__camera-is-off',
            `module-CallingLobby__camera-is-off--${
              shouldShowLocalVideo ? 'invisible' : 'visible'
            }`
          )}
        >
          {i18n('icu:calling__your-video-is-off')}
        </div>

        <CallingButtonToastsContainer
          hasLocalAudio={hasLocalAudio}
          outgoingRing={outgoingRing}
          i18n={i18n}
        />
        <div className="CallingLobby__Footer">
          <div className="module-calling__spacer CallControls__OuterSpacer" />
          <div className="CallControls">
            <div className="CallControls__InfoDisplay">
              <div className="CallControls__CallTitle">
                {conversation.title}
              </div>
              <div className="CallControls__Status">{callStatus}</div>
            </div>
            <div className="CallControls__ButtonContainer">
              <CallingButton
                buttonType={videoButtonType}
                i18n={i18n}
                onClick={toggleVideo}
                tooltipDirection={TooltipPlacement.Top}
              />
              <CallingButton
                buttonType={audioButtonType}
                i18n={i18n}
                onClick={toggleAudio}
                tooltipDirection={TooltipPlacement.Top}
              />
              <CallingButton
                buttonType={ringButtonType}
                i18n={i18n}
                isVisible={isRingButtonVisible}
                onClick={toggleOutgoingRing}
                tooltipDirection={TooltipPlacement.Top}
              />
            </div>
            <div className="CallControls__JoinLeaveButtonContainer">
              <CallingLobbyJoinButton
                disabled={!canJoin}
                i18n={i18n}
                onClick={() => {
                  setIsCallConnecting(true);
                  onJoinCall();
                }}
                variant={callingLobbyJoinButtonVariant}
              />
            </div>
          </div>
          <div className="module-calling__spacer CallControls__OuterSpacer" />
        </div>
      </div>
    </FocusTrap>
  );
}

function useWasInitiallyMutedToast(
  hasLocalAudio: boolean,
  i18n: LocalizerType
) {
  const [wasInitiallyMuted] = React.useState(!hasLocalAudio);
  const { showToast, hideToast } = useCallingToasts();
  const INITIALLY_MUTED_KEY = 'initially-muted-group-size';
  React.useEffect(() => {
    if (wasInitiallyMuted) {
      showToast({
        key: INITIALLY_MUTED_KEY,
        content: i18n(
          'icu:calling__lobby-automatically-muted-because-there-are-a-lot-of-people'
        ),
        autoClose: true,
        dismissable: true,
        onlyShowOnce: true,
      });
    }
  }, [wasInitiallyMuted, i18n, showToast]);

  // Hide this toast if the user unmutes
  React.useEffect(() => {
    if (wasInitiallyMuted && hasLocalAudio) {
      hideToast(INITIALLY_MUTED_KEY);
    }
  }, [hideToast, wasInitiallyMuted, hasLocalAudio]);
}
