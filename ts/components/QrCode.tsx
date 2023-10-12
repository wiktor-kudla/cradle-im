// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactElement } from 'react';
import React, { useMemo, useRef } from 'react';
import qrcode from 'qrcode-generator';

const electron = require('electron')

const AUTODETECT_TYPE_NUMBER = 0;
const ERROR_CORRECTION_LEVEL = 'L';

type PropsType = Readonly<{
  alt: string;
  className?: string;
  data: string;
}>;

export function QrCode(props: PropsType): ReactElement {
  const { alt, className, data } = props;

  const elRef = useRef<null | HTMLImageElement>(null);

  const src = useMemo(() => {
    const qrCode = qrcode(AUTODETECT_TYPE_NUMBER, ERROR_CORRECTION_LEVEL);
    qrCode.addData(data);
    qrCode.make();

    const svgData = qrCode.createSvgTag({ cellSize: 1, margin: 0 });
    return `data:image/svg+xml;utf8,${svgData}`;
  }, [data]);

  // Add a development-only feature to copy a QR code to the clipboard by double-clicking.
  // This can be used to quickly inspect the code, or to link this Desktop with an iOS
  // simulator primary, which has a debug-only option to paste the linking URL instead of
  // scanning it. (By the time you read this comment Android may have a similar feature.)
  const onMouseDown = () => {
  
	electron.clipboard.writeText(data);

    const el = elRef.current;
    if (!el) {
      return;
    }
    el.style.filter = 'brightness(50%)';
    window.setTimeout(() => {
      el.style.filter = '';
    }, 150);
  };

  return (
    <img
      alt={alt}
      className={className}
      onMouseDown={onMouseDown}
      ref={elRef}
      src={src}
    />
  );
}
