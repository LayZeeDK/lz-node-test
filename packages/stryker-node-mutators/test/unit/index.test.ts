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
});
