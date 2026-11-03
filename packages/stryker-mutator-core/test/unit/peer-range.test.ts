import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { inPeerRange, lzWarnOutsidePeerRange, parseCaretFloor } from '../../src/peer-range.ts';

const packageName = 'lz-sample-mutators';

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
    assert.equal(inPeerRange(version, parseCaretFloor(range, packageName)), expected);
  });
});

describe('parseCaretFloor', () => {
  it('gives the first release of the range', () => {
    assert.deepEqual(parseCaretFloor('^10.2.3', packageName), { major: 10, minor: 2, patch: 3 });
  });

  lzTestEach(['~10.1.1', '^10.1', '^10.1.1-beta.0', '10.1.1'])(
    'refuses the range %s, which is no caret range of a release, naming the calling package',
    (range) => {
      assert.throws(() => parseCaretFloor(range, packageName), {
        message: `lz-sample-mutators: ${range} is no caret range of a release.`,
      });
    },
  );
});

describe('lzWarnOutsidePeerRange', () => {
  const range = '^10.1.1';

  function warningsFor(...versions: readonly string[]): readonly string[] {
    const warnings: string[] = [];

    lzWarnOutsidePeerRange(packageName, parseCaretFloor(range, packageName), versions, (message) =>
      warnings.push(message),
    );

    return warnings;
  }

  lzTestEach(['10.1.1', '10.1.2', '10.2.0'])(
    'gives no warning for the instrumenter version %s, in the peer range',
    (version) => {
      assert.deepEqual(warningsFor(version), []);
    },
  );

  lzTestEach(['10.1.0', '11.0.0', '9.1.1', '110.1.1', '10.2.0-beta.0'])(
    'warns that mutants may be missing with the instrumenter version %s, outside the peer range',
    (version) => {
      assert.deepEqual(warningsFor(version), [
        `lz-sample-mutators accepts @stryker-mutator/instrumenter 10.1.1 or a later 10.x, not ${version}. ` +
          'Its install check passed, but it sees only this process, so mutants of its mutators may be missing.',
      ]);
    },
  );

  it('warns once for a version that two instrumenters have', () => {
    assert.equal(warningsFor('9.0.0', '9.0.0').length, 1);
  });
});
