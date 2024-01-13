// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { createSelector } from 'reselect';

import type { StateType } from '../reducer';
import type {
  CallingStateType,
  CallsByConversationType,
  DirectCallStateType,
  GroupCallStateType,
} from '../ducks/calling';
import { getIncomingCall as getIncomingCallHelper } from '../ducks/callingHelpers';
import { getUserACI } from './user';
import { getOwn } from '../../util/getOwn';
import type { AciString } from '../../types/ServiceId';

export type CallStateType = DirectCallStateType | GroupCallStateType;

const getCalling = (state: StateType): CallingStateType => state.calling;

export const getActiveCallState = createSelector(
  getCalling,
  (state: CallingStateType) => state.activeCallState
);

export const getCallsByConversation = createSelector(
  getCalling,
  (state: CallingStateType): CallsByConversationType =>
    state.callsByConversation
);

export type CallSelectorType = (
  conversationId: string
) => CallStateType | undefined;
export const getCallSelector = createSelector(
  getCallsByConversation,
  (callsByConversation: CallsByConversationType): CallSelectorType =>
    (conversationId: string) =>
      getOwn(callsByConversation, conversationId)
);

export const getActiveCall = createSelector(
  getActiveCallState,
  getCallSelector,
  (activeCallState, callSelector): undefined | CallStateType => {
    if (activeCallState && activeCallState.conversationId) {
      return callSelector(activeCallState.conversationId);
    }

    return undefined;
  }
);

export const isInCall = createSelector(
  getActiveCall,
  (call: CallStateType | undefined): boolean => Boolean(call)
);

export const isInFullScreenCall = createSelector(
  getCalling,
  (state: CallingStateType): boolean =>
    Boolean(state.activeCallState && !state.activeCallState.pip)
);

export const getIncomingCall = createSelector(
  getCallsByConversation,
  getUserACI,
  (
    callsByConversation: CallsByConversationType,
    ourAci: AciString | undefined
  ): undefined | DirectCallStateType | GroupCallStateType => {
    if (!ourAci) {
      return undefined;
    }

    return getIncomingCallHelper(callsByConversation, ourAci);
  }
);

export const areAnyCallsActiveOrRinging = createSelector(
  getActiveCall,
  getIncomingCall,
  (activeCall, incomingCall): boolean => Boolean(activeCall || incomingCall)
);
