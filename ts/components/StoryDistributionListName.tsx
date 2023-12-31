// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';

import type { LocalizerType } from '../types/Util';
import { getStoryDistributionListName } from '../types/Stories';
import type { StoryDistributionIdString } from '../types/StoryDistributionId';
import { UserText } from './UserText';

type PropsType = {
  i18n: LocalizerType;
  id: StoryDistributionIdString | string;
  name: string;
};

export function StoryDistributionListName({
  i18n,
  id,
  name,
}: PropsType): JSX.Element {
  return <UserText text={getStoryDistributionListName(i18n, id, name)} />;
}
