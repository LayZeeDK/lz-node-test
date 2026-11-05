import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzPartRanges } from '../../src/oss/parts.ts';

const source = [
  "'use strict'",
  '',
  'function a () {',
  '  return 1',
  '}',
  '',
  'function b () {',
  '  return 2',
  '}',
  'const c = 3; const d = 4',
  'module.exports = { a, b, c, d }',
].join('\n');

describe('lzPartRanges', () => {
  it('gives the whole file as one part', () => {
    assert.deepEqual(lzPartRanges('index.js', source, 1), ['index.js:1-11']);
  });

  it('cuts only where a top-level statement starts, nearest an even share of the lines', () => {
    assert.deepEqual(lzPartRanges('index.js', source, 2), ['index.js:1-6', 'index.js:7-11']);
  });

  it('weighs the lines by the mutants that start on them when counts are given', () => {
    const mutantsByLine = new Map([
      [4, 1],
      [8, 1],
      [10, 6],
      [11, 4],
    ]);

    assert.deepEqual(lzPartRanges('index.js', source, 2, mutantsByLine), ['index.js:1-10', 'index.js:11-11']);
  });

  it('never cuts inside a statement or between two statements that share a line', () => {
    const ranges = lzPartRanges('index.js', source, 11);

    assert.deepEqual(ranges, ['index.js:1-2', 'index.js:3-6', 'index.js:7-9', 'index.js:10-10', 'index.js:11-11']);
  });

  it('refuses a part count below 1', () => {
    assert.throws(() => lzPartRanges('index.js', source, 0), { message: 'parts is a positive integer; got 0.' });
  });
});
