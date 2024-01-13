// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import '../ts/window.d.ts';

import React from 'react';

import 'sanitize.css';
import '../stylesheets/manifest.scss';
import '../node_modules/@indutny/frameless-titlebar/dist/styles.css';

import * as styles from './styles.scss';
import messages from '../_locales/en/messages.json';
import { StorybookThemeContext } from './StorybookThemeContext';
import { ThemeType } from '../ts/types/Util';
import { setupI18n } from '../ts/util/setupI18n';
import { HourCyclePreference } from '../ts/types/I18N';
import { Provider } from 'react-redux';
import { Store, combineReducers, createStore } from 'redux';
import { StateType } from '../ts/state/reducer';
import {
  ScrollerLockContext,
  createScrollerLock,
} from '../ts/hooks/useScrollLock';

const i18n = setupI18n('en', messages);

export const globalTypes = {
  mode: {
    name: 'Mode',
    description: 'Application mode',
    defaultValue: 'mouse',
    toolbar: {
      dynamicTitle: true,
      icon: 'circlehollow',
      items: ['mouse', 'keyboard'],
      showName: true,
    },
  },
  theme: {
    name: 'Theme',
    description: 'Global theme for components',
    defaultValue: 'light',
    toolbar: {
      dynamicTitle: true,
      icon: 'circlehollow',
      items: ['light', 'dark'],
      showName: true,
    },
  },
};

const mockStore: Store<StateType> = createStore(
  combineReducers({
    calling: (state = {}) => state,
    conversations: (
      state = {
        conversationLookup: {},
        targetedConversationPanels: {},
      }
    ) => state,
    globalModals: (state = {}) => state,
    user: (state = {}) => state,
  })
);

// eslint-disable-next-line
const noop = () => {};

window.Whisper = window.Whisper || {};
window.Whisper.events = {
  on: noop,
};

window.SignalContext = {
  i18n,

  activeWindowService: {
    isActive: () => true,
    registerForActive: noop,
    unregisterForActive: noop,
    registerForChange: noop,
    unregisterForChange: noop,
  },

  nativeThemeListener: {
    getSystemTheme: () => 'light',
    subscribe: noop,
    unsubscribe: noop,
    update: () => 'light',
  },
  Settings: {
    themeSetting: {
      getValue: async () => 'light',
      setValue: async () => 'light',
    },
    waitForChange: () => new Promise(noop),
  },
  OS: {
    hasCustomTitleBar: () => false,
    getClassName: () => '',
    platform: '',
    release: '',
  },
  usernames: {
    hash: input => Buffer.from(input),
  } as any,
  config: {} as any,

  getHourCyclePreference: () => HourCyclePreference.UnknownPreference,
  getPreferredSystemLocales: () => ['en'],
  getResolvedMessagesLocaleDirection: () => 'ltr',
  getLocaleOverride: () => null,
  getLocaleDisplayNames: () => ({ en: { en: 'English' } }),
};

window.i18n = i18n;
window.ConversationController = window.ConversationController || {};
window.ConversationController.isSignalConversationId = () => false;
window.ConversationController.onConvoMessageMount = noop;
window.reduxStore = mockStore;

const withModeAndThemeProvider = (Story, context) => {
  const theme =
    context.globals.theme === 'light' ? ThemeType.light : ThemeType.dark;
  const mode = context.globals.mode;

  // Adding it to the body as well so that we can cover modals and other
  // components that are rendered outside of this decorator container
  if (theme === 'light') {
    document.body.classList.add('light-theme');
    document.body.classList.remove('dark-theme');
  } else {
    document.body.classList.remove('light-theme');
    document.body.classList.add('dark-theme');
  }

  if (mode === 'mouse') {
    document.body.classList.remove('keyboard-mode');
    document.body.classList.add('mouse-mode');
  } else {
    document.body.classList.remove('mouse-mode');
    document.body.classList.add('keyboard-mode');
  }

  document.body.classList.add('page-is-visible');

  return (
    <div className={styles.container}>
      <StorybookThemeContext.Provider value={theme}>
        <Story {...context} />
      </StorybookThemeContext.Provider>
    </div>
  );
};

function withMockStoreProvider(Story, context) {
  return (
    <Provider store={mockStore}>
      <Story {...context} />
    </Provider>
  );
}

function withScrollLockProvider(Story, context) {
  return (
    <ScrollerLockContext.Provider
      value={createScrollerLock('MockStories', () => {})}
    >
      <Story {...context} />
    </ScrollerLockContext.Provider>
  );
}

export const decorators = [
  withModeAndThemeProvider,
  withMockStoreProvider,
  withScrollLockProvider,
];

export const parameters = {
  axe: {
    disabledRules: ['html-has-lang'],
  },
};
