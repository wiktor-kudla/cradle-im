// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as React from 'react';
import { action } from '@storybook/addon-actions';
import type { Meta } from '@storybook/react';
import { pngUrl } from '../../storybook/Fixtures';
import type { Props } from './Image';
import { CurveType, Image } from './Image';
import { IMAGE_PNG } from '../../types/MIME';
import type { ThemeType } from '../../types/Util';
import { setupI18n } from '../../util/setupI18n';
import enMessages from '../../../_locales/en/messages.json';
import { StorybookThemeContext } from '../../../.storybook/StorybookThemeContext';

import { fakeAttachment } from '../../test-both/helpers/fakeAttachment';

const i18n = setupI18n('en', enMessages);

export default {
  title: 'Components/Conversation/Image',
} satisfies Meta<Props>;

const createProps = (overrideProps: Partial<Props> = {}): Props => ({
  alt: overrideProps.alt || '',
  attachment:
    overrideProps.attachment ||
    fakeAttachment({
      contentType: IMAGE_PNG,
      fileName: 'sax.png',
      url: pngUrl,
    }),
  blurHash: overrideProps.blurHash || '',
  bottomOverlay: overrideProps.bottomOverlay || false,
  closeButton: overrideProps.closeButton || false,
  curveBottomLeft: overrideProps.curveBottomLeft || CurveType.None,
  curveBottomRight: overrideProps.curveBottomRight || CurveType.None,
  curveTopLeft: overrideProps.curveTopLeft || CurveType.None,
  curveTopRight: overrideProps.curveTopRight || CurveType.None,
  darkOverlay: overrideProps.darkOverlay || false,
  height: overrideProps.height || 100,
  i18n,
  noBackground: overrideProps.noBackground || false,
  noBorder: overrideProps.noBorder || false,
  onClick: action('onClick'),
  onClickClose: action('onClickClose'),
  onError: action('onError'),
  overlayText: overrideProps.overlayText || '',
  playIconOverlay: overrideProps.playIconOverlay || false,
  tabIndex: overrideProps.tabIndex || 0,
  theme: overrideProps.theme || ('light' as ThemeType),
  url: 'url' in overrideProps ? overrideProps.url || '' : pngUrl,
  width: overrideProps.width || 100,
});

export function UrlWithHeightWidth(): JSX.Element {
  const props = createProps();

  return <Image {...props} />;
}

export function Caption(): JSX.Element {
  const defaultProps = createProps();
  const props = {
    ...defaultProps,
    attachment: {
      ...defaultProps.attachment,
      caption: '<Saxophone Pun>',
    },
  };

  return <Image {...props} />;
}

export function PlayIcon(): JSX.Element {
  const props = createProps({
    playIconOverlay: true,
  });

  return <Image {...props} />;
}

export function CloseButton(): JSX.Element {
  const props = createProps({
    closeButton: true,
  });

  return <Image {...props} />;
}

export function NoBorderOrBackground(): JSX.Element {
  const props = createProps({
    attachment: fakeAttachment({
      contentType: IMAGE_PNG,
      fileName: 'sax.png',
      url: pngUrl,
    }),
    noBackground: true,
    noBorder: true,
    url: pngUrl,
  });

  return (
    <div style={{ backgroundColor: '#999' }}>
      <Image {...props} />
    </div>
  );
}

export function Pending(): JSX.Element {
  const props = createProps({
    attachment: fakeAttachment({
      contentType: IMAGE_PNG,
      fileName: 'sax.png',
      url: pngUrl,
      pending: true,
    }),
  });

  return <Image {...props} />;
}

export function PendingWBlurhash(): JSX.Element {
  const props = createProps({
    attachment: fakeAttachment({
      contentType: IMAGE_PNG,
      fileName: 'sax.png',
      url: pngUrl,
      pending: true,
    }),
  });

  return (
    <Image
      {...props}
      blurHash="LDA,FDBnm+I=p{tkIUI;~UkpELV]"
      width={300}
      height={400}
    />
  );
}

export function CurvedCorners(): JSX.Element {
  const props = createProps({
    curveBottomLeft: CurveType.Normal,
    curveBottomRight: CurveType.Normal,
    curveTopLeft: CurveType.Normal,
    curveTopRight: CurveType.Normal,
  });

  return <Image {...props} />;
}

export function SmallCurveTopLeft(): JSX.Element {
  const props = createProps({
    curveTopLeft: CurveType.Small,
  });

  return <Image {...props} />;
}

export function SoftCorners(): JSX.Element {
  const props = createProps({
    curveBottomLeft: CurveType.Tiny,
    curveBottomRight: CurveType.Tiny,
    curveTopLeft: CurveType.Tiny,
    curveTopRight: CurveType.Tiny,
  });

  return <Image {...props} />;
}

export function BottomOverlay(): JSX.Element {
  const props = createProps({
    bottomOverlay: true,
  });

  return <Image {...props} />;
}

export function FullOverlayWithText(): JSX.Element {
  const props = createProps({
    darkOverlay: true,
    overlayText: 'Honk!',
  });

  return <Image {...props} />;
}

export function Blurhash(): JSX.Element {
  const defaultProps = createProps();
  const props = {
    ...defaultProps,
    blurHash: 'thisisafakeblurhashthatwasmadeup',
  };

  return <Image {...props} />;
}

function UndefinedBlurHashWrapper() {
  const theme = React.useContext(StorybookThemeContext);
  const props = createProps({
    blurHash: undefined,
    theme,
    url: undefined,
  });

  return <Image {...props} />;
}

export function UndefinedBlurHash(): JSX.Element {
  return <UndefinedBlurHashWrapper />;
}

export function MissingImage(): JSX.Element {
  const defaultProps = createProps();
  const props = {
    ...defaultProps,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attachment: undefined as any,
  };

  return <Image {...props} />;
}
