import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzConcurrency } from '../../src/fixture.ts';

describe('lzConcurrency', () => {
  it('reads a positive integer', () => {
    assert.equal(lzConcurrency({ LZ_E2E_CONCURRENCY: '2' }), 2);
  });

  it('refuses an unset value and names the variable', () => {
    assert.throws(() => lzConcurrency({}), {
      message: /^Set LZ_E2E_CONCURRENCY to a positive integer.*It is unset\.$/,
    });
  });

  it('refuses zero', () => {
    assert.throws(() => lzConcurrency({ LZ_E2E_CONCURRENCY: '0' }), { message: /It is "0"\.$/ });
  });
});
