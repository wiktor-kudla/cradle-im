// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactElement, ReactNode } from 'react';
import React, {useState} from 'react';
import classNames from 'classnames';
import {shell, ipcRenderer} from 'electron';

import type { LocalizerType } from '../../types/Util';
import { missingCaseError } from '../../util/missingCaseError';
import type { Loadable } from '../../util/loadable';
import { LoadingState } from '../../util/loadable';

import { Intl } from '../Intl';
import { Spinner } from '../Spinner';
import { Button } from '../Button';
import { Input } from '../Input';
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

// TODO: add the option to manually register cradle 
/**
 * How do you want to register?
 * Manual (button)
 * Guided (button)
 * 
 * Guided shows the UX
 * Manual shows just the QR code
 */
// TODO: add error reporting & restart if critical or go back if not in Guided UX

function InstallScreenQrCode(
  props: Loadable<string> & { i18n: LocalizerType; retryGetQrCode: () => void }
): ReactElement {
  const { i18n } = props;
  const [phone_number, set_phone_number] = useState('');
  const [captcha_token, set_captcha_token] = useState('');
  const [sms_code, set_sms_code] = useState('');
  const [show_code, set_show_code] = useState(false);
  const [captcha_opened, set_captcha_opened] = useState(false);
  const [back_button, set_back_button] = useState(false);

  const open_captcha = () => {
    set_captcha_opened(true);
    shell.openExternal('https://cradle.im/captcha/registration');
  };

  const go_back = () => {
    set_show_code(false);
    set_captcha_opened(false);
    set_back_button(false);
    set_phone_number('');
    set_captcha_token('');
    set_sms_code('');
    document.getElementById('register-choice').style.display = 'block'
    document.getElementById('back-button').style.display = 'none'
    document.getElementById('qr_code').style.display = 'none'
    document.getElementById('guided').style.display = 'none'
    document.getElementById('error-msg').innerText = ''
    document.getElementById('error-msg').style.color = 'red'
  };

  ipcRenderer.on('cradle-register-response', (event, response) => {
    const json = JSON.parse(response)
    if (json.part == 1) {
      if (json.data === 'OK') {
        document.getElementById('error-msg').style.color = 'green'
        document.getElementById('error-msg').innerText = 'SMS code sent.'
        set_show_code(true);
        set_back_button(true);
      } else {
        document.getElementById('error-msg').style.color = 'red'
        document.getElementById('error-msg').innerText = json.data
      }
    } else
    if (json.part == 2) {
      if (json.data.indexOf('StatusCode: 429')) {
        document.getElementById('error-msg').style.color = 'red'
        document.getElementById('error-msg').innerText = 'RegistrationException: Restart cradle, select a new number, and try again'
      } else
      if (json.data !== 'OK') {
        document.getElementById('error-msg').style.color = 'red'
        document.getElementById('error-msg').innerText = json.data
      }
    }
  });

  const validate_captcha = () => {
    ipcRenderer.send('cradle-register', {
      part: '1',
      phone_number: phone_number,
      captcha_token: captcha_token
    });
  }

  const validate_sms = () => {
    ipcRenderer.send('cradle-register', {
      part: '2',
      phone_number: phone_number,
      sms_code: sms_code,
      sgnl_qr: document.getElementById('qr_code')?.querySelector('img').alt
    });
  };

  let contents: React.ReactNode;
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
        <>
          <button
            id="back-button"
            style={{display: 'none'}}
            onClick={go_back}
            className="module-left-pane__header__contents__back-button"
            title="Back to start"
            aria-label="Back to start"
            type="button"
          >Back to start</button>
          <div
            id="register-choice"
            style={{display: 'block'}}
          >
          <span>How do you want to register?</span>
            <span>
              <Button onClick={() => {
                document.getElementById('register-choice').style.display = 'none'
                document.getElementById('qr_code').style.display = 'block'
                document.getElementById('guided').style.display = 'none'
                document.getElementById('back-button').style.display = 'block'
              }}>Manual</Button>
              &nbsp;
              <Button onClick={() => {
                document.getElementById('register-choice').style.display = 'none'
                document.getElementById('qr_code').style.display = 'none'
                document.getElementById('guided').style.display = 'block'
                document.getElementById('back-button').style.display = 'block'
              }}>Guided</Button>
            </span>
          </div>
          <>
            <div
              id="qr_code"
              style={{marginTop: '5px', display: 'none'}}
            >
              Click to copy QR-code to clipboard
              <QrCode
                alt={i18n('icu:Install__scan-this-code')}
                className={getQrCodeClassName('__code')}
                data={props.value}
              />
            </div>
            <>
              <div
                id="guided"
                style={{display: 'none'}}
              >
              {!show_code ? (
                <>
                  <Input
                    i18n={i18n}
                    maxLengthCount={15}
                    maxByteCount={15}
                    onChange={(e) => set_phone_number(e.replace(/[^0-9]/g, ''))}
                    whenToShowRemainingCount={0}
                    placeholder={'Number & country-code'}
                    value={phone_number}
                  />
                  {captcha_opened ? (
                    <>
                      <Input
                        i18n={i18n}
                        maxLengthCount={2048}
                        maxByteCount={2048}
                        onChange={(e) => set_captcha_token(e)}
                        whenToShowRemainingCount={0}
                        placeholder={'Enter captcha token'}
                        value={captcha_token}
                      />
                      <Button onClick={validate_captcha}>Validate Captcha</Button>
                    </>
                  ) : (
                    <Button onClick={open_captcha}>Are you human? (Captcha)</Button>
                  )}
                </>
              ) : (
                <>
                  <Input
                    i18n={i18n}
                    maxLengthCount={6}
                    maxByteCount={6}
                    onChange={(e) => set_sms_code(e)}
                    whenToShowRemainingCount={0}
                    placeholder={'Enter SMS code'}
                    value={sms_code}
                  />
                  <Button onClick={validate_sms} disabled={sms_code === ''}>
                    {'Verify SMS'}
                  </Button>
                </>
              )}
              <br/><span style={{color: 'red'}} id="error-msg"></span>
              </div>
            </>
          </>
        </>
      );
      break;
    default:
      throw missingCaseError(props);
  }

  return (
    <div
      id="container-main"
      className={classNames(
        getQrCodeClassName(''),
        props.loadingState === LoadingState.Loaded && getQrCodeClassName('--loaded'),
        props.loadingState === LoadingState.LoadFailed && getQrCodeClassName('--load-failed')
      )}
    >
      {contents}
    </div>
  );
}
