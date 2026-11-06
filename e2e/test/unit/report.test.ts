import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzMutantLine, lzMutantsByKey, lzParseReport } from '../../src/report.ts';

function failure(json: string): string {
  try {
    lzParseReport(json);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return 'no error';
}

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
        endLine: 3,
        endColumn: 2,
        mutator: 'BlockStatement',
        replacement: '{}',
        status: 'CompileError',
        static: false,
        statusReason: '',
        killedBy: [],
        coveredBy: [],
      },
    ]);
  });

  it('reads whether a mutant is static', () => {
    const report = lzParseReport(reportOf([{ ...timeout, static: true }, compileError]));

    assert.deepEqual(
      report.get('src/grow.ts')?.map(({ mutator, static: isStatic }) => [mutator, isStatic]),
      [
        ['BlockStatement', false],
        ['BooleanLiteral', true],
      ],
    );
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

  it('names a static field that is not a boolean', () => {
    assert.throws(() => lzParseReport(reportOf([{ ...timeout, static: 'yes' }])), {
      message: 'not a mutation report: files["src/grow.ts"].mutants[0].static',
    });
  });

  it('names a location without a start position', () => {
    assert.throws(() => lzParseReport(reportOf([{ ...timeout, location: { start: { line: 2 } } }])), {
      message: 'not a mutation report: files["src/grow.ts"].mutants[0].location.start',
    });
  });

  it('names a location without an end position', () => {
    assert.throws(
      () => lzParseReport(reportOf([{ ...timeout, location: { ...timeout.location, end: { line: 2 } } }])),
      {
        message: 'not a mutation report: files["src/grow.ts"].mutants[0].location.end',
      },
    );
  });

  it('refuses a report without files', () => {
    assert.throws(() => lzParseReport('{"schemaVersion":"2"}'), { message: 'not a mutation report: files' });
  });

  it('refuses JSON that is not an object without naming a field', () => {
    assert.throws(() => lzParseReport('[]'), { message: 'not a mutation report' });
  });

  it('names each other field that does not fit', () => {
    const fileWithoutMutants = JSON.stringify({ files: { 'src/grow.ts': { source: '' } } });
    const misfits = [
      { ...timeout, mutatorName: 7 },
      { ...timeout, replacement: 7 },
      { ...timeout, statusReason: 7 },
      { ...timeout, killedBy: ['1', 2] },
      { ...timeout, coveredBy: '1' },
    ];

    assert.deepEqual([fileWithoutMutants, ...misfits.map((misfit) => reportOf([misfit]))].map(failure), [
      'not a mutation report: files["src/grow.ts"].mutants',
      'not a mutation report: files["src/grow.ts"].mutants[0].mutatorName',
      'not a mutation report: files["src/grow.ts"].mutants[0].replacement',
      'not a mutation report: files["src/grow.ts"].mutants[0].statusReason',
      'not a mutation report: files["src/grow.ts"].mutants[0].killedBy',
      'not a mutation report: files["src/grow.ts"].mutants[0].coveredBy',
    ]);
  });

  it('sorts by start position before mutator, and by mutator before replacement and end position', () => {
    const report = lzParseReport(
      reportOf([
        {
          ...timeout,
          mutatorName: 'B',
          replacement: 'b',
          location: { start: { line: 2, column: 1 }, end: { line: 2, column: 2 } },
        },
        {
          ...timeout,
          mutatorName: 'A',
          replacement: 'a',
          location: { start: { line: 1, column: 1 }, end: { line: 9, column: 1 } },
        },
        {
          ...timeout,
          mutatorName: 'B',
          replacement: 'a',
          location: { start: { line: 3, column: 1 }, end: { line: 3, column: 1 } },
        },
        {
          ...timeout,
          mutatorName: 'A',
          replacement: 'b',
          location: { start: { line: 3, column: 1 }, end: { line: 3, column: 1 } },
        },
      ]),
    );

    assert.deepEqual(report.get('src/grow.ts')?.map(lzMutantLine), [
      '1:1 A a Timeout',
      '2:1 B b Timeout',
      '3:1 A b Timeout',
      '3:1 B a Timeout',
    ]);
  });

  it('sorts a greater mutator after a smaller one even when its replacement and end come first', () => {
    const report = lzParseReport(
      reportOf([
        {
          ...timeout,
          mutatorName: 'A',
          replacement: 'b',
          location: { start: { line: 3, column: 1 }, end: { line: 5, column: 1 } },
        },
        {
          ...timeout,
          mutatorName: 'B',
          replacement: 'a',
          location: { start: { line: 3, column: 1 }, end: { line: 3, column: 1 } },
        },
      ]),
    );

    assert.deepEqual(report.get('src/grow.ts')?.map(lzMutantLine), ['3:1 A b Timeout', '3:1 B a Timeout']);
  });

  it('sorts mutants that differ only in their end by end line, then end column, whichever order the report has', () => {
    const ending = (line: number, column: number) => ({
      ...timeout,
      location: { start: { line: 2, column: 10 }, end: { line, column } },
    });
    const ends = (mutants: unknown[]) =>
      lzParseReport(reportOf(mutants))
        .get('src/grow.ts')
        ?.map(({ endLine, endColumn }) => `${endLine}:${endColumn}`);

    assert.deepEqual(
      [
        ends([ending(5, 1), ending(3, 1)]),
        ends([ending(3, 1), ending(5, 1)]),
        ends([ending(3, 5), ending(3, 3)]),
        ends([ending(3, 3), ending(3, 5)]),
      ],
      [
        ['3:1', '5:1'],
        ['3:1', '5:1'],
        ['3:3', '3:5'],
        ['3:3', '3:5'],
      ],
    );
  });
});

describe('lzMutantsByKey', () => {
  it('names the key that two mutants share', () => {
    const report = lzParseReport(reportOf([compileError, timeout, timeout]));

    assert.throws(() => lzMutantsByKey(report), {
      message: 'Two mutants share the key "src/grow.ts:2:10-2:15 BooleanLiteral true"; the comparison would drop one.',
    });
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
