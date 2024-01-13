// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as React from 'react';
import { action } from '@storybook/addon-actions';
import type { Meta } from '@storybook/react';
import { setupI18n } from '../../util/setupI18n';
import enMessages from '../../../_locales/en/messages.json';
import type { Props } from './EmojiPicker';
import { EmojiPicker } from './EmojiPicker';

const i18n = setupI18n('en', enMessages);

export default {
  title: 'Components/Emoji/EmojiPicker',
} satisfies Meta<Props>;

export function Base(): JSX.Element {
  return (
    <EmojiPicker
      i18n={i18n}
      onPickEmoji={action('onPickEmoji')}
      onSetSkinTone={action('onSetSkinTone')}
      onClose={action('onClose')}
      skinTone={0}
      recentEmojis={[
        'grinning',
        'grin',
        'joy',
        'rolling_on_the_floor_laughing',
        'smiley',
        'smile',
        'sweat_smile',
        'laughing',
        'wink',
        'blush',
        'yum',
        'sunglasses',
        'heart_eyes',
        'kissing_heart',
        'kissing',
        'kissing_smiling_eyes',
        'kissing_closed_eyes',
        'relaxed',
        'slightly_smiling_face',
        'hugging_face',
        'grinning_face_with_star_eyes',
        'thinking_face',
        'face_with_one_eyebrow_raised',
        'neutral_face',
        'expressionless',
        'no_mouth',
        'face_with_rolling_eyes',
        'smirk',
        'persevere',
        'disappointed_relieved',
        'open_mouth',
        'zipper_mouth_face',
      ]}
    />
  );
}

export function NoRecents(): JSX.Element {
  return (
    <EmojiPicker
      i18n={i18n}
      onPickEmoji={action('onPickEmoji')}
      onSetSkinTone={action('onSetSkinTone')}
      onClose={action('onClose')}
      skinTone={0}
      recentEmojis={[]}
    />
  );
}

export function WithSettingsButton(): JSX.Element {
  return (
    <EmojiPicker
      i18n={i18n}
      onPickEmoji={action('onPickEmoji')}
      onSetSkinTone={action('onSetSkinTone')}
      onClickSettings={action('onClickSettings')}
      onClose={action('onClose')}
      skinTone={0}
      recentEmojis={[]}
    />
  );
}
