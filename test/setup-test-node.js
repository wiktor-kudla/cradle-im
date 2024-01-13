// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/* eslint-disable no-console */

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const { usernames } = require('@signalapp/libsignal-client');

const { Crypto } = require('../ts/context/Crypto');
const { setEnvironment, Environment } = require('../ts/environment');
const { HourCyclePreference } = require('../ts/types/I18N');

chai.use(chaiAsPromised);

setEnvironment(Environment.Test);

const storageMap = new Map();

// To replicate logic we have on the client side
global.window = {
  Date,
  performance,
  SignalContext: {
    crypto: new Crypto(),
    usernames,
    log: {
      info: (...args) => console.log(...args),
      warn: (...args) => console.warn(...args),
      error: (...args) => console.error(...args),
    },
    getResolvedMessagesLocale: () => 'en',
    getResolvedMessagesLocaleDirection: () => 'ltr',
    getHourCyclePreference: () => HourCyclePreference.UnknownPreference,
    getPreferredSystemLocales: () => ['en'],
    getLocaleOverride: () => null,
  },
  i18n: key => `i18n(${key})`,
  storage: {
    get: key => storageMap.get(key),
    put: async (key, value) => storageMap.set(key, value),
  },
};

// For ducks/network.getEmptyState()
global.navigator = {};
global.WebSocket = {};

// For GlobalAudioContext.tsx
/* eslint max-classes-per-file: ["error", 2] */
global.AudioContext = class {};
global.Audio = class {
  pause() {}
  addEventListener() {}
};
