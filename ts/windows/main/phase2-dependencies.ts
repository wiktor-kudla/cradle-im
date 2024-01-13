// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import Backbone from 'backbone';
import { PhoneNumberUtil, PhoneNumberFormat } from 'google-libphonenumber';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import * as moment from 'moment';
import 'moment/min/locales.min';

import { textsecure } from '../../textsecure';
import * as Attachments from '../attachments';
import { setup } from '../../signal';
import { addSensitivePath } from '../../util/privacy';
import * as log from '../../logging/log';
import { SignalContext } from '../context';

window.nodeSetImmediate = setImmediate;
window.Backbone = Backbone;
window.textsecure = textsecure;

const { config } = window.SignalContext;

window.WebAPI = window.textsecure.WebAPI.initialize({
  url: config.serverUrl,
  storageUrl: config.storageUrl,
  updatesUrl: config.updatesUrl,
  resourcesUrl: config.resourcesUrl,
  artCreatorUrl: config.artCreatorUrl,
  directoryConfig: config.directoryConfig,
  cdnUrlObject: {
    0: config.cdnUrl0,
    2: config.cdnUrl2,
    3: config.cdnUrl3,
  },
  certificateAuthority: config.certificateAuthority,
  contentProxyUrl: config.contentProxyUrl,
  proxyUrl: config.proxyUrl,
  version: config.version,
});

window.libphonenumberInstance = PhoneNumberUtil.getInstance();
window.libphonenumberFormat = PhoneNumberFormat;

window.React = React;
window.ReactDOM = ReactDOM;

const { resolvedTranslationsLocale, preferredSystemLocales, localeOverride } =
  config;

moment.updateLocale(localeOverride ?? resolvedTranslationsLocale, {
  relativeTime: {
    s: window.i18n('icu:timestamp_s'),
    m: window.i18n('icu:timestamp_m'),
    h: window.i18n('icu:timestamp_h'),
  },
});
moment.locale(
  localeOverride != null ? [localeOverride] : preferredSystemLocales
);

const userDataPath = SignalContext.getPath('userData');
window.BasePaths = {
  attachments: Attachments.getPath(userDataPath),
  draft: Attachments.getDraftPath(userDataPath),
  stickers: Attachments.getStickersPath(userDataPath),
  temp: Attachments.getTempPath(userDataPath),
};

addSensitivePath(window.BasePaths.attachments);
if (config.crashDumpsPath) {
  addSensitivePath(config.crashDumpsPath);
}

window.Signal = setup({
  Attachments,
  getRegionCode: () => window.storage.get('regionCode'),
  logger: log,
  userDataPath,
});
