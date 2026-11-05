import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzResolveFromCore } from '@layzee/stryker-mutator-core';
import { lzNodeTestMutators } from '../../src/index.ts';

describe('lzNodeTestMutators', () => {
  it("puts the defaults and the mutators its options turn on in place of Stryker's", async () => {
    await lzNodeTestMutators({ experimental: { LzNodeTestCatchAssert: true } });

    const names = (await lzResolveFromCore()).allMutators.map(({ name }) => name);

    assert.deepEqual(names, ['LzNodeTestAssertCall', 'LzNodeTestAssertValidator', 'LzNodeTestCatchAssert']);
  });

  it('names this package in the error for a mutator its options cannot turn on there', async () => {
    // @ts-expect-error -- LzNodeTestCatchAssert is experimental, so it goes inside `experimental`
    await assert.rejects(lzNodeTestMutators({ LzNodeTestCatchAssert: true }), /^Error: stryker-node-test-mutators: /);
  });
});
