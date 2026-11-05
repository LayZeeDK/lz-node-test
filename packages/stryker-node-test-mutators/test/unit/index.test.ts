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
});
