// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcRenderer } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { usernames } from '@signalapp/libsignal-client';

import type { MenuOptionsType, MenuActionType } from '../types/menu';
import type { IPCEventsValuesType } from '../util/createIPCEvents';
import type { LocalizerType } from '../types/Util';
import type { LoggerType } from '../types/Logging';
import type { NativeThemeType } from '../context/createNativeThemeListener';
import type { SettingType } from '../util/preload';
import type { RendererConfigType } from '../types/RendererConfig';

import { Bytes } from '../context/Bytes';
import { Crypto } from '../context/Crypto';
import { Timers } from '../context/Timers';

import type { ActiveWindowServiceType } from '../services/ActiveWindowService';
import { i18n } from '../context/i18n';
import { strictAssert } from '../util/assert';
import { initialize as initializeLogging } from '../logging/set_up_renderer_logging';
import { MinimalSignalContext } from './minimalContext';
import type { LocaleDirection } from '../../app/locale';
import type { HourCyclePreference } from '../types/I18N';

strictAssert(Boolean(window.SignalContext), 'context must be defined');

initializeLogging();

export type MainWindowStatsType = Readonly<{
  isMaximized: boolean;
  isFullScreen: boolean;
}>;

export type MinimalSignalContextType = {
  activeWindowService: ActiveWindowServiceType;
  config: RendererConfigType;
  executeMenuAction: (action: MenuActionType) => Promise<void>;
  executeMenuRole: (role: MenuItemConstructorOptions['role']) => Promise<void>;
  getAppInstance: () => string | undefined;
  getEnvironment: () => string;
  getI18nAvailableLocales: () => ReadonlyArray<string>;
  getI18nLocale: LocalizerType['getLocale'];
  getI18nLocaleMessages: LocalizerType['getLocaleMessages'];
  getLocaleDisplayNames: () => Record<string, Record<string, string>>;
  getResolvedMessagesLocaleDirection: () => LocaleDirection;
  getHourCyclePreference: () => HourCyclePreference;
  getResolvedMessagesLocale: () => string;
  getPreferredSystemLocales: () => Array<string>;
  getLocaleOverride: () => string | null;
  getMainWindowStats: () => Promise<MainWindowStatsType>;
  getMenuOptions: () => Promise<MenuOptionsType>;
  getNodeVersion: () => string;
  getPath: (name: 'userData' | 'home' | 'install') => string;
  getVersion: () => string;
  nativeThemeListener: NativeThemeType;
  restartApp: () => void;
  Settings: {
    themeSetting: SettingType<IPCEventsValuesType['themeSetting']>;
    waitForChange: () => Promise<void>;
  };
  OS: {
    hasCustomTitleBar: () => boolean;
    getClassName: () => string;
    platform: string;
    release: string;
  };
};

export type SignalContextType = {
  bytes: Bytes;
  crypto: Crypto;
  usernames: typeof usernames;
  i18n: LocalizerType;
  log: LoggerType;
  renderWindow?: () => void;
  setIsCallActive: (isCallActive: boolean) => unknown;
  timers: Timers;
} & MinimalSignalContextType;

export const SignalContext: SignalContextType = {
  ...MinimalSignalContext,
  bytes: new Bytes(),
  crypto: new Crypto(),
  usernames,
  i18n,
  log: window.SignalContext.log,
  setIsCallActive(isCallActive: boolean): void {
    ipcRenderer.send('set-is-call-active', isCallActive);
  },
  timers: new Timers(),
};

window.SignalContext = SignalContext;
window.i18n = SignalContext.i18n;
