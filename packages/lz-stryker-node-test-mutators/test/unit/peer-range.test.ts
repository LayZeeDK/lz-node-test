import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';
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
        message: `lz-stryker-node-test-mutators: ${range} is no caret range of a release.`,
      });
    },
  );
});

describe('the Stryker versions of the peer range', () => {
  const { major, minor, patch } = parseCaretFloor(pkg.peerDependencies['@stryker-mutator/core']);
  const semver = (...parts: readonly number[]) => parts.join('.');
  const floor = semver(major, minor, patch);

  function belowFloor(): string {
    if (patch > 0) {
      return semver(major, minor, patch - 1);
    }

    return minor > 0 ? semver(major, minor - 1, 999) : semver(major - 1, 999, 999);
  }

  function warningsFor(version: string): readonly string[] {
    const warnings: string[] = [];

    lzWarnOutsidePeerRange([version], (message) => warnings.push(message));

    return warnings;
  }

  lzTestEach([floor, semver(major, minor, patch + 1), semver(major, minor + 1, 0)])(
    'installs into the instrumenter version %s without a warning',
    (version) => {
      assert.deepEqual(warningsFor(version), []);
    },
  );

  lzTestEach([
    belowFloor(),
    semver(major + 1, 0, 0),
    semver(major - 1, minor, patch),
    `1${floor}`,
    `${semver(major, minor + 1, 0)}-beta.0`,
  ])('warns about the instrumenter version %s', (version) => {
    assert.equal(warningsFor(version).length, 1);
  });

  it('is the range the README names', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8').replaceAll(/\s+/g, ' ');

    assert.ok(readme.includes(`It accepts Stryker ${floor} or a later ${String(major)}.x version`));
  });
});
