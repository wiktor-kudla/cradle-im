// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { noop } from 'lodash';
import React from 'react';
import type { LocalizerType } from '../types/I18N';
import type { EmojiPickDataType } from './emoji/EmojiPicker';
import { shouldNeverBeCalled } from '../util/shouldNeverBeCalled';
import type { InputApi } from './CompositionInput';
import { CompositionInput } from './CompositionInput';
import { EmojiButton } from './emoji/EmojiButton';
import type {
  DraftBodyRanges,
  HydratedBodyRangesType,
} from '../types/BodyRange';
import type { ThemeType } from '../types/Util';
import type { Props as EmojiButtonProps } from './emoji/EmojiButton';
import type { PreferredBadgeSelectorType } from '../state/selectors/badges';
import * as grapheme from '../util/grapheme';

export type CompositionTextAreaProps = {
  bodyRanges?: HydratedBodyRangesType;
  i18n: LocalizerType;
  isFormattingEnabled: boolean;
  maxLength?: number;
  placeholder?: string;
  whenToShowRemainingCount?: number;
  scrollerRef?: React.RefObject<HTMLDivElement>;
  onScroll?: (ev: React.UIEvent<HTMLElement, UIEvent>) => void;
  onPickEmoji: (e: EmojiPickDataType) => void;
  onChange: (
    messageText: string,
    draftBodyRanges: HydratedBodyRangesType,
    caretLocation?: number | undefined
  ) => void;
  onSetSkinTone: (tone: number) => void;
  onSubmit: (
    message: string,
    draftBodyRanges: DraftBodyRanges,
    timestamp: number
  ) => void;
  onTextTooLong: () => void;
  platform: string;
  getPreferredBadge: PreferredBadgeSelectorType;
  draftText: string;
  theme: ThemeType;
} & Pick<EmojiButtonProps, 'recentEmojis' | 'skinTone'>;

/**
 * Essentially an HTML textarea but with support for emoji picker and
 * at-mentions autocomplete.
 *
 * Meant for modals that need to collect a message or caption. It is
 * basically a rectangle input with an emoji selector floating at the top-right
 */
export function CompositionTextArea({
  bodyRanges,
  draftText,
  getPreferredBadge,
  i18n,
  isFormattingEnabled,
  maxLength,
  onChange,
  onPickEmoji,
  onScroll,
  onSetSkinTone,
  onSubmit,
  onTextTooLong,
  placeholder,
  platform,
  recentEmojis,
  scrollerRef,
  skinTone,
  theme,
  whenToShowRemainingCount = Infinity,
}: CompositionTextAreaProps): JSX.Element {
  const inputApiRef = React.useRef<InputApi | undefined>();
  const [characterCount, setCharacterCount] = React.useState(
    grapheme.count(draftText)
  );

  const insertEmoji = React.useCallback(
    (e: EmojiPickDataType) => {
      if (inputApiRef.current) {
        inputApiRef.current.insertEmoji(e);
        onPickEmoji(e);
      }
    },
    [inputApiRef, onPickEmoji]
  );

  const focusTextEditInput = React.useCallback(() => {
    if (inputApiRef.current) {
      inputApiRef.current.focus();
    }
  }, [inputApiRef]);

  const handleChange = React.useCallback(
    ({
      bodyRanges: updatedBodyRanges,
      caretLocation,
      messageText: newValue,
    }) => {
      const inputEl = inputApiRef.current;
      if (!inputEl) {
        return;
      }

      const [newValueSized, newCharacterCount] = grapheme.truncateAndSize(
        newValue,
        maxLength
      );

      if (maxLength !== undefined) {
        // if we had to truncate
        if (newValueSized.length < newValue.length) {
          // reset quill to the value before the change that pushed it over the max
          // and push the cursor to the end
          //
          // this is not perfect as it pushes the cursor to the end, even if the user
          // was modifying text in the middle of the editor
          // a better solution would be to prevent the change to begin with, but
          // quill makes this VERY difficult
          inputEl.setContents(newValueSized, updatedBodyRanges, true);
        }
      }
      setCharacterCount(newCharacterCount);
      onChange(newValue, updatedBodyRanges, caretLocation);
    },
    [maxLength, onChange]
  );

  return (
    <div className="CompositionTextArea">
      <CompositionInput
        clearQuotedMessage={shouldNeverBeCalled}
        draftBodyRanges={bodyRanges}
        draftText={draftText}
        getPreferredBadge={getPreferredBadge}
        getQuotedMessage={noop}
        i18n={i18n}
        isFormattingEnabled={isFormattingEnabled}
        inputApi={inputApiRef}
        large
        moduleClassName="CompositionTextArea__input"
        onEditorStateChange={handleChange}
        onPickEmoji={onPickEmoji}
        onScroll={onScroll}
        onSubmit={onSubmit}
        onTextTooLong={onTextTooLong}
        placeholder={placeholder}
        platform={platform}
        scrollerRef={scrollerRef}
        sendCounter={0}
        theme={theme}
      />
      <div className="CompositionTextArea__emoji">
        <EmojiButton
          i18n={i18n}
          onClose={focusTextEditInput}
          onPickEmoji={insertEmoji}
          onSetSkinTone={onSetSkinTone}
          recentEmojis={recentEmojis}
          skinTone={skinTone}
        />
      </div>
      {maxLength !== undefined &&
        characterCount >= whenToShowRemainingCount && (
          <div className="CompositionTextArea__remaining-character-count">
            {maxLength - characterCount}
          </div>
        )}
    </div>
  );
}
