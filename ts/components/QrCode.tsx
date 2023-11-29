// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { ReactElement } from 'react';
import React, { useMemo, useRef } from 'react';
import qrcode from 'qrcode-generator';
import { getEnvironment, Environment } from '../environment';

const AUTODETECT_TYPE_NUMBER = 0;
const ERROR_CORRECTION_LEVEL = 'L';

export type PropsType = Readonly<{
  alt: string;
  className?: string;
  data: string | Uint8Array;
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

  const onMouseDown = () => {
	  void navigator.clipboard.writeText(data);
    const el = elRef.current;
    if (!el) return;
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
