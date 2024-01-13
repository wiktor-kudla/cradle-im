// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { get, throttle } from 'lodash';

import type { WebAPIType } from './textsecure/WebAPI';
import * as log from './logging/log';
import type { AciString } from './types/ServiceId';
import { parseIntOrThrow } from './util/parseIntOrThrow';
import { SECOND, HOUR } from './util/durations';
import * as Bytes from './Bytes';
import { uuidToBytes } from './util/uuidToBytes';
import { dropNull } from './util/dropNull';
import { HashType } from './types/Crypto';
import { getCountryCode } from './types/PhoneNumber';

export type ConfigKeyType =
  | 'cds.disableCompatibilityMode'
  | 'desktop.calling.sendScreenShare1800'
  | 'desktop.cdsi.returnAcisWithoutUaks'
  | 'desktop.clientExpiration'
  | 'desktop.groupMultiTypingIndicators'
  | 'desktop.internalUser'
  | 'desktop.mediaQuality.levels'
  | 'desktop.messageCleanup'
  | 'desktop.pnp'
  | 'desktop.pnp.accountE164Deprecation'
  | 'desktop.retryRespondMaxAge'
  | 'desktop.senderKey.retry'
  | 'desktop.senderKeyMaxAge'
  | 'desktop.usernames'
  | 'global.attachments.maxBytes'
  | 'global.attachments.maxReceiveBytes'
  | 'global.calling.maxGroupCallRingSize'
  | 'global.groupsv2.groupSizeHardLimit'
  | 'global.groupsv2.maxGroupSize'
  | 'global.nicknames.max'
  | 'global.nicknames.min';

type ConfigValueType = {
  name: ConfigKeyType;
  enabled: boolean;
  enabledAt?: number;
  value?: string;
};
export type ConfigMapType = {
  [key in ConfigKeyType]?: ConfigValueType;
};
type ConfigListenerType = (value: ConfigValueType) => unknown;
type ConfigListenersMapType = {
  [key: string]: Array<ConfigListenerType>;
};

let config: ConfigMapType = {};
const listeners: ConfigListenersMapType = {};

export async function initRemoteConfig(server: WebAPIType): Promise<void> {
  config = window.storage.get('remoteConfig') || {};
  await maybeRefreshRemoteConfig(server);
}

export function onChange(
  key: ConfigKeyType,
  fn: ConfigListenerType
): () => void {
  const keyListeners: Array<ConfigListenerType> = get(listeners, key, []);
  keyListeners.push(fn);
  listeners[key] = keyListeners;

  return () => {
    listeners[key] = listeners[key].filter(l => l !== fn);
  };
}

export const refreshRemoteConfig = async (
  server: WebAPIType
): Promise<void> => {
  const now = Date.now();
  const { config: newConfig, serverEpochTime } = await server.getConfig();
  const serverTimeSkew = serverEpochTime * SECOND - now;

  if (Math.abs(serverTimeSkew) > HOUR) {
    log.warn(
      'Remote Config: sever clock skew detected. ' +
        `Server time ${serverEpochTime * SECOND}, local time ${now}`
    );
  }

  // Process new configuration in light of the old configuration
  // The old configuration is not set as the initial value in reduce because
  // flags may have been deleted
  const oldConfig = config;
  config = newConfig.reduce((acc, { name, enabled, value }) => {
    const previouslyEnabled: boolean = get(oldConfig, [name, 'enabled'], false);
    const previousValue: string | undefined = get(
      oldConfig,
      [name, 'value'],
      undefined
    );
    // If a flag was previously not enabled and is now enabled,
    // record the time it was enabled
    const enabledAt: number | undefined =
      previouslyEnabled && enabled ? now : get(oldConfig, [name, 'enabledAt']);

    const configValue = {
      name: name as ConfigKeyType,
      enabled,
      enabledAt,
      value: dropNull(value),
    };

    const hasChanged =
      previouslyEnabled !== enabled || previousValue !== configValue.value;

    // If enablement changes at all, notify listeners
    const currentListeners = listeners[name] || [];
    if (hasChanged) {
      log.info(`Remote Config: Flag ${name} has changed`);
      currentListeners.forEach(listener => {
        listener(configValue);
      });
    }

    // Return new configuration object
    return {
      ...acc,
      [name]: configValue,
    };
  }, {});

  await window.storage.put('remoteConfig', config);
  await window.storage.put('serverTimeSkew', serverTimeSkew);
};

export const maybeRefreshRemoteConfig = throttle(
  refreshRemoteConfig,
  // Only fetch remote configuration if the last fetch was more than two hours ago
  2 * 60 * 60 * 1000,
  { trailing: false }
);

export function isEnabled(name: ConfigKeyType): boolean {
  return get(config, [name, 'enabled'], false);
}

export function getValue(name: ConfigKeyType): string | undefined {
  return get(config, [name, 'value'], undefined);
}

// See isRemoteConfigBucketEnabled in selectors/items.ts
export function isBucketValueEnabled(
  name: ConfigKeyType,
  e164: string | undefined,
  aci: AciString | undefined
): boolean {
  return innerIsBucketValueEnabled(name, getValue(name), e164, aci);
}

export function innerIsBucketValueEnabled(
  name: ConfigKeyType,
  flagValue: unknown,
  e164: string | undefined,
  aci: AciString | undefined
): boolean {
  if (e164 == null || aci == null) {
    return false;
  }

  const countryCode = getCountryCode(e164);
  if (countryCode == null) {
    return false;
  }

  if (typeof flagValue !== 'string') {
    return false;
  }

  const remoteConfigValue = getCountryCodeValue(countryCode, flagValue, name);
  if (remoteConfigValue == null) {
    return false;
  }

  const bucketValue = getBucketValue(aci, name);
  return bucketValue < remoteConfigValue;
}

export function getCountryCodeValue(
  countryCode: number,
  flagValue: string,
  flagName: string
): number | undefined {
  const logId = `getCountryCodeValue/${flagName}`;
  if (flagValue.length === 0) {
    return undefined;
  }

  const countryCodeString = countryCode.toString();
  const items = flagValue.split(',');

  let wildcard: number | undefined;
  for (const item of items) {
    const [code, value] = item.split(':');
    if (code == null || value == null) {
      log.warn(`${logId}: '${code}:${value}' entry was invalid`);
      continue;
    }

    const parsedValue = parseIntOrThrow(
      value,
      `${logId}: Country code '${code}' had an invalid number '${value}'`
    );
    if (code === '*') {
      wildcard = parsedValue;
    } else if (countryCodeString === code) {
      return parsedValue;
    }
  }

  return wildcard;
}

export function getBucketValue(aci: AciString, flagName: string): number {
  const hashInput = Bytes.concatenate([
    Bytes.fromString(`${flagName}.`),
    uuidToBytes(aci),
  ]);
  const hashResult = window.SignalContext.crypto.hash(
    HashType.size256,
    hashInput
  );

  return Number(Bytes.readBigUint64BE(hashResult.slice(0, 8)) % 1_000_000n);
}
