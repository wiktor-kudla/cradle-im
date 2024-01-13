// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import {
  CallMode,
  CallState,
  GroupCallConnectionState,
} from '../types/Calling';
import type { ActiveCallType } from '../types/Calling';

export function isReconnecting(activeCall: ActiveCallType): boolean {
  return (
    (activeCall.callMode === CallMode.Group &&
      activeCall.connectionState === GroupCallConnectionState.Reconnecting) ||
    (activeCall.callMode === CallMode.Direct &&
      activeCall.callState === CallState.Reconnecting)
  );
}
