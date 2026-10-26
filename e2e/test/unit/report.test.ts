import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzConcurrency } from '../../src/fixture.ts';
import { lzMutantLine, lzParseReport } from '../../src/report.ts';

function reportOf(mutants: unknown[]): string {
  return JSON.stringify({
    schemaVersion: '2',
    thresholds: { high: 80, low: 60 },
    files: { 'src/grow.ts': { language: 'typescript', source: '', mutants } },
  });
}

const timeout = {
  id: '3',
  mutatorName: 'BooleanLiteral',
  replacement: 'true',
  statusReason: 'Memory limit reached (378/300 MB)',
  status: 'Timeout',
  static: false,
  coveredBy: ['1'],
  location: { start: { line: 2, column: 10 }, end: { line: 2, column: 15 } },
};
const compileError = {
  id: '2',
  mutatorName: 'BlockStatement',
  replacement: '{}',
  status: 'CompileError',
  location: { start: { line: 1, column: 39 }, end: { line: 3, column: 2 } },
};

describe('lzParseReport', () => {
  it('reads each mutant with the fields the report leaves out as empty', () => {
    const report = lzParseReport(reportOf([compileError]));

    assert.deepEqual(report.get('src/grow.ts'), [
      {
        line: 1,
        column: 39,
        mutator: 'BlockStatement',
        replacement: '{}',
        status: 'CompileError',
        statusReason: '',
        killedBy: [],
        coveredBy: [],
      },
    ]);
  });

  it('sorts mutants by line, column, mutator and replacement', () => {
    const at = (line: number, column: number) => ({ start: { line, column }, end: { line, column } });
    const report = lzParseReport(
      reportOf([
        { mutatorName: 'EqualityOperator', replacement: 'n % 2 !== 0', status: 'Killed', location: at(6, 10) },
        { mutatorName: 'ConditionalExpression', replacement: 'true', status: 'Killed', location: at(6, 10) },
        { mutatorName: 'ConditionalExpression', replacement: 'false', status: 'Killed', location: at(6, 10) },
        { mutatorName: 'BlockStatement', replacement: '{}', status: 'Killed', location: at(5, 44) },
        { mutatorName: 'BlockStatement', replacement: '{}', status: 'Killed', location: at(1, 51) },
      ]),
    );

    assert.deepEqual(report.get('src/grow.ts')?.map(lzMutantLine), [
      '1:51 BlockStatement {} Killed',
      '5:44 BlockStatement {} Killed',
      '6:10 ConditionalExpression false Killed',
      '6:10 ConditionalExpression true Killed',
      '6:10 EqualityOperator n % 2 !== 0 Killed',
    ]);
  });

  it('names the first field that does not fit', () => {
    assert.throws(() => lzParseReport(reportOf([compileError, { ...timeout, status: 'Slow' }])), {
      message: 'not a mutation report: files["src/grow.ts"].mutants[1].status',
    });
  });

  it('names a location without a start position', () => {
    assert.throws(() => lzParseReport(reportOf([{ ...timeout, location: { start: { line: 2 } } }])), {
      message: 'not a mutation report: files["src/grow.ts"].mutants[0].location.start',
    });
  });

  it('refuses a report without files', () => {
    assert.throws(() => lzParseReport('{"schemaVersion":"2"}'), { message: 'not a mutation report: files' });
  });
});

describe('lzMutantLine', () => {
  it('collapses whitespace runs in the replacement to one space', () => {
    const report = lzParseReport(reportOf([{ ...timeout, replacement: '{\n  return\ttrue;\n}' }]));

    assert.deepEqual(report.get('src/grow.ts')?.map(lzMutantLine), ['2:10 BooleanLiteral { return true; } Timeout']);
  });

  it('leaves out a replacement the report does not have', () => {
    const withoutReplacement = Object.fromEntries(Object.entries(timeout).filter(([key]) => key !== 'replacement'));
    const report = lzParseReport(reportOf([withoutReplacement]));

    assert.deepEqual(report.get('src/grow.ts')?.map(lzMutantLine), ['2:10 BooleanLiteral Timeout']);
  });
});

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
