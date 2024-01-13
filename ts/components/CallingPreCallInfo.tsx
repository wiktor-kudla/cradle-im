// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import type { ConversationType } from '../state/ducks/conversations';
import type { LocalizerType } from '../types/Util';
import { Avatar, AvatarSize } from './Avatar';
import { getParticipantName } from '../util/callingGetParticipantName';
import { missingCaseError } from '../util/missingCaseError';
import { UserText } from './UserText';

export enum RingMode {
  WillNotRing,
  WillRing,
  IsRinging,
}

export type PropsType = {
  conversation: Pick<
    ConversationType,
    | 'acceptedMessageRequest'
    | 'avatarPath'
    | 'color'
    | 'isMe'
    | 'phoneNumber'
    | 'profileName'
    | 'sharedGroupNames'
    | 'title'
    | 'type'
    | 'unblurredAvatarPath'
  >;
  i18n: LocalizerType;
  me: Pick<ConversationType, 'id' | 'serviceId'>;
  ringMode: RingMode;

  // The following should only be set for group conversations.
  groupMembers?: Array<Pick<ConversationType, 'id' | 'firstName' | 'title'>>;
  isCallFull?: boolean;
  peekedParticipants?: Array<
    Pick<ConversationType, 'firstName' | 'title' | 'serviceId'>
  >;
};

export function CallingPreCallInfo({
  conversation,
  groupMembers = [],
  i18n,
  isCallFull = false,
  me,
  peekedParticipants = [],
  ringMode,
}: PropsType): JSX.Element {
  let subtitle: string;
  if (ringMode === RingMode.IsRinging) {
    subtitle = i18n('icu:outgoingCallRinging');
  } else if (isCallFull) {
    subtitle = i18n('icu:calling__call-is-full');
  } else if (peekedParticipants.length) {
    // It should be rare to see yourself in this list, but it's possible if (1) you rejoin
    //   quickly, causing the server to return stale state (2) you have joined on another
    //   device.
    let hasYou = false;
    const participantNames = peekedParticipants.map(participant => {
      if (participant.serviceId === me.serviceId) {
        hasYou = true;
        return i18n('icu:you');
      }
      return getParticipantName(participant);
    });

    switch (participantNames.length) {
      case 1:
        subtitle = hasYou
          ? i18n('icu:calling__pre-call-info--another-device-in-call')
          : i18n('icu:calling__pre-call-info--1-person-in-call', {
              first: participantNames[0],
            });
        break;
      case 2:
        subtitle = i18n('icu:calling__pre-call-info--2-people-in-call', {
          first: participantNames[0],
          second: participantNames[1],
        });
        break;
      case 3:
        subtitle = i18n('icu:calling__pre-call-info--3-people-in-call', {
          first: participantNames[0],
          second: participantNames[1],
          third: participantNames[2],
        });
        break;
      default:
        subtitle = i18n('icu:calling__pre-call-info--many-people-in-call', {
          first: participantNames[0],
          second: participantNames[1],
          others: String(participantNames.length - 2),
        });
        break;
    }
  } else {
    let memberNames: Array<string>;
    switch (conversation.type) {
      case 'direct':
        memberNames = [getParticipantName(conversation)];
        break;
      case 'group':
        memberNames = groupMembers
          .filter(member => member.id !== me.id)
          .map(getParticipantName);
        break;
      default:
        throw missingCaseError(conversation.type);
    }

    const ring = ringMode === RingMode.WillRing;

    switch (memberNames.length) {
      case 0:
        subtitle = i18n('icu:calling__pre-call-info--empty-group');
        break;
      case 1: {
        subtitle = ring
          ? i18n('icu:calling__pre-call-info--will-ring-1', {
              person: memberNames[0],
            })
          : i18n('icu:calling__pre-call-info--will-notify-1', {
              person: memberNames[0],
            });
        break;
      }
      case 2: {
        subtitle = ring
          ? i18n('icu:calling__pre-call-info--will-ring-2', {
              first: memberNames[0],
              second: memberNames[1],
            })
          : i18n('icu:calling__pre-call-info--will-notify-2', {
              first: memberNames[0],
              second: memberNames[1],
            });
        break;
      }
      case 3: {
        subtitle = ring
          ? i18n('icu:calling__pre-call-info--will-ring-3', {
              first: memberNames[0],
              second: memberNames[1],
              third: memberNames[2],
            })
          : i18n('icu:calling__pre-call-info--will-notify-3', {
              first: memberNames[0],
              second: memberNames[1],
              third: memberNames[2],
            });
        break;
      }
      default: {
        subtitle = ring
          ? i18n('icu:calling__pre-call-info--will-ring-many', {
              first: memberNames[0],
              second: memberNames[1],
              others: String(memberNames.length - 2),
            })
          : i18n('icu:calling__pre-call-info--will-notify-many', {
              first: memberNames[0],
              second: memberNames[1],
              others: String(memberNames.length - 2),
            });
        break;
      }
    }
  }

  return (
    <div className="module-CallingPreCallInfo">
      <Avatar
        avatarPath={conversation.avatarPath}
        badge={undefined}
        color={conversation.color}
        acceptedMessageRequest={conversation.acceptedMessageRequest}
        conversationType={conversation.type}
        isMe={conversation.isMe}
        noteToSelf={false}
        phoneNumber={conversation.phoneNumber}
        profileName={conversation.profileName}
        sharedGroupNames={conversation.sharedGroupNames}
        size={AvatarSize.NINETY_SIX}
        title={conversation.title}
        unblurredAvatarPath={conversation.unblurredAvatarPath}
        i18n={i18n}
      />
      <div className="module-CallingPreCallInfo__title">
        <UserText text={conversation.title} />
      </div>
      <div className="module-CallingPreCallInfo__subtitle">{subtitle}</div>
    </div>
  );
}
