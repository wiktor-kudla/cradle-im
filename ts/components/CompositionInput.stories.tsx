// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as React from 'react';
import 'react-quill/dist/quill.core.css';
import { action } from '@storybook/addon-actions';
import type { Meta } from '@storybook/react';
import { getDefaultConversation } from '../test-both/helpers/getDefaultConversation';
import type { Props } from './CompositionInput';
import { CompositionInput } from './CompositionInput';
import { setupI18n } from '../util/setupI18n';
import { generateAci } from '../types/ServiceId';
import enMessages from '../../_locales/en/messages.json';
import { StorybookThemeContext } from '../../.storybook/StorybookThemeContext';

const i18n = setupI18n('en', enMessages);

export default {
  title: 'Components/CompositionInput',
  argTypes: {},
  args: {},
} satisfies Meta<Props>;

const useProps = (overrideProps: Partial<Props> = {}): Props => ({
  i18n,
  disabled: overrideProps.disabled ?? false,
  draftText: overrideProps.draftText || undefined,
  draftBodyRanges: overrideProps.draftBodyRanges || [],
  clearQuotedMessage: action('clearQuotedMessage'),
  getPreferredBadge: () => undefined,
  getQuotedMessage: action('getQuotedMessage'),
  isFormattingEnabled:
    overrideProps.isFormattingEnabled === false
      ? overrideProps.isFormattingEnabled
      : true,
  large: overrideProps.large ?? false,
  onCloseLinkPreview: action('onCloseLinkPreview'),
  onEditorStateChange: action('onEditorStateChange'),
  onPickEmoji: action('onPickEmoji'),
  onSubmit: action('onSubmit'),
  onTextTooLong: action('onTextTooLong'),
  platform: 'darwin',
  sendCounter: 0,
  sortedGroupMembers: overrideProps.sortedGroupMembers ?? [],
  skinTone: overrideProps.skinTone ?? undefined,
  theme: React.useContext(StorybookThemeContext),
});

export function Default(): JSX.Element {
  const props = useProps();

  return <CompositionInput {...props} />;
}

export function Large(): JSX.Element {
  const props = useProps({
    large: true,
  });

  return <CompositionInput {...props} />;
}

export function Disabled(): JSX.Element {
  const props = useProps({
    disabled: true,
  });

  return <CompositionInput {...props} />;
}

export function StartingText(): JSX.Element {
  const props = useProps({
    draftText: "here's some starting text",
  });

  return <CompositionInput {...props} />;
}

export function MultilineText(): JSX.Element {
  const props = useProps({
    draftText: `here's some starting text
and more on another line
and yet another line
and yet another line
and yet another line
and yet another line
and yet another line
and yet another line
and we're done`,
  });

  return <CompositionInput {...props} />;
}

export function Emojis(): JSX.Element {
  const props = useProps({
    draftText: `⁣😐😐😐😐😐😐😐
😐😐😐😐😐😐😐
😐😐😐😂⁣😐😐😐
😐😐😐😐😐😐😐
😐😐😐😐😐😐😐`,
  });

  return <CompositionInput {...props} />;
}

export function Mentions(): JSX.Element {
  const props = useProps({
    sortedGroupMembers: [
      getDefaultConversation({
        title: 'Kate Beaton',
      }),
      getDefaultConversation({
        title: 'Parry Gripp',
      }),
    ],
    draftText: 'send _ a message',
    draftBodyRanges: [
      {
        start: 5,
        length: 1,
        mentionAci: generateAci(),
        conversationID: 'k',
        replacementText: 'Kate Beaton',
      },
    ],
  });

  return <CompositionInput {...props} />;
}

export function NoFormattingMenu(): JSX.Element {
  return <CompositionInput {...useProps({ isFormattingEnabled: false })} />;
}
