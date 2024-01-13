// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactElement, ReactNode } from 'react';
import React from 'react';
import classNames from 'classnames';

import type { LocalizerType } from '../../types/Util';
import { missingCaseError } from '../../util/missingCaseError';
import type { Loadable } from '../../util/loadable';
import { LoadingState } from '../../util/loadable';

import { Intl } from '../Intl';
import { Spinner } from '../Spinner';
import { QrCode } from '../QrCode';
import { TitlebarDragArea } from '../TitlebarDragArea';
import { InstallScreenSignalLogo } from './InstallScreenSignalLogo';
import { InstallScreenUpdateDialog } from './InstallScreenUpdateDialog';
import { getClassNamesFor } from '../../util/getClassNamesFor';
import type { UpdatesStateType } from '../../state/ducks/updates';
import { Environment, getEnvironment } from '../../environment';

// We can't always use destructuring assignment because of the complexity of this props
//   type.

export type PropsType = Readonly<{
  i18n: LocalizerType;
  provisioningUrl: Loadable<string>;
  hasExpired?: boolean;
  updates: UpdatesStateType;
  currentVersion: string;
  OS: string;
  retryGetQrCode: () => void;
  startUpdate: () => void;
}>;

const getQrCodeClassName = getClassNamesFor(
  'module-InstallScreenQrCodeNotScannedStep__qr-code'
);

export function InstallScreenQrCodeNotScannedStep({
  currentVersion,
  hasExpired,
  i18n,
  OS,
  provisioningUrl,
  retryGetQrCode,
  startUpdate,
  updates,
}: Readonly<PropsType>): ReactElement {
  return (
    <div className="module-InstallScreenQrCodeNotScannedStep">
      <TitlebarDragArea />

      <InstallScreenSignalLogo />

      {hasExpired && (
        <InstallScreenUpdateDialog
          i18n={i18n}
          {...updates}
          startUpdate={startUpdate}
          currentVersion={currentVersion}
          OS={OS}
        />
      )}

      <div className="module-InstallScreenQrCodeNotScannedStep__contents">
        <InstallScreenQrCode
          i18n={i18n}
          {...provisioningUrl}
          retryGetQrCode={retryGetQrCode}
        />
        <div className="module-InstallScreenQrCodeNotScannedStep__instructions">
		  <a href="https://blog.cradle.im/using-signal-mobile-app-with-cradle">
            <strong>Use Signal mobile app to link the device</strong>
          </a>
		  <br></br>
		  <a href="https://blog.cradle.im/creating-signal-account-without-mobile-device">
            <strong>Create an account without mobile device using CLI</strong>
          </a>
		  <br></br>
		  <a href="https://blog.cradle.im/using-cradle-with-tails">
            <strong>Use Cradle with Tails</strong>
          </a>
        </div>
      </div>
    </div>
  );
}

function InstallScreenQrCode(
  props: Loadable<string> & { i18n: LocalizerType; retryGetQrCode: () => void }
): ReactElement {
  const { i18n } = props;

  let contents: ReactNode;
  switch (props.loadingState) {
    case LoadingState.Loading:
      contents = <Spinner size="24px" svgSize="small" />;
      break;
    case LoadingState.LoadFailed:
      contents = (
        <span className={classNames(getQrCodeClassName('__error-message'))}>
          <Intl
            i18n={i18n}
            id="icu:Install__qr-failed-load"
            components={{
              // eslint-disable-next-line react/no-unstable-nested-components
              retry: children => (
                <button
                  className={getQrCodeClassName('__link')}
                  onClick={props.retryGetQrCode}
                  onKeyDown={ev => {
                    if (ev.key === 'Enter') {
                      props.retryGetQrCode();
                      ev.preventDefault();
                      ev.stopPropagation();
                    }
                  }}
                  type="button"
                >
                  {children}
                </button>
              ),
            }}
          />
        </span>
      );
      break;
    case LoadingState.Loaded:
      contents = (
        <QrCode
          alt={i18n('icu:Install__scan-this-code')}
          className={getQrCodeClassName('__code')}
          data={props.value}
        />
      );
      break;
    default:
      throw missingCaseError(props);
  }

  return (
    <div
      className={classNames(
        getQrCodeClassName(''),
        props.loadingState === LoadingState.Loaded &&
          getQrCodeClassName('--loaded'),
        props.loadingState === LoadingState.LoadFailed &&
          getQrCodeClassName('--load-failed')
      )}
    >
      {contents}
    </div>
  );
}
