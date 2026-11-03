import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { inPeerRange, lzWarnOutsidePeerRange, parseCaretFloor } from '../../src/peer-range.ts';
import pkg from '../../package.json' with { type: 'json' };

describe('inPeerRange', () => {
  lzTestEach([
    ['10.1.5', '^10.2.0', false],
    ['10.2.0', '^10.2.0', true],
    ['10.1.9', '^10.1.10', false],
    ['10.0.0', '^10.0.0', true],
    ['9.9.9', '^10.0.0', false],
    ['v10.1.1', '^10.1.1', false],
    ['10.12.0', '^10.1.1', true],
  ])('takes %s in %s: %s', (version, range, expected) => {
    assert.equal(inPeerRange(version, range), expected);
  });

  lzTestEach(['~10.1.1', '^10.1', '^10.1.1-beta.0'])(
    'refuses the range %s, which is no caret range of a release',
    (range) => {
      assert.throws(() => inPeerRange('10.1.1', range), {
        message: `stryker-node-test-mutators: ${range} is no caret range of a release.`,
      });
    },
  );
});

describe('lzWarnOutsidePeerRange', () => {
  const { major, minor, patch } = parseCaretFloor(pkg.peerDependencies['@stryker-mutator/core']);
  const floor = `${major}.${minor}.${patch}`;

  function belowFloor(): string {
    if (patch > 0) {
      return `${major}.${minor}.${patch - 1}`;
    }

    return minor > 0 ? `${major}.${minor - 1}.999` : `${major - 1}.999.999`;
  }

  function warningsFor(version: string): readonly string[] {
    const warnings: string[] = [];

    lzWarnOutsidePeerRange([version], (message) => warnings.push(message));

    return warnings;
  }

  lzTestEach([floor, `${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`])(
    'gives no warning for the instrumenter version %s, in the peer range',
    (version) => {
      assert.deepEqual(warningsFor(version), []);
    },
  );

  lzTestEach([
    belowFloor(),
    `${major + 1}.0.0`,
    `${major - 1}.${minor}.${patch}`,
    `1${floor}`,
    `${major}.${minor + 1}.0-beta.0`,
  ])('warns that mutants may be missing with the instrumenter version %s, outside the peer range', (version) => {
    assert.deepEqual(warningsFor(version), [
      `stryker-node-test-mutators accepts @stryker-mutator/instrumenter ${floor} or a later ${major}.x, not ${version}. ` +
        'Its install check passed, but it sees only this process, so mutants of its mutators may be missing.',
    ]);
  });

  it('warns from the range the README names', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8').replaceAll(/\s+/g, ' ');

    assert.ok(readme.includes(`It accepts Stryker ${floor} or a later ${major}.x version`));
  });
});
