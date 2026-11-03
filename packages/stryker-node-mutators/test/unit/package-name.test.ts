import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { lzCorePeerRange } from '../../src/package-name.ts';
import pkg from '../../package.json' with { type: 'json' };

describe('lzCorePeerRange', () => {
  it('is the peer range of @stryker-mutator/core in package.json', () => {
    assert.equal(lzCorePeerRange, pkg.peerDependencies['@stryker-mutator/core']);
  });

  it('is the range the README names', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8').replaceAll(/\s+/g, ' ');
    const floor = lzCorePeerRange.slice(1);
    const [major] = floor.split('.');
    assert.ok(major);

    assert.ok(readme.includes(`It accepts Stryker ${floor} or a later ${major}.x version`));
  });
});
