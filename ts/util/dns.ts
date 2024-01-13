// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type {
  LookupOneOptions,
  LookupAllOptions,
  LookupAddress,
  lookup as nodeLookup,
} from 'dns';
import { ipcRenderer, net } from 'electron';
import type { ResolvedHost } from 'electron';

import { strictAssert } from './assert';
import { drop } from './drop';

function lookupAll(
  hostname: string,
  opts: LookupOneOptions | LookupAllOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    addresses: string | Array<LookupAddress>,
    family?: number
  ) => void
): void {
  // Node.js support various signatures, but we only support one.
  strictAssert(typeof opts === 'object', 'missing options');
  strictAssert(typeof callback === 'function', 'missing callback');

  async function run() {
    let result: ResolvedHost;

    try {
      let queryType: 'A' | 'AAAA' | undefined;
      if (opts.family === 4) {
        queryType = 'A';
      } else if (opts.family === 6) {
        queryType = 'AAAA';
      }

      if (net) {
        // Main process
        result = await net.resolveHost(hostname, {
          queryType,
        });
      } else {
        // Renderer
        result = await ipcRenderer.invoke(
          'net.resolveHost',
          hostname,
          queryType
        );
      }
      const addresses = result.endpoints.map(({ address, family }) => {
        let numericFamily = -1;
        if (family === 'ipv4') {
          numericFamily = 4;
        } else if (family === 'ipv6') {
          numericFamily = 6;
        }
        return {
          address,
          family: numericFamily,
        };
      });

      if (!opts.all) {
        const random = addresses.at(
          Math.floor(Math.random() * addresses.length)
        );
        if (random === undefined) {
          callback(
            new Error(`Hostname: ${hostname} cannot be resolved`),
            '',
            -1
          );
          return;
        }
        callback(null, random.address, random.family);
        return;
      }

      callback(null, addresses);
    } catch (error) {
      callback(error, []);
    }
  }

  drop(run());
}

export function interleaveAddresses(
  addresses: ReadonlyArray<LookupAddress>
): Array<LookupAddress> {
  const firstAddr = addresses.find(
    ({ family }) => family === 4 || family === 6
  );
  if (!firstAddr) {
    throw new Error('interleaveAddresses: no addresses to interleave');
  }

  const v4 = addresses.filter(({ family }) => family === 4);
  const v6 = addresses.filter(({ family }) => family === 6);

  // Interleave addresses for Happy Eyeballs, but keep the first address
  // type from the DNS response first in the list.
  const interleaved = new Array<LookupAddress>();
  while (v4.length !== 0 || v6.length !== 0) {
    const v4Entry = v4.pop();
    const v6Entry = v6.pop();

    if (firstAddr.family === 4) {
      if (v4Entry !== undefined) {
        interleaved.push(v4Entry);
      }
      if (v6Entry !== undefined) {
        interleaved.push(v6Entry);
      }
    } else {
      if (v6Entry !== undefined) {
        interleaved.push(v6Entry);
      }
      if (v4Entry !== undefined) {
        interleaved.push(v4Entry);
      }
    }
  }

  return interleaved;
}

// Note: `nodeLookup` has a complicated type due to compatibility requirements.
export const electronLookup = lookupAll as typeof nodeLookup;
