// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as Errors from '../types/errors';
import { DAY } from '../util/durations';
import { drop } from '../util/drop';
import { BackOff, FIBONACCI_TIMEOUTS } from '../util/BackOff';
import { checkForUsername } from '../util/lookupConversationWithoutServiceId';
import { storageJobQueue } from '../util/JobQueue';
import * as log from '../logging/log';
import { resolveUsernameByLink } from './username';

const CHECK_INTERVAL = DAY;

class UsernameIntegrityService {
  private isStarted = false;
  private readonly backOff = new BackOff(FIBONACCI_TIMEOUTS);

  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    this.isStarted = true;

    this.scheduleCheck();
  }

  private scheduleCheck(): void {
    const lastCheckTimestamp = window.storage.get(
      'usernameLastIntegrityCheck',
      0
    );
    const delay = Math.max(0, lastCheckTimestamp + CHECK_INTERVAL - Date.now());
    if (delay === 0) {
      log.info('usernameIntegrity: running the check immediately');
      drop(this.safeCheck());
    } else {
      log.info(`usernameIntegrity: running the check in ${delay}ms`);
      setTimeout(() => drop(this.safeCheck()), delay);
    }
  }

  private async safeCheck(): Promise<void> {
    try {
      await storageJobQueue(() => this.check());
      this.backOff.reset();
      await window.storage.put('usernameLastIntegrityCheck', Date.now());

      this.scheduleCheck();
    } catch (error) {
      const delay = this.backOff.getAndIncrement();
      log.error(
        'usernameIntegrity: check failed with ' +
          `error: ${Errors.toLogFormat(error)} retrying in ${delay}ms`
      );
      setTimeout(() => drop(this.safeCheck()), delay);
    }
  }

  private async check(): Promise<void> {
    const me = window.ConversationController.getOurConversationOrThrow();
    const username = me.get('username');
    const aci = me.getAci();

    let failed = false;

    if (!username) {
      log.info('usernameIntegrity: no username');
      return;
    }
    if (!aci) {
      log.info('usernameIntegrity: no aci');
      return;
    }

    const result = await checkForUsername(username);
    if (result?.aci !== aci) {
      log.error('usernameIntegrity: no remote username');
      await window.storage.put('usernameCorrupted', true);
      failed = true;

      // Intentional fall-through
    }

    const link = window.storage.get('usernameLink');
    if (!link) {
      log.info('usernameIntegrity: no username link');
      return;
    }

    const linkUsername = await resolveUsernameByLink(link);
    if (linkUsername !== username) {
      log.error('usernameIntegrity: invalid username link');
      await window.storage.put('usernameLinkCorrupted', true);
      failed = true;
    }

    if (!failed) {
      log.info('usernameIntegrity: check pass');
    }
  }
}

export const usernameIntegrity = new UsernameIntegrityService();
