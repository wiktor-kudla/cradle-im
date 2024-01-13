// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/* eslint-disable max-classes-per-file */

import type { KeyPairType } from './Types.d';
import * as Bytes from '../Bytes';
import {
  decryptAes256CbcPkcsPadding,
  deriveSecrets,
  verifyHmacSha256,
} from '../Crypto';
import { calculateAgreement, createKeyPair, generateKeyPair } from '../Curve';
import { SignalService as Proto } from '../protobuf';
import { strictAssert } from '../util/assert';
import { dropNull } from '../util/dropNull';

type ProvisionDecryptResult = {
  aciKeyPair: KeyPairType;
  pniKeyPair?: KeyPairType;
  number?: string;
  aci?: string;
  untaggedPni?: string;
  provisioningCode?: string;
  userAgent?: string;
  readReceipts?: boolean;
  profileKey?: Uint8Array;
  masterKey?: Uint8Array;
};

class ProvisioningCipherInner {
  keyPair?: KeyPairType;

  async decrypt(
    provisionEnvelope: Proto.ProvisionEnvelope
  ): Promise<ProvisionDecryptResult> {
    strictAssert(
      provisionEnvelope.publicKey,
      'Missing publicKey in ProvisionEnvelope'
    );
    strictAssert(provisionEnvelope.body, 'Missing body in ProvisionEnvelope');
    const masterEphemeral = provisionEnvelope.publicKey;
    const message = provisionEnvelope.body;
    if (new Uint8Array(message)[0] !== 1) {
      throw new Error('Bad version number on ProvisioningMessage');
    }

    const iv = message.slice(1, 16 + 1);
    const mac = message.slice(message.byteLength - 32, message.byteLength);
    const ivAndCiphertext = message.slice(0, message.byteLength - 32);
    const ciphertext = message.slice(16 + 1, message.byteLength - 32);

    if (!this.keyPair) {
      throw new Error('ProvisioningCipher.decrypt: No keypair!');
    }

    const ecRes = calculateAgreement(masterEphemeral, this.keyPair.privKey);
    const keys = deriveSecrets(
      ecRes,
      new Uint8Array(32),
      Bytes.fromString('TextSecure Provisioning Message')
    );
    verifyHmacSha256(ivAndCiphertext, keys[1], mac, 32);

    const plaintext = decryptAes256CbcPkcsPadding(keys[0], ciphertext, iv);
    const provisionMessage = Proto.ProvisionMessage.decode(plaintext);
    const aciPrivKey = provisionMessage.aciIdentityKeyPrivate;
    const pniPrivKey = provisionMessage.pniIdentityKeyPrivate;
    strictAssert(aciPrivKey, 'Missing aciKeyPrivate in ProvisionMessage');

    const aciKeyPair = createKeyPair(aciPrivKey);
    const pniKeyPair = pniPrivKey?.length
      ? createKeyPair(pniPrivKey)
      : undefined;

    const { aci, pni } = provisionMessage;
    strictAssert(aci, 'Missing aci in provisioning message');
    strictAssert(pni, 'Missing pni in provisioning message');

    const ret: ProvisionDecryptResult = {
      aciKeyPair,
      pniKeyPair,
      number: dropNull(provisionMessage.number),
      aci,
      untaggedPni: pni,
      provisioningCode: dropNull(provisionMessage.provisioningCode),
      userAgent: dropNull(provisionMessage.userAgent),
      readReceipts: provisionMessage.readReceipts ?? false,
    };
    if (Bytes.isNotEmpty(provisionMessage.profileKey)) {
      ret.profileKey = provisionMessage.profileKey;
    }
    if (Bytes.isNotEmpty(provisionMessage.masterKey)) {
      ret.masterKey = provisionMessage.masterKey;
    }
    return ret;
  }

  async getPublicKey(): Promise<Uint8Array> {
    if (!this.keyPair) {
      this.keyPair = generateKeyPair();
    }

    if (!this.keyPair) {
      throw new Error('ProvisioningCipher.decrypt: No keypair!');
    }

    return this.keyPair.pubKey;
  }
}

export default class ProvisioningCipher {
  constructor() {
    const inner = new ProvisioningCipherInner();

    this.decrypt = inner.decrypt.bind(inner);
    this.getPublicKey = inner.getPublicKey.bind(inner);
  }

  decrypt: (
    provisionEnvelope: Proto.ProvisionEnvelope
  ) => Promise<ProvisionDecryptResult>;

  getPublicKey: () => Promise<Uint8Array>;
}
