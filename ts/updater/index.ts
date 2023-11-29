// Copyright 2019 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { BrowserWindow } from 'electron';
import { exec, spawn } from 'child_process';
import fs from 'fs/promises';
import _fs from 'fs';
import axios from 'axios';
import path from 'path';
import * as os from 'os';
import type { Updater } from './common';

let initialized = false;

let updater: Updater | undefined;

export async function force(): Promise<void> {
  if (!initialized) {
    throw new Error("updater/force: Updates haven't been initialized!");
  }

  if (updater) {
    await updater.force();
  }
}