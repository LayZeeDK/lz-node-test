import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { lzMutationSummary } from './mutation-summary.ts';

function mutant(status: string): object {
  return { id: '1', mutatorName: 'BlockStatement', status, location: { start: { line: 1, column: 1 } } };
}

function reportOf(...statuses: readonly string[]): object {
  return { schemaVersion: '1.0', files: { 'src/a.ts': { mutants: statuses.map(mutant) } } };
}

const header = [
  '| Mutation score | Killed | Survived | Timeout | NoCoverage | RuntimeError | CompileError | Ignored |',
  '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
];

function summaryOf(title: string, row: string): string {
  return [`### Mutation score: ${title}`, '', ...header, row, ''].join('\n');
}

describe('lzMutationSummary', () => {
  it('counts the mutants of every file per status, in the order Killed, Survived, Timeout, NoCoverage, RuntimeError, CompileError, Ignored', () => {
    const report = {
      files: {
        'src/a.ts': {
          mutants: ['Killed', 'Survived', 'Timeout', 'NoCoverage', 'RuntimeError', 'CompileError'].map(mutant),
        },
        'src/b.ts': {
          mutants: ['Killed', 'Killed', 'Timeout', 'NoCoverage', 'NoCoverage', 'NoCoverage'].map(mutant),
        },
        'src/c.ts': { mutants: ['CompileError', 'CompileError', 'RuntimeError', 'Ignored', 'Ignored'].map(mutant) },
      },
    };

    assert.equal(
      lzMutationSummary('p:mutate-src', report),
      summaryOf('p:mutate-src', '| 50.00 | 3 | 1 | 2 | 4 | 2 | 3 | 2 |'),
    );
  });

  lzTestEach([
    ['every mutant is killed', ['Killed', 'Killed'], '| 100.00 | 2 | 0 | 0 | 0 | 0 | 0 | 0 |'],
    ['a Timeout mutant counts as detected', ['Timeout'], '| 100.00 | 0 | 0 | 1 | 0 | 0 | 0 | 0 |'],
    ['a Survived mutant counts as undetected', ['Killed', 'Survived'], '| 50.00 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |'],
    [
      'a NoCoverage mutant counts as undetected',
      ['NoCoverage', 'Timeout', 'Killed'],
      '| 66.67 | 1 | 0 | 1 | 1 | 0 | 0 | 0 |',
    ],
    [
      'RuntimeError, CompileError and Ignored mutants stay out of the score',
      ['Killed', 'RuntimeError', 'CompileError', 'Ignored'],
      '| 100.00 | 1 | 0 | 0 | 0 | 1 | 1 | 1 |',
    ],
    ['only one mutant survives', ['Survived'], '| 0.00 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |'],
    ['no mutant has a score', ['RuntimeError', 'Ignored'], '| n/a | 0 | 0 | 0 | 0 | 1 | 0 | 1 |'],
    ['the report has no mutants', [], '| n/a | 0 | 0 | 0 | 0 | 0 | 0 | 0 |'],
  ])('writes the score Stryker reports when %s', (_, statuses, row) => {
    assert.equal(lzMutationSummary('t', reportOf(...statuses)), summaryOf('t', row));
  });

  lzTestEach([
    ['no object', 'report'],
    ['no files object', {}],
    ['an array for files', { files: [] }],
    ['a file that is no object', { files: { 'src/a.ts': [] } }],
    ['a file without a mutants array', { files: { 'src/a.ts': { mutants: {} } } }],
    ['a mutant that is no object', { files: { 'src/a.ts': { mutants: ['Killed'] } } }],
    ['a mutant without a status', { files: { 'src/a.ts': { mutants: [{}] } } }],
    ['a mutant with a status that is no string', { files: { 'src/a.ts': { mutants: [{ status: 1 }] } } }],
  ])('rejects a report with %s', (_, report) => {
    assert.throws(() => lzMutationSummary('t', report), {
      message: "The mutation report does not match Stryker's JSON report schema.",
    });
  });
});

const script = join(import.meta.dirname, 'mutation-summary.cli.ts');

function runSummary(args: readonly string[]): {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const { status, stdout, stderr } = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });

  return { code: status, stdout, stderr };
}

async function writeReport(t: TestContext, report: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lz-mutation-summary-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'report.json');
  await writeFile(path, JSON.stringify(report));

  return path;
}

describe('mutation-summary.cli.ts', () => {
  it('prints the summary of the report file under the title', async (t) => {
    const reportFile = await writeReport(t, reportOf('Killed', 'Survived'));

    assert.deepEqual(runSummary([reportFile, 'p:mutate-test-code']), {
      code: 0,
      stdout: summaryOf('p:mutate-test-code', '| 50.00 | 1 | 1 | 0 | 0 | 0 | 0 | 0 |'),
      stderr: '',
    });
  });

  lzTestEach([
    ['no arguments', []],
    ['no title', ['report.json']],
  ])('exits 1 with its usage when given %s', (_, args) => {
    const { code, stdout, stderr } = runSummary(args);

    assert.deepEqual(
      {
        code,
        stdout,
        usage: /^Error: Usage: node tools\/eslint-rules\/mutation-summary\.cli\.ts <report\.json> <title>$/m.test(
          stderr,
        ),
      },
      { code: 1, stdout: '', usage: true },
    );
  });
});
