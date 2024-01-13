// Copyright 2017 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { BrowserWindow } from 'electron';
import { ipcMain as ipc, session } from 'electron';
import { EventEmitter } from 'events';

import { userConfig } from '../../app/user_config';
import { ephemeralConfig } from '../../app/ephemeral_config';
import { installPermissionsHandler } from '../../app/permissions';
import { strictAssert } from '../util/assert';
import { explodePromise } from '../util/explodePromise';
import type {
  IPCEventsValuesType,
  IPCEventsCallbacksType,
} from '../util/createIPCEvents';

const EPHEMERAL_NAME_MAP = new Map([
  ['spellCheck', 'spell-check'],
  ['systemTraySetting', 'system-tray-setting'],
  ['themeSetting', 'theme-setting'],
  ['localeOverride', 'localeOverride'],
]);

type ResponseQueueEntry = Readonly<{
  resolve(value: unknown): void;
  reject(error: Error): void;
}>;

export class SettingsChannel extends EventEmitter {
  private mainWindow?: BrowserWindow;

  private readonly responseQueue = new Map<number, ResponseQueueEntry>();

  private responseSeq = 0;

  public setMainWindow(mainWindow: BrowserWindow | undefined): void {
    this.mainWindow = mainWindow;
  }

  public getMainWindow(): BrowserWindow | undefined {
    return this.mainWindow;
  }

  public install(): void {
    this.installSetting('deviceName', { setter: false });

    // ChatColorPicker redux hookups
    this.installCallback('getCustomColors');
    this.installCallback('getConversationsWithCustomColor');
    this.installCallback('resetAllChatColors');
    this.installCallback('resetDefaultChatColor');
    this.installCallback('addCustomColor');
    this.installCallback('editCustomColor');
    this.installCallback('removeCustomColor');
    this.installCallback('removeCustomColorOnConversations');
    this.installCallback('setGlobalDefaultConversationColor');
    this.installCallback('getDefaultConversationColor');

    // Various callbacks
    this.installCallback('deleteAllMyStories');
    this.installCallback('getAvailableIODevices');
    this.installCallback('isPrimary');
    this.installCallback('syncRequest');
    this.installCallback('isPhoneNumberSharingEnabled');

    // Getters only. These are set by the primary device
    this.installSetting('blockedCount', { setter: false });
    this.installSetting('linkPreviewSetting', { setter: false });
    this.installSetting('readReceiptSetting', { setter: false });
    this.installSetting('typingIndicatorSetting', { setter: false });

    this.installSetting('themeSetting', {
      isEphemeral: true,
    });
    this.installSetting('hideMenuBar');
    this.installSetting('systemTraySetting', {
      isEphemeral: true,
    });

    this.installSetting('localeOverride', {
      isEphemeral: true,
    });
    this.installSetting('notificationSetting');
    this.installSetting('notificationDrawAttention');
    this.installSetting('audioMessage');
    this.installSetting('audioNotification');
    this.installSetting('countMutedConversations');

    this.installSetting('sentMediaQualitySetting');
    this.installSetting('spellCheck', {
      isEphemeral: true,
    });
    this.installSetting('textFormatting');

    this.installSetting('autoDownloadUpdate');
    this.installSetting('autoLaunch');

    this.installSetting('alwaysRelayCalls');
    this.installSetting('callRingtoneNotification');
    this.installSetting('callSystemNotification');
    this.installSetting('incomingCallNotification');

    // Media settings
    this.installSetting('preferredAudioInputDevice');
    this.installSetting('preferredAudioOutputDevice');
    this.installSetting('preferredVideoInputDevice');

    this.installSetting('lastSyncTime');
    this.installSetting('universalExpireTimer');

    this.installSetting('hasStoriesDisabled');
    this.installSetting('zoomFactor');

    this.installSetting('phoneNumberDiscoverabilitySetting');
    this.installSetting('phoneNumberSharingSetting');

    installPermissionsHandler({ session: session.defaultSession, userConfig });

    // These ones are different because its single source of truth is userConfig,
    // not IndexedDB
    ipc.handle('settings:get:mediaPermissions', () => {
      return userConfig.get('mediaPermissions') || false;
    });
    ipc.handle('settings:get:mediaCameraPermissions', () => {
      return userConfig.get('mediaCameraPermissions') || false;
    });
    ipc.handle('settings:set:mediaPermissions', (_event, value) => {
      userConfig.set('mediaPermissions', value);

      // We reinstall permissions handler to ensure that a revoked permission takes effect
      installPermissionsHandler({
        session: session.defaultSession,
        userConfig,
      });
    });
    ipc.handle('settings:set:mediaCameraPermissions', (_event, value) => {
      userConfig.set('mediaCameraPermissions', value);

      // We reinstall permissions handler to ensure that a revoked permission takes effect
      installPermissionsHandler({
        session: session.defaultSession,
        userConfig,
      });
    });

    ipc.on('settings:response', (_event, seq, error, value) => {
      const entry = this.responseQueue.get(seq);
      this.responseQueue.delete(seq);
      if (!entry) {
        return;
      }

      const { resolve, reject } = entry;
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    });
  }

