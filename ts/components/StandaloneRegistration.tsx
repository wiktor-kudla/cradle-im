// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ChangeEvent } from 'react';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Plugin } from 'intl-tel-input';
import intlTelInput from 'intl-tel-input';

import { strictAssert } from '../util/assert';
import * as log from '../logging/log';
import { parseNumber } from '../util/libphonenumberUtil';
import { getChallengeURL } from '../challenge';
import { VerificationTransport } from '../types/VerificationTransport';

function PhoneInput({
  onValidation,
  onNumberChange,
}: {
  onValidation: (isValid: boolean) => void;
  onNumberChange: (number?: string) => void;
}): JSX.Element {
  const [isValid, setIsValid] = useState(false);
  const pluginRef = useRef<Plugin | undefined>();
  const elemRef = useRef<HTMLInputElement | null>(null);

  const onRef = useCallback((elem: HTMLInputElement | null) => {
    elemRef.current = elem;

    if (!elem) {
      return;
    }

    pluginRef.current?.destroy();

    const plugin = intlTelInput(elem);
    pluginRef.current = plugin;
  }, []);

  const validateNumber = useCallback(
    (number: string) => {
      const { current: plugin } = pluginRef;
      if (!plugin) {
        return;
      }

      const regionCode = plugin.getSelectedCountryData().iso2;

      const parsedNumber = parseNumber(number, regionCode);

      setIsValid(parsedNumber.isValidNumber);
      onValidation(parsedNumber.isValidNumber);

      onNumberChange(
        parsedNumber.isValidNumber ? parsedNumber.e164 : undefined
      );
    },
    [setIsValid, onNumberChange, onValidation]
  );

  const onChange = useCallback(
    (_: ChangeEvent<HTMLInputElement>) => {
      if (elemRef.current) {
        validateNumber(elemRef.current.value);
      }
    },
    [validateNumber]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Pacify TypeScript and handle events bubbling up
      if (event.target instanceof HTMLInputElement) {
        validateNumber(event.target.value);
      }
    },
    [validateNumber]
  );

  return (
    <div className="phone-input">
      <div className="phone-input-form">
        <div className={`number-container ${isValid ? 'valid' : 'invalid'}`}>
          <input
            className="number"
            type="tel"
            ref={onRef}
            onChange={onChange}
            onKeyDown={onKeyDown}
            placeholder="Phone Number"
          />
        </div>
      </div>
    </div>
  );
}

export function StandaloneRegistration({
  onComplete,
  requestVerification,
  registerSingleDevice,
}: {
  onComplete: () => void;
  requestVerification: (
    number: string,
    captcha: string,
    transport: VerificationTransport
  ) => Promise<{ sessionId: string }>;
  registerSingleDevice: (
    number: string,
    code: string,
    sessionId: string
  ) => Promise<void>;
}): JSX.Element {
  useEffect(() => {
    window.IPC.readyForUpdates();
  }, []);

  const [isValidNumber, setIsValidNumber] = useState(false);
  const [isValidCode, setIsValidCode] = useState(false);
  const [number, setNumber] = useState<string | undefined>(undefined);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);

  const onRequestCode = useCallback(
    async (transport: VerificationTransport) => {
      if (!isValidNumber) {
        return;
      }

      if (!number) {
        setIsValidNumber(false);
        setError(undefined);
        return;
      }

      const url = getChallengeURL('registration');
      log.info(`StandaloneRegistration: navigating to ${url}`);
      document.location.href = url;
      if (!window.Signal.challengeHandler) {
        setError('Captcha handler is not ready!');
        return;
      }
      const token = await window.Signal.challengeHandler.requestCaptcha({
        reason: 'standalone registration',
      });

      try {
        const result = await requestVerification(number, token, transport);
        setSessionId(result.sessionId);
        setError(undefined);
      } catch (err) {
        setError(err.message);
      }
    },
    [isValidNumber, setIsValidNumber, setError, requestVerification, number]
  );

  const onSMSClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();

      void onRequestCode(VerificationTransport.SMS);
    },
    [onRequestCode]
  );

  const onVoiceClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();

      void onRequestCode(VerificationTransport.Voice);
    },
    [onRequestCode]
  );

  const onChangeCode = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;

      setIsValidCode(value.length === 6);
      setCode(value);
    },
    [setIsValidCode, setCode]
  );

  const onVerifyCode = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (!isValidNumber || !isValidCode || !sessionId) {
        return;
      }

      strictAssert(number != null && code.length > 0, 'Missing number or code');

      try {
        await registerSingleDevice(number, code, sessionId);
        onComplete();
      } catch (err) {
        setStatus(err.message);
      }
    },
    [
      registerSingleDevice,
      onComplete,
      number,
      code,
      sessionId,
      setStatus,
      isValidNumber,
      isValidCode,
    ]
  );

  return (
    <div className="full-screen-flow">
      <div className="module-title-bar-drag-area" />

      <div className="step">
        <div className="inner">
          <div className="step-body">
            <div className="banner-image module-splash-screen__logo module-img--128" />
            <div className="header">Create your Signal Account</div>
            <div>
              <div className="phone-input-form">
                <PhoneInput
                  onValidation={setIsValidNumber}
                  onNumberChange={setNumber}
                />
              </div>
            </div>
            <div className="clearfix">
              <button
                type="button"
                className="button"
                disabled={!isValidNumber}
                onClick={onSMSClick}
              >
                Send SMS
              </button>
              <button
                type="button"
                className="link"
                tabIndex={-1}
                disabled={!isValidNumber}
                onClick={onVoiceClick}
              >
                Call
              </button>
            </div>
            <input
              className={`form-control ${isValidCode ? 'valid' : 'invalid'}`}
              type="text"
              dir="auto"
              pattern="\s*[0-9]{3}-?[0-9]{3}\s*"
              title="Enter your 6-digit verification code. If you did not receive a code, click Call or Send SMS to request a new one"
              placeholder="Verification Code"
              autoComplete="off"
              value={code}
              onChange={onChangeCode}
            />
            <div>{error}</div>
            <div>{status}</div>
          </div>
          <div className="nav">
            <button
              type="button"
              className="button"
              disabled={!isValidNumber || !isValidCode}
              onClick={onVerifyCode}
            >
              Register
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
