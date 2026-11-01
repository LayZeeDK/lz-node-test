import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzCompare, lzScore } from '../../src/oss/verdicts.ts';
import type { LzMutantDetail, LzMutantStatus } from '../../src/report.ts';

function mutant(line: number, status: LzMutantStatus, replacement = 'x', endColumn = 9): LzMutantDetail {
  return {
    line,
    column: 3,
    endLine: line,
    endColumn,
    mutator: 'StringLiteral',
    replacement,
    status,
    static: false,
    statusReason: '',
    killedBy: [],
    coveredBy: [],
  };
}

describe('lzScore', () => {
  it('counts each status and scores as Stryker does, without CompileError, RuntimeError or Ignored', () => {
    const mutants = (
      ['Killed', 'Timeout', 'Survived', 'NoCoverage', 'RuntimeError', 'Ignored', 'Killed'] satisfies LzMutantStatus[]
    ).map((status, line) => mutant(line, status));

    assert.deepEqual(lzScore(mutants), {
      counts: { Ignored: 1, Killed: 2, NoCoverage: 1, RuntimeError: 1, Survived: 1, Timeout: 1 },
      score: 60,
    });
  });

  it('has no score without a valid mutant', () => {
    assert.equal(lzScore([mutant(1, 'CompileError')]).score, null);
  });
});

describe('lzCompare', () => {
  it("pairs the sides' verdicts by file, place, mutator and replacement", () => {
    const lz = new Map([['index.js', [mutant(1, 'Killed'), mutant(2, 'Survived', 'a\n  b')]]]);
    const command = new Map([['index.js', [mutant(1, 'Killed'), mutant(2, 'Killed', 'a\n  b'), mutant(4, 'Timeout')]]]);

    assert.deepEqual(lzCompare(lz, command), [
      { mutant: 'index.js:1:3-1:9 StringLiteral x', lz: 'Killed', command: 'Killed' },
      { mutant: 'index.js:2:3-2:9 StringLiteral a b', lz: 'Survived', command: 'Killed' },
      { mutant: 'index.js:4:3-4:9 StringLiteral x', lz: null, command: 'Timeout' },
    ]);
  });

  it('refuses a report with two mutants at one place, mutator and replacement', () => {
    const lz = new Map([['index.js', [mutant(1, 'Killed'), mutant(1, 'Survived')]]]);

    assert.throws(() => lzCompare(lz, new Map()), {
      message: 'Two mutants share the key "index.js:1:3-1:9 StringLiteral x"; the comparison would drop one.',
    });
  });

  it('keeps apart two mutants that start at one place and end at two', () => {
    const lz = new Map([['index.js', [mutant(1, 'Killed', 'true', 20), mutant(1, 'Survived', 'true', 40)]]]);
    const command = new Map([['index.js', [mutant(1, 'Killed', 'true', 20), mutant(1, 'Killed', 'true', 40)]]]);

    assert.deepEqual(
      lzCompare(lz, command).map(({ lz: status }) => status),
      ['Killed', 'Survived'],
    );
  });
});
