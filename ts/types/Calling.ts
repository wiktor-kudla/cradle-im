// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { AudioDevice, Reaction as CallReaction } from '@signalapp/ringrtc';
import type { ConversationType } from '../state/ducks/conversations';
import type { AciString, ServiceIdString } from './ServiceId';

export const MAX_CALLING_REACTIONS = 5;
export const CALLING_REACTIONS_LIFETIME = 4000;

// These are strings (1) for the database (2) for Storybook.
export enum CallMode {
  Direct = 'Direct',
  Group = 'Group',
}

// Speaker and Presentation mode have the same UI, but Presentation is only set
// automatically when someone starts to present, and will revert to the previous view mode
// once presentation is complete
export enum CallViewMode {
  Paginated = 'Paginated',
  Overflow = 'Overflow',
  Speaker = 'Speaker',
  Presentation = 'Presentation',
}

export type PresentableSource = {
  appIcon?: string;
  id: string;
  name: string;
  isScreen: boolean;
  thumbnail: string;
};

export type PresentedSource = {
  id: string;
  name: string;
};

// export type ActiveCallReactionsType = {
//   [timestamp: number]: ReadonlyArray<CallReaction>;
// };

export type ActiveCallReaction = {
  timestamp: number;
} & CallReaction;

export type ActiveCallReactionsType = ReadonlyArray<ActiveCallReaction>;

export type ActiveCallBaseType = {
  conversation: ConversationType;
  hasLocalAudio: boolean;
  hasLocalVideo: boolean;
  localAudioLevel: number;
  viewMode: CallViewMode;
  viewModeBeforePresentation?: CallViewMode;
  isSharingScreen?: boolean;
  joinedAt: number | null;
  outgoingRing: boolean;
  pip: boolean;
  presentingSource?: PresentedSource;
  presentingSourcesAvailable?: Array<PresentableSource>;
  settingsDialogOpen: boolean;
  showNeedsScreenRecordingPermissionsWarning?: boolean;
  showParticipantsList: boolean;
  reactions?: ActiveCallReactionsType;
};

export type ActiveDirectCallType = ActiveCallBaseType & {
  callMode: CallMode.Direct;
  callState?: CallState;
  callEndedReason?: CallEndedReason;
  peekedParticipants: [];
  remoteParticipants: [
    {
      hasRemoteVideo: boolean;
      presenting: boolean;
      title: string;
      // Note that the field name/type has to match the
      //   GroupCallRemoteParticipantType below (which is based on
      //   ConversationType).
      serviceId?: ServiceIdString;
    }
  ];
};

export type ActiveGroupCallType = ActiveCallBaseType & {
  callMode: CallMode.Group;
  connectionState: GroupCallConnectionState;
  conversationsByDemuxId: ConversationsByDemuxIdType;
  conversationsWithSafetyNumberChanges: Array<ConversationType>;
  joinState: GroupCallJoinState;
  localDemuxId: number | undefined;
  maxDevices: number;
  deviceCount: number;
  groupMembers: Array<Pick<ConversationType, 'id' | 'firstName' | 'title'>>;
  isConversationTooBigToRing: boolean;
  peekedParticipants: Array<ConversationType>;
  raisedHands: Set<number>;
  remoteParticipants: Array<GroupCallRemoteParticipantType>;
  remoteAudioLevels: Map<number, number>;
};

export type ActiveCallType = ActiveDirectCallType | ActiveGroupCallType;

// Ideally, we would import many of these directly from RingRTC. But because Storybook
//   cannot import RingRTC (as it runs in the browser), we have these copies. That also
//   means we have to convert the "real" enum to our enum in some cases.

// Must be kept in sync with RingRTC.CallState
export enum CallState {
  Prering = 'idle',
  Ringing = 'ringing',
  Accepted = 'connected',
  Reconnecting = 'connecting',
  Ended = 'ended',
}

// Must be kept in sync with RingRTC.CallEndedReason
export enum CallEndedReason {
  LocalHangup = 'LocalHangup',
  RemoteHangup = 'RemoteHangup',
  RemoteHangupNeedPermission = 'RemoteHangupNeedPermission',
  Declined = 'Declined',
  Busy = 'Busy',
  Glare = 'Glare',
  ReCall = 'ReCall',
  ReceivedOfferExpired = 'ReceivedOfferExpired',
  ReceivedOfferWhileActive = 'ReceivedOfferWhileActive',
  ReceivedOfferWithGlare = 'ReceivedOfferWithGlare',
  SignalingFailure = 'SignalingFailure',
  GlareFailure = 'GlareFailure',
  ConnectionFailure = 'ConnectionFailure',
  InternalFailure = 'InternalFailure',
  Timeout = 'Timeout',
  AcceptedOnAnotherDevice = 'AcceptedOnAnotherDevice',
  DeclinedOnAnotherDevice = 'DeclinedOnAnotherDevice',
  BusyOnAnotherDevice = 'BusyOnAnotherDevice',
}

// Must be kept in sync with RingRTC's ConnectionState
export enum GroupCallConnectionState {
  NotConnected = 0,
  Connecting = 1,
  Connected = 2,
  Reconnecting = 3,
}

// Must be kept in sync with RingRTC's JoinState
export enum GroupCallJoinState {
  NotJoined = 0,
  Joining = 1,
  Pending = 2,
  Joined = 3,
}

export type GroupCallRemoteParticipantType = ConversationType & {
  aci: AciString;
  demuxId: number;
  hasRemoteAudio: boolean;
  hasRemoteVideo: boolean;
  isHandRaised: boolean;
  presenting: boolean;
  sharingScreen: boolean;
  speakerTime?: number;
  videoAspectRatio: number;
};

export type ConversationsByDemuxIdType = Map<number, ConversationType>;

// Similar to RingRTC's `VideoRequest` but without the `framerate` property.
export type GroupCallVideoRequest = {
  demuxId: number;
  width: number;
  height: number;
};

export enum CallingDeviceType {
  CAMERA,
  MICROPHONE,
  SPEAKER,
}

export type AvailableIODevicesType = {
  availableCameras: Array<MediaDeviceInfo>;
  availableMicrophones: Array<AudioDevice>;
  availableSpeakers: Array<AudioDevice>;
};

export type MediaDeviceSettings = AvailableIODevicesType & {
  selectedMicrophone: AudioDevice | undefined;
  selectedSpeaker: AudioDevice | undefined;
  selectedCamera: string | undefined;
};

export type ChangeIODevicePayloadType =
  | { type: CallingDeviceType.CAMERA; selectedDevice: string }
  | { type: CallingDeviceType.MICROPHONE; selectedDevice: AudioDevice }
  | { type: CallingDeviceType.SPEAKER; selectedDevice: AudioDevice };
