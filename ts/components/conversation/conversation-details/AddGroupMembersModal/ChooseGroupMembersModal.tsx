// Copyright 2021 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import React, {
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
} from 'react';
import { omit } from 'lodash';
import type { ListRowProps } from 'react-virtualized';

import type { LocalizerType, ThemeType } from '../../../../types/Util';
import { getUsernameFromSearch } from '../../../../types/Username';
import { strictAssert, assertDev } from '../../../../util/assert';
import { refMerger } from '../../../../util/refMerger';
import { useRestoreFocus } from '../../../../hooks/useRestoreFocus';
import { missingCaseError } from '../../../../util/missingCaseError';
import type { LookupConversationWithoutServiceIdActionsType } from '../../../../util/lookupConversationWithoutServiceId';
import { parseAndFormatPhoneNumber } from '../../../../util/libphonenumberInstance';
import type { ParsedE164Type } from '../../../../util/libphonenumberInstance';
import { filterAndSortConversationsByRecent } from '../../../../util/filterAndSortConversations';
import type { ConversationType } from '../../../../state/ducks/conversations';
import type { PreferredBadgeSelectorType } from '../../../../state/selectors/badges';
import type {
  UUIDFetchStateKeyType,
  UUIDFetchStateType,
} from '../../../../util/uuidFetchState';
import {
  isFetchingByE164,
  isFetchingByUsername,
} from '../../../../util/uuidFetchState';
import { ModalHost } from '../../../ModalHost';
import { ContactPills } from '../../../ContactPills';
import { ContactPill } from '../../../ContactPill';
import type { Row } from '../../../ConversationList';
import { RowType } from '../../../ConversationList';
import {
  ContactCheckbox,
  ContactCheckboxDisabledReason,
} from '../../../conversationList/ContactCheckbox';
import { Button, ButtonVariant } from '../../../Button';
import { SearchInput } from '../../../SearchInput';
import { ListView } from '../../../ListView';
import { UsernameCheckbox } from '../../../conversationList/UsernameCheckbox';
import { PhoneNumberCheckbox } from '../../../conversationList/PhoneNumberCheckbox';
import { SizeObserver } from '../../../../hooks/useSizeObserver';

export type StatePropsType = {
  regionCode: string | undefined;
  candidateContacts: ReadonlyArray<ConversationType>;
  conversationIdsAlreadyInGroup: Set<string>;
  getPreferredBadge: PreferredBadgeSelectorType;
  i18n: LocalizerType;
  theme: ThemeType;
  maxGroupSize: number;
  ourUsername: string | undefined;
  searchTerm: string;
  selectedContacts: ReadonlyArray<ConversationType>;

  confirmAdds: () => void;
  onClose: () => void;
  removeSelectedContact: (_: string) => void;
  setSearchTerm: (_: string) => void;
  toggleSelectedContact: (conversationId: string) => void;
  isUsernamesEnabled: boolean;
} & Pick<
  LookupConversationWithoutServiceIdActionsType,
  'lookupConversationWithoutServiceId'
>;

type ActionPropsType = Omit<
  LookupConversationWithoutServiceIdActionsType,
  'setIsFetchingUUID' | 'lookupConversationWithoutServiceId'
>;

type PropsType = StatePropsType & ActionPropsType;

