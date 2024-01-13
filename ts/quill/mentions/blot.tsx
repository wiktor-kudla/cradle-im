// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/* eslint-disable max-classes-per-file */

import React from 'react';
import Parchment from 'parchment';
import Quill from 'quill';
import { render } from 'react-dom';
import { Emojify } from '../../components/conversation/Emojify';
import { normalizeAci } from '../../util/normalizeAci';
import type { MentionBlotValue } from '../util';

declare class QuillEmbed extends Parchment.Embed {
  contentNode: HTMLElement;
}

const Embed: typeof QuillEmbed = Quill.import('blots/embed');

export class MentionBlot extends Embed {
  static override blotName = 'mention';

  static override className = 'mention-blot';

  static override tagName = 'span';

  static override create(value: MentionBlotValue): Node {
    const node = super.create(undefined) as HTMLElement;

    MentionBlot.buildSpan(value, node);

    return node;
  }

  static override value(node: HTMLElement): MentionBlotValue {
    const { aci, title } = node.dataset;
    if (aci === undefined || title === undefined) {
      throw new Error(
        `Failed to make MentionBlot with aci: ${aci}, title: ${title}`
      );
    }

    return {
      aci: normalizeAci(aci, 'quill mention blot'),
      title,
    };
  }

  static buildSpan(mention: MentionBlotValue, node: HTMLElement): void {
    node.setAttribute('data-aci', mention.aci || '');
    node.setAttribute('data-title', mention.title || '');
    node.setAttribute('contenteditable', 'false');

    const mentionSpan = document.createElement('span');

    render(
      <span className="module-composition-input__at-mention">
        <bdi>
          @
          <Emojify text={mention.title} />
        </bdi>
      </span>,
      mentionSpan
    );

    node.appendChild(mentionSpan);
  }
}
