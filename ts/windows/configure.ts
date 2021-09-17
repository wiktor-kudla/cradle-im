// Copyright 2018-2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import url from 'url';
import { ipcRenderer } from 'electron';

import i18n from '../../js/modules/i18n';
import {
  getEnvironment,
  parseEnvironment,
  setEnvironment,
} from '../environment';
import { strictAssert } from '../util/assert';

const config = url.parse(window.location.toString(), true).query;
const { locale } = config;
strictAssert(locale, 'locale could not be parsed from config');
strictAssert(typeof locale === 'string', 'locale is not a string');

const localeMessages = ipcRenderer.sendSync('locale-data');
setEnvironment(parseEnvironment(config.environment));

export const SignalWindow = {
  config,
  getAppInstance: (): string | undefined =>
    config.appInstance ? String(config.appInstance) : undefined,
  getEnvironment,
  getVersion: (): string => String(config.version),
  i18n: i18n.setup(locale, localeMessages),
};