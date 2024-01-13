// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { action } from '@storybook/addon-actions';
import type { Meta } from '@storybook/react';
import { setupI18n } from '../../util/setupI18n';
import enMessages from '../../../_locales/en/messages.json';
import type { Props } from './InstallScreenErrorStep';
import { InstallScreenErrorStep, InstallError } from './InstallScreenErrorStep';

const i18n = setupI18n('en', enMessages);

export default {
  title: 'Components/InstallScreen/InstallScreenErrorStep',
} satisfies Meta<Props>;

const defaultProps = {
  i18n,
  quit: action('quit'),
  tryAgain: action('tryAgain'),
};

export const _TooManyDevices = (): JSX.Element => (
  <InstallScreenErrorStep
    {...defaultProps}
    error={InstallError.TooManyDevices}
  />
);

export const _TooOld = (): JSX.Element => (
  <InstallScreenErrorStep {...defaultProps} error={InstallError.TooOld} />
);

export const __TooOld = (): JSX.Element => (
  <InstallScreenErrorStep {...defaultProps} error={InstallError.TooOld} />
);

export const _ConnectionFailed = (): JSX.Element => (
  <InstallScreenErrorStep
    {...defaultProps}
    error={InstallError.ConnectionFailed}
  />
);

export const _UnknownError = (): JSX.Element => (
  <InstallScreenErrorStep {...defaultProps} error={InstallError.UnknownError} />
);
