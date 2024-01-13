// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as React from 'react';
import type { Meta } from '@storybook/react';
import { getDefaultConversation } from '../../test-both/helpers/getDefaultConversation';
import { setupI18n } from '../../util/setupI18n';
import enMessages from '../../../_locales/en/messages.json';
import type { PropsType } from './ProfileChangeNotification';
import { ProfileChangeNotification } from './ProfileChangeNotification';

const i18n = setupI18n('en', enMessages);

export default {
  title: 'Components/Conversation/ProfileChangeNotification',
} satisfies Meta<PropsType>;

export function FromContact(): JSX.Element {
  return (
    <ProfileChangeNotification
      i18n={i18n}
      changedContact={getDefaultConversation({
        id: 'some-guid',
        type: 'direct',
        title: 'Mr. Fire 🔥',
        name: 'Mr. Fire 🔥',
      })}
      change={{
        type: 'name',
        oldName: 'Mr. Fire 🔥 Old',
        newName: 'Mr. Fire 🔥 New',
      }}
    />
  );
}

export function FromNonContact(): JSX.Element {
  return (
    <ProfileChangeNotification
      i18n={i18n}
      changedContact={getDefaultConversation({
        id: 'some-guid',
        type: 'direct',
        title: 'Mr. Fire 🔥',
      })}
      change={{
        type: 'name',
        oldName: 'Mr. Fire 🔥 Old',
        newName: 'Mr. Fire 🔥 New',
      }}
    />
  );
}

export function FromContactWithLongNamesBeforeAndAfter(): JSX.Element {
  return (
    <ProfileChangeNotification
      i18n={i18n}
      changedContact={getDefaultConversation({
        id: 'some-guid',
        type: 'direct',
        title: 'Mr. Fire 🔥',
      })}
      change={{
        type: 'name',
        oldName: '💅🤷🏽‍♀️🏯'.repeat(50),
        newName: '☎️🎉🏝'.repeat(50),
      }}
    />
  );
}
