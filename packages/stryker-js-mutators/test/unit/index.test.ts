import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzResolveFromCore } from '@layzee/stryker-mutator-core';
import { lzJsMutators } from '../../src/index.ts';

describe('lzJsMutators', () => {
  it("installs the mutators its options turn on into Stryker's instrumenter", async () => {
    await lzJsMutators({ LzJsNumericLiteral: true });

    const names = (await lzResolveFromCore()).allMutators.map(({ name }) => name);

    assert.deepEqual(
      ['LzJsNumericLiteral', 'LzJsAssignmentStatement'].map((name) => names.includes(name)),
      [true, false],
    );
  });

  it('names this package in the error for a mutator its options cannot turn on there', async () => {
    // @ts-expect-error -- LzJsAssignmentStatement is experimental, so it goes inside `experimental`
    await assert.rejects(lzJsMutators({ LzJsAssignmentStatement: true }), /^Error: stryker-js-mutators: /);
  });
});
