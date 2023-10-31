// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { BrowserWindow } from 'electron';
import _fs from 'fs';
import type { Updater } from './common';
import { isLinuxVersionSupported } from './linux';
import type { LoggerType } from '../types/Logging';
import { DialogType } from '../types/Dialogs';

let initialized = false;

let updater: Updater | undefined;

export async function start(
  logger: LoggerType,
  getMainWindow: () => BrowserWindow | undefined
): Promise<void> {
  const { platform } = process;
  
  if (initialized) {
    throw new Error('updater/start: Updates have already been initialized!');
  }
  initialized = true;

  if (!logger) {
    throw new Error('updater/start: Must provide logger!');
  }

  if (platform === 'linux') {
    if (!isLinuxVersionSupported(logger)) {
      getMainWindow()?.webContents.send(
        'show-update-dialog',
        DialogType.UnsupportedOS
      );
    }
  }

  await updater?.start();
}

export async function force(): Promise<void> {
  if (!initialized) {
    throw new Error("updater/force: Updates haven't been initialized!");
  }

  if (updater) {
    await updater.force();
  }
}