// Copyright 2018 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/* eslint-env node */

import path from 'path';

import { compose } from 'lodash/fp';
import { escapeRegExp, isString, isRegExp } from 'lodash';

export const APP_ROOT_PATH = path.join(__dirname, '..', '..');

const PHONE_NUMBER_PATTERN = /\+\d{7,12}(\d{3})/g;
// The additional 0 in [04] and [089AB] are to include MY_STORY_ID
const UUID_OR_STORY_ID_PATTERN =
  /[0-9A-F]{8}-[0-9A-F]{4}-[04][0-9A-F]{3}-[089AB][0-9A-F]{3}-[0-9A-F]{9}([0-9A-F]{3})/gi;
const GROUP_ID_PATTERN = /(group\()([^)]+)(\))/g;
const GROUP_V2_ID_PATTERN = /(groupv2\()([^=)]+)(=?=?\))/g;
const REDACTION_PLACEHOLDER = '[REDACTED]';

export type RedactFunction = (value: string) => string;

export const _redactPath = (filePath: string): RedactFunction => {
  if (!isString(filePath)) {
    throw new TypeError("'filePath' must be a string");
  }

  const filePathPattern = _pathToRegExp(filePath);

  return (text: string): string => {
    if (!isString(text)) {
      throw new TypeError("'text' must be a string");
    }

    if (!isRegExp(filePathPattern)) {
      return text;
    }

    return text.replace(filePathPattern, REDACTION_PLACEHOLDER);
  };
};

export const _pathToRegExp = (filePath: string): RegExp | undefined => {
  try {
    return new RegExp(
      // Any possible prefix that we want to include
      `(${escapeRegExp('file:///')})?${
        // The rest of the file path
        filePath
          // Split by system path seperator ("/" or "\\")
          // (split by both for tests)
          .split(/\/|\\/)
          // Escape all special characters in each part
          .map(part => {
            // This segment may need to be URI encoded
            const urlEncodedPart = encodeURI(part);
            // If its the same, then we don't need to worry about it
            if (urlEncodedPart === part) {
              return escapeRegExp(part);
            }
            // Otherwise, we need to test against both
            return `(${escapeRegExp(part)}|${escapeRegExp(urlEncodedPart)})`;
          })
          // Join the parts back together with any possible path seperator
          .join(
            `(${[
              // Posix (Linux, macOS, etc.)
              path.posix.sep,
              // Windows
              path.win32.sep,
              // Windows (URI encoded)
              encodeURI(path.win32.sep),
            ]
              // Escape the parts for use in a RegExp (e.g. "/" -> "\/")
              .map(sep => escapeRegExp(sep))
              // In case separators are repeated in the path (e.g. "\\\\")
              .map(sep => `${sep}+`)
              // Join all the possible separators together
              .join('|')})`
          )
      }`,
      'g'
    );
  } catch (error) {
    return undefined;
  }
};

// Public API
export const redactPhoneNumbers = (text: string): string => {
  if (!isString(text)) {
    throw new TypeError("'text' must be a string");
  }

  return text.replace(PHONE_NUMBER_PATTERN, `+${REDACTION_PLACEHOLDER}$1`);
};

export const redactUuids = (text: string): string => {
  if (!isString(text)) {
    throw new TypeError("'text' must be a string");
  }

  return text.replace(UUID_OR_STORY_ID_PATTERN, `${REDACTION_PLACEHOLDER}$1`);
};

export const redactGroupIds = (text: string): string => {
  if (!isString(text)) {
    throw new TypeError("'text' must be a string");
  }

  return text
    .replace(
      GROUP_ID_PATTERN,
      (_, before, id, after) =>
        `${before}${REDACTION_PLACEHOLDER}${removeNewlines(id).slice(
          -3
        )}${after}`
    )
    .replace(
      GROUP_V2_ID_PATTERN,
      (_, before, id, after) =>
        `${before}${REDACTION_PLACEHOLDER}${removeNewlines(id).slice(
          -3
        )}${after}`
    );
};

const createRedactSensitivePaths = (
  paths: ReadonlyArray<string>
): RedactFunction => {
  return compose(paths.map(filePath => _redactPath(filePath)));
};

const sensitivePaths: Array<string> = [];

let redactSensitivePaths: RedactFunction = (text: string) => text;

export const addSensitivePath = (filePath: string): void => {
  sensitivePaths.push(filePath);
  redactSensitivePaths = createRedactSensitivePaths(sensitivePaths);
};

addSensitivePath(APP_ROOT_PATH);

export const redactAll: RedactFunction = compose(
  (text: string) => redactSensitivePaths(text),
  redactGroupIds,
  redactPhoneNumbers,
  redactUuids
);

const removeNewlines: RedactFunction = text => text.replace(/\r?\n|\r/g, '');