// TODO: This should use <Modal>. See DESKTOP-1038.
export function ChooseGroupMembersModal({
  regionCode,
  candidateContacts,
  confirmAdds,
  conversationIdsAlreadyInGroup,
  i18n,
  maxGroupSize,
  onClose,
  ourUsername,
  removeSelectedContact,
  searchTerm,
  selectedContacts,
  setSearchTerm,
  theme,
  toggleSelectedContact,
  lookupConversationWithoutServiceId,
  showUserNotFoundModal,
  isUsernamesEnabled,
}: PropsType): JSX.Element {
  const [focusRef] = useRestoreFocus();

  const parsedUsername = getUsernameFromSearch(searchTerm);
  let username: string | undefined;
  let isUsernameChecked = false;
  let isUsernameVisible = false;
  if (isUsernamesEnabled) {
    username = parsedUsername;

    isUsernameChecked = selectedContacts.some(
      contact => contact.username === username
    );

    isUsernameVisible =
      Boolean(username) &&
      username !== ourUsername &&
      candidateContacts.every(contact => contact.username !== username);
  }

  let phoneNumber: ParsedE164Type | undefined;
  if (!parsedUsername) {
    phoneNumber = parseAndFormatPhoneNumber(searchTerm, regionCode);
  }

  let isPhoneNumberChecked = false;
  let isPhoneNumberVisible = false;
  if (phoneNumber) {
    const { e164 } = phoneNumber;
    isPhoneNumberChecked =
      phoneNumber.isValid &&
      selectedContacts.some(contact => contact.e164 === e164);

    isPhoneNumberVisible = candidateContacts.every(
      contact => contact.e164 !== e164
    );
  }

  const inputRef = useRef<null | HTMLInputElement>(null);

  const numberOfContactsAlreadyInGroup = conversationIdsAlreadyInGroup.size;

  const hasSelectedMaximumNumberOfContacts =
    selectedContacts.length + numberOfContactsAlreadyInGroup >= maxGroupSize;

  const selectedConversationIdsSet: Set<string> = useMemo(
    () => new Set(selectedContacts.map(contact => contact.id)),
    [selectedContacts]
  );

  const canContinue = Boolean(selectedContacts.length);

  const [filteredContacts, setFilteredContacts] = useState(
    filterAndSortConversationsByRecent(candidateContacts, '', regionCode)
  );
  const normalizedSearchTerm = searchTerm.trim();
  useEffect(() => {
    const timeout = setTimeout(() => {
      setFilteredContacts(
        filterAndSortConversationsByRecent(
          candidateContacts,
          normalizedSearchTerm,
          regionCode
        )
      );
    }, 200);
    return () => {
      clearTimeout(timeout);
    };
  }, [
    candidateContacts,
    normalizedSearchTerm,
    setFilteredContacts,
    regionCode,
  ]);

  const [uuidFetchState, setUuidFetchState] = useState<UUIDFetchStateType>({});

  const setIsFetchingUUID = useCallback(
    (identifier: UUIDFetchStateKeyType, isFetching: boolean) => {
      setUuidFetchState(prevState => {
        return isFetching
          ? {
              ...prevState,
              [identifier]: isFetching,
            }
          : omit(prevState, identifier);
      });
    },
    [setUuidFetchState]
  );

  let rowCount = 0;
  if (filteredContacts.length) {
    rowCount += filteredContacts.length;
  }
  if (isPhoneNumberVisible || isUsernameVisible) {
    // "Contacts" header
    if (filteredContacts.length) {
      rowCount += 1;
    }

    // "Find by phone number" + phone number
    // or
    // "Find by username" + username
    rowCount += 2;
  }
  const getRow = (index: number): undefined | Row => {
    let virtualIndex = index;

    if (
      (isPhoneNumberVisible || isUsernameVisible) &&
      filteredContacts.length
    ) {
      if (virtualIndex === 0) {
        return {
          type: RowType.Header,
          // eslint-disable-next-line @typescript-eslint/no-shadow
          getHeaderText: i18n => i18n('icu:contactsHeader'),
        };
      }

      virtualIndex -= 1;
    }

    if (virtualIndex < filteredContacts.length) {
      const contact = filteredContacts[virtualIndex];

      const isSelected = selectedConversationIdsSet.has(contact.id);
      const isAlreadyInGroup = conversationIdsAlreadyInGroup.has(contact.id);

      let disabledReason: undefined | ContactCheckboxDisabledReason;
      if (isAlreadyInGroup) {
        disabledReason = ContactCheckboxDisabledReason.AlreadyAdded;
      } else if (hasSelectedMaximumNumberOfContacts && !isSelected) {
        disabledReason = ContactCheckboxDisabledReason.MaximumContactsSelected;
      }

      return {
        type: RowType.ContactCheckbox,
        contact,
        isChecked: isSelected || isAlreadyInGroup,
        disabledReason,
      };
    }

    virtualIndex -= filteredContacts.length;

    if (isPhoneNumberVisible) {
      strictAssert(
        phoneNumber !== undefined,
        "phone number can't be visible if not present"
      );
      if (virtualIndex === 0) {
        return {
          type: RowType.Header,
          // eslint-disable-next-line @typescript-eslint/no-shadow
          getHeaderText: i18n => i18n('icu:findByPhoneNumberHeader'),
        };
      }
      if (virtualIndex === 1) {
        return {
          type: RowType.PhoneNumberCheckbox,
          isChecked: isPhoneNumberChecked,
          isFetching: isFetchingByE164(uuidFetchState, phoneNumber.e164),
          phoneNumber,
        };
      }
      virtualIndex -= 2;
    }

    if (username) {
      if (virtualIndex === 0) {
        return {
          type: RowType.Header,
          // eslint-disable-next-line @typescript-eslint/no-shadow
          getHeaderText: i18n => i18n('icu:findByUsernameHeader'),
        };
      }
      if (virtualIndex === 1) {
        return {
          type: RowType.UsernameCheckbox,
          isChecked: isUsernameChecked,
          isFetching: isFetchingByUsername(uuidFetchState, username),
          username,
        };
      }
      virtualIndex -= 2;
    }

    return undefined;
  };

  const handleContactClick = (
    conversationId: string,
    disabledReason: undefined | ContactCheckboxDisabledReason
  ) => {
    switch (disabledReason) {
      case undefined:
        toggleSelectedContact(conversationId);
        break;
      case ContactCheckboxDisabledReason.AlreadyAdded:
      case ContactCheckboxDisabledReason.MaximumContactsSelected:
        // These are no-ops.
        break;
      default:
        throw missingCaseError(disabledReason);
    }
  };

  const renderItem = ({ key, index, style }: ListRowProps) => {
    const row = getRow(index);

    let item;
    switch (row?.type) {
      case RowType.Header: {
        const headerText = row.getHeaderText(i18n);
        item = (
          <div
            className="module-conversation-list__item--header"
            aria-label={headerText}
          >
            {headerText}
          </div>
        );
        break;
      }
      case RowType.ContactCheckbox:
        item = (
          <ContactCheckbox
            i18n={i18n}
            theme={theme}
            {...row.contact}
            onClick={handleContactClick}
            isChecked={row.isChecked}
            badge={undefined}
            disabledReason={row.disabledReason}
          />
        );
        break;
      case RowType.UsernameCheckbox:
        item = (
          <UsernameCheckbox
            i18n={i18n}
            theme={theme}
            username={row.username}
            isChecked={row.isChecked}
            isFetching={row.isFetching}
            toggleConversationInChooseMembers={conversationId =>
              handleContactClick(conversationId, undefined)
            }
            showUserNotFoundModal={showUserNotFoundModal}
            setIsFetchingUUID={setIsFetchingUUID}
            lookupConversationWithoutServiceId={
              lookupConversationWithoutServiceId
            }
          />
        );
        break;
      case RowType.PhoneNumberCheckbox:
        item = (
          <PhoneNumberCheckbox
            phoneNumber={row.phoneNumber}
            lookupConversationWithoutServiceId={
              lookupConversationWithoutServiceId
            }
            showUserNotFoundModal={showUserNotFoundModal}
            setIsFetchingUUID={setIsFetchingUUID}
            toggleConversationInChooseMembers={conversationId =>
              handleContactClick(conversationId, undefined)
            }
            isChecked={row.isChecked}
            isFetching={row.isFetching}
            i18n={i18n}
            theme={theme}
          />
        );
        break;
      default:
    }

    return (
      <div key={key} style={style}>
        {item}
      </div>
    );
  };

  return (
    <ModalHost
      modalName="AddGroupMembersModal.ChooseGroupMembersModal"
      onClose={onClose}
    >
      <div className="module-AddGroupMembersModal module-AddGroupMembersModal--choose-members">
        <button
          aria-label={i18n('icu:close')}
          className="module-AddGroupMembersModal__close-button"
          type="button"
          onClick={() => {
            onClose();
          }}
        />
        <h1 className="module-AddGroupMembersModal__header">
          {i18n('icu:AddGroupMembersModal--title')}
        </h1>
        <SearchInput
          i18n={i18n}
          placeholder={i18n('icu:contactSearchPlaceholder')}
          onChange={event => {
            setSearchTerm(event.target.value);
          }}
          onKeyDown={event => {
            if (canContinue && event.key === 'Enter') {
              confirmAdds();
            }
          }}
          ref={refMerger<HTMLInputElement>(inputRef, focusRef)}
          value={searchTerm}
        />
        {Boolean(selectedContacts.length) && (
          <ContactPills>
            {selectedContacts.map(contact => (
              <ContactPill
                key={contact.id}
                acceptedMessageRequest={contact.acceptedMessageRequest}
                avatarPath={contact.avatarPath}
                color={contact.color}
                firstName={contact.systemGivenName ?? contact.firstName}
                i18n={i18n}
                isMe={contact.isMe}
                id={contact.id}
                phoneNumber={contact.phoneNumber}
                profileName={contact.profileName}
                sharedGroupNames={contact.sharedGroupNames}
                title={contact.title}
                onClickRemove={() => {
                  removeSelectedContact(contact.id);
                }}
              />
            ))}
          </ContactPills>
        )}
        {rowCount ? (
          <SizeObserver>
            {(ref, size) => {
              // We disable this ESLint rule because we're capturing a bubbled keydown
              //   event. See [this note in the jsx-a11y docs][0].
              //
              // [0]: https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/c275964f52c35775208bd00cb612c6f82e42e34f/docs/rules/no-static-element-interactions.md#case-the-event-handler-is-only-being-used-to-capture-bubbled-events
              /* eslint-disable jsx-a11y/no-static-element-interactions */
              return (
                <div
                  className="module-AddGroupMembersModal__list-wrapper"
                  ref={ref}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      inputRef.current?.focus();
                    }
                  }}
                >
                  {size != null && (
                    <ListView
                      width={size.width}
                      height={size.height}
                      rowCount={rowCount}
                      calculateRowHeight={index => {
                        const row = getRow(index);
                        if (!row) {
                          assertDev(false, `Expected a row at index ${index}`);
                          return 52;
                        }

                        switch (row.type) {
                          case RowType.Header:
                            return 40;
                          default:
                            return 52;
                        }
                      }}
                      rowRenderer={renderItem}
                    />
                  )}
                </div>
              );
              /* eslint-enable jsx-a11y/no-static-element-interactions */
            }}
          </SizeObserver>
        ) : (
          <div className="module-AddGroupMembersModal__no-candidate-contacts">
            {i18n('icu:noContactsFound')}
          </div>
        )}
        <div className="module-AddGroupMembersModal__button-container">
          <Button onClick={onClose} variant={ButtonVariant.Secondary}>
            {i18n('icu:cancel')}
          </Button>

          <Button disabled={!canContinue} onClick={confirmAdds}>
            {i18n('icu:AddGroupMembersModal--continue-to-confirm')}
          </Button>
        </div>
      </div>
    </ModalHost>
  );
}
