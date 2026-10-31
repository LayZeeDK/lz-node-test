import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzConcurrency, lzMutant, lzMutants, lzStrykerTimeoutMs, type LzStrykerRun } from '../../src/fixture.ts';
import type { LzMutantDetail } from '../../src/report.ts';

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

function mutant(line: number, replacement: string): LzMutantDetail {
  return {
    line,
    column: 1,
    endLine: line,
    endColumn: 5,
    mutator: 'StringLiteral',
    replacement,
    status: 'Killed',
    statusReason: '',
    killedBy: [],
    coveredBy: [],
  };
}

function reported(files: Readonly<Record<string, readonly LzMutantDetail[]>>): LzStrykerRun {
  return {
    exitCode: 0,
    output: '',
    leftover: [],
    timedOut: false,
    reported: true,
    report: new Map(Object.entries(files)),
  };
}

function unreported(timedOut: boolean): LzStrykerRun {
  return { exitCode: 1, output: 'Error during import', leftover: [], timedOut, reported: false };
}

describe('lzMutants', () => {
  it('lists the mutants of a file of the report', () => {
    const run = reported({ 'src/a.ts': [mutant(1, '""')] });

    assert.deepEqual(lzMutants(run, 'src/a.ts'), ['1:1 StringLiteral "" Killed']);
  });

  it('refuses a file the report does not have, and names the files it has', () => {
    const run = reported({ 'src/a.ts': [], 'src/b.ts': [] });

    assert.throws(() => lzMutants(run, 'src/c.ts'), {
      message: 'The report has no file "src/c.ts"; it has src/a.ts, src/b.ts.',
    });
  });

  it("refuses a run with no report, and shows Stryker's exit code and output", () => {
    assert.throws(() => lzMutants(unreported(false), 'src/a.ts'), {
      message: 'Stryker wrote no report (exit code 1):\nError during import',
    });
  });

  it('refuses a run with no report, and says when it timed out', () => {
    assert.throws(() => lzMutants(unreported(true), 'src/a.ts'), {
      message: `Stryker wrote no report (exit code 1, ended after ${lzStrykerTimeoutMs / 60_000} minutes):\nError during import`,
    });
  });
});

describe('lzMutant', () => {
  const run = reported({
    'src/a.ts': [mutant(1, '""'), mutant(2, '""'), mutant(2, '""')],
    'src/b.ts': [mutant(1, '"x"')],
  });

  it('finds the one mutant at a place with a replacement', () => {
    assert.deepEqual(lzMutant(run, { at: 'src/b.ts:1:1', replacement: '"x"' }), mutant(1, '"x"'));
  });

  it('refuses a place with no mutant of the replacement', () => {
    assert.throws(() => lzMutant(run, { at: 'src/b.ts:1:1', replacement: '""' }), {
      message: 'Expected one mutant at src/b.ts:1:1 with replacement """", found 0.',
    });
  });

  it('refuses a place with more than one mutant of the replacement', () => {
    assert.throws(() => lzMutant(run, { at: 'src/a.ts:2:1', replacement: '""' }), {
      message: 'Expected one mutant at src/a.ts:2:1 with replacement """", found 2.',
    });
  });

  it('refuses a run with no report', () => {
    assert.throws(() => lzMutant(unreported(false), { at: 'src/a.ts:1:1', replacement: '""' }), {
      message: 'Stryker wrote no report (exit code 1):\nError during import',
    });
  });
});
