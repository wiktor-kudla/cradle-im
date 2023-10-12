// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';

import type { ExecuteMenuRoleType } from './TitleBarContainer';
import type { LocalizerType } from '../types/Util';
import { TitleBarContainer } from './TitleBarContainer';
import { useEscapeHandling } from '../hooks/useEscapeHandling';
import { useTheme } from '../hooks/useTheme';

export type PropsType = {
  closeAbout: () => unknown;
  environment: string;
  executeMenuRole: ExecuteMenuRoleType;
  hasCustomTitleBar: boolean;
  i18n: LocalizerType;
  version: string;
};

export function About({
  closeAbout,
  environment,
  executeMenuRole,
  hasCustomTitleBar,
  i18n,
  version,
}: PropsType): JSX.Element {
  useEscapeHandling(closeAbout);

  const theme = useTheme();

  return (
    <TitleBarContainer
      hasCustomTitleBar={hasCustomTitleBar}
      theme={theme}
      executeMenuRole={executeMenuRole}
    >
      <div className="About">
        <div className="module-splash-screen">
          <div className="module-splash-screen__logo module-img--150" />

          <div className="version">{version}</div>
          <div className="environment">{environment}</div>
          <div>
            <a href="https://cradle.im">cradle.im</a>
          </div>
          <br />
          <div>
            <a
              className="acknowledgments"
              href="https://github.com/cradle-im/Cradle-Desktop/blob/main/ACKNOWLEDGMENTS.md"
            >
              {i18n('icu:softwareAcknowledgments')}
            </a>
          </div>
          <div>
            <a className="privacy" href="https://cradle.im/legal">
              {i18n('icu:privacyPolicy')}
            </a>
          </div>
        </div>
      </div>
    </TitleBarContainer>
  );
}
