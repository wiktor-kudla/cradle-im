// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { pathToFileURL } from 'url';
import { autoUpdater } from 'electron';
import { writeFile } from 'fs/promises';
import { join } from 'path';

import { Updater, createTempDir, deleteTempDir } from './common';
import { explodePromise } from '../util/explodePromise';
import * as Errors from '../types/errors';
import { markShouldQuit } from '../../app/window_state';
import { DialogType } from '../types/Dialogs';

export class MacOSUpdater extends Updater {
  protected async deletePreviousInstallers(): Promise<void> {
    // No installers are cache on macOS
  }

  protected async installUpdate(updateFilePath: string): Promise<void> {
    const { logger } = this;

    logger.info('downloadAndInstall: handing download to electron...');
    try {
      await this.handToAutoUpdate(updateFilePath);
    } catch (error) {
      const readOnly = 'Cannot update while running on a read-only volume';
      const message: string = error.message || '';
      this.markCannotUpdate(
        error,
        message.includes(readOnly)
          ? DialogType.MacOS_Read_Only
          : DialogType.Cannot_Update
      );

      throw error;
    }

    // At this point, closing the app will cause the update to be installed automatically
    //   because Squirrel has cached the update file and will do the right thing.

    this.setUpdateListener(async () => {
      logger.info('downloadAndInstall: restarting...');
      markShouldQuit();
      autoUpdater.quitAndInstall();
    });
  }

  private async handToAutoUpdate(filePath: string): Promise<void> {
    const { logger } = this;
    const { promise, resolve, reject } = explodePromise<void>();

    autoUpdater.on('error', (...args) => {
      logger.error('autoUpdater: error', ...args.map(Errors.toLogFormat));

      const [error] = args;
      reject(error);
    });
    autoUpdater.on('update-downloaded', () => {
      logger.info('autoUpdater: update-downloaded event fired');
      resolve();
    });

    // See: https://github.com/electron/electron/issues/5020#issuecomment-477636990
    const updateUrl = pathToFileURL(filePath).href;

    const tempDir = await createTempDir();
    try {
      const feedPath = join(tempDir, 'feed.json');
      await writeFile(
        feedPath,
        JSON.stringify({
          url: updateUrl,
        })
      );

      autoUpdater.setFeedURL({
        url: pathToFileURL(feedPath).href,
        serverType: 'json',
      });
      autoUpdater.checkForUpdates();

      await promise;
    } finally {
      await deleteTempDir(this.logger, tempDir);
    }
  }
}
