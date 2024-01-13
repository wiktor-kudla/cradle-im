// Copyright 2022 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { ServiceIdKind, Proto, StorageState } from '@signalapp/mock-server';
import type { PrimaryDevice } from '@signalapp/mock-server';
import createDebug from 'debug';
import Long from 'long';

import * as durations from '../../util/durations';
import { uuidToBytes } from '../../util/uuidToBytes';
import { toUntaggedPni } from '../../types/ServiceId';
import { MY_STORY_ID } from '../../types/Stories';
import { Bootstrap } from '../bootstrap';
import type { App } from '../bootstrap';

export const debug = createDebug('mock:test:merge');

const IdentifierType = Proto.ManifestRecord.Identifier.Type;

describe('pnp/merge', function (this: Mocha.Suite) {
  this.timeout(durations.MINUTE);

  let bootstrap: Bootstrap;
  let app: App;
  let pniContact: PrimaryDevice;
  let pniIdentityKey: Uint8Array;
  let aciIdentityKey: Uint8Array;

  beforeEach(async () => {
    bootstrap = new Bootstrap({ contactCount: 0 });
    await bootstrap.init();

    const { server, phone } = bootstrap;

    pniContact = await server.createPrimaryDevice({
      profileName: 'ACI Contact',
    });
    pniIdentityKey = pniContact.getPublicKey(ServiceIdKind.PNI).serialize();
    aciIdentityKey = pniContact.publicKey.serialize();

    let state = StorageState.getEmpty();

    state = state.updateAccount({
      profileKey: phone.profileKey.serialize(),
      e164: phone.device.number,
    });

    state = state.addContact(
      pniContact,
      {
        identityState: Proto.ContactRecord.IdentityState.DEFAULT,
        whitelisted: true,

        identityKey: pniIdentityKey,

        serviceE164: pniContact.device.number,
        givenName: 'PNI Contact',
      },
      ServiceIdKind.PNI
    );

    state = state.addContact(pniContact, {
      identityState: Proto.ContactRecord.IdentityState.DEFAULT,
      whitelisted: true,

      serviceE164: undefined,
      identityKey: aciIdentityKey,
      givenName: pniContact.profileName,
    });

    // Put both contacts in left pane
    state = state.pin(pniContact, ServiceIdKind.PNI);
    state = state.pin(pniContact, ServiceIdKind.ACI);

    // Add my story
    state = state.addRecord({
      type: IdentifierType.STORY_DISTRIBUTION_LIST,
      record: {
        storyDistributionList: {
          allowsReplies: true,
          identifier: uuidToBytes(MY_STORY_ID),
          isBlockList: true,
          name: MY_STORY_ID,
          recipientServiceIds: [],
        },
      },
    });

    await phone.setStorageState(state);

    app = await bootstrap.link();
  });

  afterEach(async function (this: Mocha.Context) {
    await bootstrap.maybeSaveLogs(this.currentTest, app);
    await app.close();
    await bootstrap.teardown();
  });

  for (const finalContact of [ServiceIdKind.ACI, ServiceIdKind.PNI]) {
    for (const withNotification of [false, true]) {
      const testName =
        'happens via storage service, ' +
        `${withNotification ? 'with' : 'without'} notification ` +
        `(${finalContact})`;

      // eslint-disable-next-line no-loop-func
      it(testName, async () => {
        const { phone } = bootstrap;

        const window = await app.getWindow();
        const leftPane = window.locator('#LeftPane');

        debug('opening conversation with the aci contact');
        await leftPane
          .locator(`[data-testid="${pniContact.device.aci}"]`)
          .click();

        await window.locator('.module-conversation-hero').waitFor();

        debug('Send message to ACI');
        {
          const compositionInput = await app.waitForEnabledComposer();

          await compositionInput.type('Hello ACI');
          await compositionInput.press('Enter');
        }

        debug('opening conversation with the pni contact');
        await leftPane
          .locator('.module-conversation-list__item--contact-or-conversation')
          .first()
          .click();

        await window.locator('.module-conversation-hero').waitFor();

        debug('Verify starting state');
        {
          // No messages
          const messages = window.locator('.module-message__text');
          assert.strictEqual(await messages.count(), 0, 'message count');

          // No notifications
          const notifications = window.locator('.SystemMessage');
          assert.strictEqual(
            await notifications.count(),
            0,
            'notification count'
          );
        }

        if (withNotification) {
          debug('Send message to PNI');
          const compositionInput = await app.waitForEnabledComposer();

          await compositionInput.type('Hello PNI');
          await compositionInput.press('Enter');
        }

        if (finalContact === ServiceIdKind.ACI) {
          debug('switching back to ACI conversation');
          await leftPane
            .locator(`[data-testid="${pniContact.device.aci}"]`)
            .click();

          await window.locator('.module-conversation-hero').waitFor();
        }

        debug(
          'removing both contacts from storage service, adding one combined contact'
        );
        {
          const state = await phone.expectStorageState('consistency check');
          await phone.setStorageState(
            state.mergeContact(pniContact, {
              identityState: Proto.ContactRecord.IdentityState.DEFAULT,
              whitelisted: true,
              identityKey: pniContact.publicKey.serialize(),
              profileKey: pniContact.profileKey.serialize(),
            })
          );
          await phone.sendFetchStorage({
            timestamp: bootstrap.getTimestamp(),
          });
          await app.waitForManifestVersion(state.version);
        }

        debug('Verify final state');
        {
          // Should have both PNI and ACI messages
          await window
            .locator('.module-message__text >> "Hello ACI"')
            .waitFor();
          if (withNotification) {
            await window
              .locator('.module-message__text >> "Hello PNI"')
              .waitFor();
          }

          const messages = window.locator('.module-message__text');
          assert.strictEqual(
            await messages.count(),
            withNotification ? 2 : 1,
            'message count'
          );

          // One notification - the merge
          const notifications = window.locator('.SystemMessage');
          assert.strictEqual(
            await notifications.count(),
            withNotification ? 1 : 0,
            'notification count'
          );

          if (withNotification) {
            const first = await notifications.first();
            assert.match(
              await first.innerText(),
              /Your message history with ACI Contact and their number .* has been merged./
            );
          }
        }
      });
    }
  }

  it('accepts storage service contact splitting', async () => {
    const { phone } = bootstrap;

    debug(
      'removing both contacts from storage service, adding one combined contact'
    );
    {
      const state = await phone.expectStorageState('consistency check');
      await phone.setStorageState(
        state.mergeContact(pniContact, {
          identityState: Proto.ContactRecord.IdentityState.DEFAULT,
          whitelisted: true,
          identityKey: pniContact.publicKey.serialize(),
          profileKey: pniContact.profileKey.serialize(),
        })
      );
      await phone.sendFetchStorage({
        timestamp: bootstrap.getTimestamp(),
      });
    }

    const window = await app.getWindow();
    const leftPane = window.locator('#LeftPane');

    debug('opening conversation with the merged contact');
    await leftPane
      .locator(
        `[data-testid="${pniContact.device.aci}"] >> ` +
          `"${pniContact.profileName}"`
      )
      .click();

    await window.locator('.module-conversation-hero').waitFor();

    debug('Send message to merged contact');
    {
      const compositionInput = await app.waitForEnabledComposer();

      await compositionInput.type('Hello merged');
      await compositionInput.press('Enter');
    }

    debug('Split contact and mark ACI as unregistered');
    {
      let state = await phone.expectStorageState('consistency check');

      state = state.updateContact(pniContact, {
        pni: undefined,
        serviceE164: undefined,
        unregisteredAtTimestamp: Long.fromNumber(bootstrap.getTimestamp()),
      });

      state = state.addContact(
        pniContact,
        {
          identityState: Proto.ContactRecord.IdentityState.DEFAULT,
          whitelisted: true,

          identityKey: pniIdentityKey,

          serviceE164: pniContact.device.number,
          givenName: 'PNI Contact',
        },
        ServiceIdKind.PNI
      );

      state = state.pin(pniContact, ServiceIdKind.PNI);

      await phone.setStorageState(state);
      await phone.sendFetchStorage({
        timestamp: bootstrap.getTimestamp(),
      });
    }

    debug('Wait for pni contact to appear');
    await leftPane
      .locator(`[data-testid="${pniContact.device.pni}"]`)
      .waitFor();

    debug('Verify that the message is in the ACI conversation');
    {
      // Should have both PNI and ACI messages
      await window.locator('.module-message__text >> "Hello merged"').waitFor();

      const messages = window.locator('.module-message__text');
      assert.strictEqual(await messages.count(), 1, 'message count');
    }

    debug('Open PNI conversation');
    await leftPane.locator(`[data-testid="${pniContact.device.pni}"]`).click();

    debug('Verify absence of messages in the PNI conversation');
    {
      const messages = window.locator('.module-message__text');
      assert.strictEqual(await messages.count(), 0, 'message count');
    }
  });

  it('splits contact when ACI becomes unregistered', async () => {
    const { phone, server } = bootstrap;

    debug(
      'removing both contacts from storage service, adding one combined contact'
    );
    {
      const state = await phone.expectStorageState('consistency check');
      await phone.setStorageState(
        state.mergeContact(pniContact, {
          identityState: Proto.ContactRecord.IdentityState.DEFAULT,
          whitelisted: true,
          identityKey: pniContact.publicKey.serialize(),
          profileKey: pniContact.profileKey.serialize(),
        })
      );
      await phone.sendFetchStorage({
        timestamp: bootstrap.getTimestamp(),
      });
    }

    const window = await app.getWindow();
    const leftPane = window.locator('#LeftPane');

    debug('opening conversation with the merged contact');
    await leftPane
      .locator(
        `[data-testid="${pniContact.device.aci}"] >> ` +
          `"${pniContact.profileName}"`
      )
      .click();

    await window.locator('.module-conversation-hero').waitFor();

    debug('Unregistering ACI');
    server.unregister(pniContact);

    const state = await phone.expectStorageState('initial state');

    debug('Send message to merged contact');
    {
      const compositionInput = await app.waitForEnabledComposer();

      await compositionInput.type('Hello merged');
      await compositionInput.press('Enter');
    }

    debug('Verify that contact is split in storage service');
    {
      const newState = await phone.waitForStorageState({
        after: state,
      });

      const { added, removed } = newState.diff(state);
      assert.strictEqual(added.length, 2, 'only two records must be added');
      assert.strictEqual(removed.length, 1, 'only one record must be removed');

      let pniContacts = 0;
      let aciContacts = 0;
      for (const { contact } of added) {
        if (!contact) {
          throw new Error('Invalid record');
        }

        const { aci, serviceE164, pni } = contact;
        if (aci === pniContact.device.aci) {
          aciContacts += 1;
          assert.strictEqual(pni, '');
          assert.strictEqual(serviceE164, '');
        } else if (pni === toUntaggedPni(pniContact.device.pni)) {
          pniContacts += 1;
          assert.strictEqual(aci, '');
          assert.strictEqual(serviceE164, pniContact.device.number);
        }
      }
      assert.strictEqual(aciContacts, 1);
      assert.strictEqual(pniContacts, 1);

      assert.strictEqual(
        removed[0].contact?.pni,
        toUntaggedPni(pniContact.device.pni)
      );
      assert.strictEqual(removed[0].contact?.aci, pniContact.device.aci);

      // Pin PNI so that it appears in the left pane
      const updated = newState.pin(pniContact, ServiceIdKind.PNI);
      await phone.setStorageState(updated);
      await phone.sendFetchStorage({
        timestamp: bootstrap.getTimestamp(),
      });
    }

    debug('Verify that the message is in the ACI conversation');
    {
      // Should have both PNI and ACI messages
      await window.locator('.module-message__text >> "Hello merged"').waitFor();

      const messages = window.locator('.module-message__text');
      assert.strictEqual(await messages.count(), 1, 'message count');
    }

    debug('Open PNI conversation');
    await leftPane.locator(`[data-testid="${pniContact.device.pni}"]`).click();

    debug('Wait for ACI conversation to go away');
    await window
      .locator(`.module-conversation-hero >> ${pniContact.profileName}`)
      .waitFor({
        state: 'hidden',
      });

    debug('Verify absence of messages in the PNI conversation');
    {
      const messages = window.locator('.module-message__text');
      assert.strictEqual(await messages.count(), 0, 'message count');
    }
  });
});
