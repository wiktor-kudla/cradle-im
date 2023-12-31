// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { noop } from 'lodash';
import { Button } from './Button';
import { Modal } from './Modal';
import type { LocalizerType, ThemeType } from '../types/Util';
import type { SmartCompositionTextAreaProps } from '../state/smart/CompositionTextArea';
import type { HydratedBodyRangesType } from '../types/BodyRange';
import { isScrolled, isScrolledToBottom } from '../hooks/useSizeObserver';

export type Props = {
  i18n: LocalizerType;
  onClose: () => void;
  onSubmit: (
    text: string,
    bodyRanges: HydratedBodyRangesType | undefined
  ) => void;
  draftText: string;
  draftBodyRanges: HydratedBodyRangesType | undefined;
  theme: ThemeType;
  RenderCompositionTextArea: (
    props: SmartCompositionTextAreaProps
  ) => JSX.Element;
};

export function AddCaptionModal({
  i18n,
  onClose,
  onSubmit,
  draftText,
  draftBodyRanges,
  RenderCompositionTextArea,
  theme,
}: Props): JSX.Element {
  const [messageText, setMessageText] = React.useState('');
  const [bodyRanges, setBodyRanges] = React.useState<
    HydratedBodyRangesType | undefined
  >();

  const [scrolled, setScrolled] = React.useState(false);
  // We don't know that this is true, but it most likely is
  const [scrolledToBottom, setScrolledToBottom] = React.useState(true);

  const scrollerRef = React.useRef<HTMLDivElement>(null);

  // add footer/header dividers depending on the state of scroll
  const updateScrollState = React.useCallback(() => {
    const scrollerEl = scrollerRef.current;
    if (scrollerEl) {
      setScrolled(isScrolled(scrollerEl));
      setScrolledToBottom(isScrolledToBottom(scrollerEl));
    }
  }, []);

  const handleSubmit = React.useCallback(() => {
    onSubmit(messageText, bodyRanges);
  }, [bodyRanges, messageText, onSubmit]);

  return (
    <Modal
      i18n={i18n}
      modalName="AddCaptionModal"
      hasXButton
      hasHeaderDivider={scrolled}
      hasFooterDivider={!scrolledToBottom}
      moduleClassName="AddCaptionModal"
      padded={false}
      title={i18n('icu:AddCaptionModal__title')}
      onClose={onClose}
      modalFooter={
        <Button onClick={handleSubmit}>
          {i18n('icu:AddCaptionModal__submit-button')}
        </Button>
      }
    >
      <RenderCompositionTextArea
        maxLength={1500}
        whenToShowRemainingCount={1450}
        placeholder={i18n('icu:AddCaptionModal__placeholder')}
        onChange={(updatedMessageText, updatedBodyRanges) => {
          setMessageText(updatedMessageText);
          setBodyRanges(updatedBodyRanges);
        }}
        scrollerRef={scrollerRef}
        draftText={draftText}
        bodyRanges={draftBodyRanges}
        onSubmit={noop}
        onScroll={updateScrollState}
        theme={theme}
      />
    </Modal>
  );
}