  private waitForResponse<Value>(): { promise: Promise<Value>; seq: number } {
    const seq = this.responseSeq;

    // eslint-disable-next-line no-bitwise
    this.responseSeq = (this.responseSeq + 1) & 0x7fffffff;

    const { promise, resolve, reject } = explodePromise<Value>();

    this.responseQueue.set(seq, { resolve, reject });

    return { seq, promise };
  }

  public getSettingFromMainWindow<Name extends keyof IPCEventsValuesType>(
    name: Name
  ): Promise<IPCEventsValuesType[Name]> {
    const { mainWindow } = this;
    if (!mainWindow || !mainWindow.webContents) {
      throw new Error('No main window');
    }

    const { seq, promise } = this.waitForResponse<IPCEventsValuesType[Name]>();

    mainWindow.webContents.send(`settings:get:${name}`, { seq });

    return promise;
  }

  public setSettingInMainWindow<Name extends keyof IPCEventsValuesType>(
    name: Name,
    value: IPCEventsValuesType[Name]
  ): Promise<void> {
    const { mainWindow } = this;
    if (!mainWindow || !mainWindow.webContents) {
      throw new Error('No main window');
    }

    const { seq, promise } = this.waitForResponse<void>();

    mainWindow.webContents.send(`settings:set:${name}`, { seq, value });

    return promise;
  }

  public invokeCallbackInMainWindow<Name extends keyof IPCEventsCallbacksType>(
    name: Name,
    args: ReadonlyArray<unknown>
  ): Promise<unknown> {
    const { mainWindow } = this;
    if (!mainWindow || !mainWindow.webContents) {
      throw new Error('Main window not found');
    }

    const { seq, promise } = this.waitForResponse<unknown>();

    mainWindow.webContents.send(`settings:call:${name}`, { seq, args });

    return promise;
  }

  private installCallback<Name extends keyof IPCEventsCallbacksType>(
    name: Name
  ): void {
    ipc.handle(`settings:call:${name}`, async (_event, args) => {
      return this.invokeCallbackInMainWindow(name, args);
    });
  }

  private installSetting<Name extends keyof IPCEventsValuesType>(
    name: Name,
    {
      getter = true,
      setter = true,
      isEphemeral = false,
    }: { getter?: boolean; setter?: boolean; isEphemeral?: boolean } = {}
  ): void {
    if (getter) {
      ipc.handle(`settings:get:${name}`, async () => {
        return this.getSettingFromMainWindow(name);
      });
    }

    if (!setter) {
      return;
    }

    ipc.handle(`settings:set:${name}`, async (_event, value) => {
      if (isEphemeral) {
        const ephemeralName = EPHEMERAL_NAME_MAP.get(name);
        strictAssert(
          ephemeralName !== undefined,
          `${name} is not an ephemeral setting`
        );
        ephemeralConfig.set(ephemeralName, value);
      }

      await this.setSettingInMainWindow(name, value);

      this.emit(`change:${name}`, value);
    });
  }
}
