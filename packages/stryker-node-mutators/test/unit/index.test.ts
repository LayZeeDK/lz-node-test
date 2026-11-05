import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzResolveFromCore } from '@layzee/stryker-mutator-core';
import { lzNodeMutators } from '../../src/index.ts';

describe('lzNodeMutators', () => {
  it("installs the defaults and the mutators its options turn on into Stryker's instrumenter", async () => {
    await lzNodeMutators({ LzNodeListenerOnce: true, experimental: { LzNodeByteLength: true } });

    const names = (await lzResolveFromCore()).allMutators.map(({ name }) => name);

    assert.deepEqual(
      [
        'LzNodeTimerDelay',
        'LzNodeListenerOnce',
        'LzNodeByteLength',
        'LzNodeAssertStatement',
        'LzNodeCallbackError',
      ].map((name) => names.includes(name)),
      [true, true, true, false, false],
    );
  });

  it('names this package in the error for a mutator its options cannot turn on there', async () => {
    // @ts-expect-error -- LzNodeByteLength is experimental, so it goes inside `experimental`
    await assert.rejects(lzNodeMutators({ LzNodeByteLength: true }), /^Error: stryker-node-mutators: /);
  });
});
