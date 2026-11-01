import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';

/**
 * Each test imports the check itself: a mutant that runs the command branch on import then fails the tests, where a
 * static import would end the file outside any test.
 */
async function unrecordedRuntimeErrors(report: unknown, recorded: unknown): Promise<readonly string[]> {
  const { lzUnrecordedRuntimeErrors } = await import('./runtime-errors.ts');

  return lzUnrecordedRuntimeErrors(report, recorded);
}

async function checkRuntimeErrors(reportFile: string, recordedFile: string): Promise<readonly string[]> {
  const { lzCheckRuntimeErrors } = await import('./runtime-errors.ts');

  return lzCheckRuntimeErrors(reportFile, recordedFile);
}

const file = 'packages/a/src/watch.ts';
const reason = 'node exited with code 1 outside any test.';

function mutant(status: string, mutatorName = 'ArithmeticOperator', line = 24, column = 28): object {
  return {
    id: '1',
    mutatorName,
    replacement: 'a * b',
    status,
    statusReason: reason,
    location: { start: { line, column }, end: { line, column: column + 5 } },
  };
}

function reportOf(mutants: readonly unknown[], path = file): object {
  return { schemaVersion: '1.0', files: { [path]: { language: 'typescript', source: '', mutants } } };
}

const recorded = { file, mutator: 'ArithmeticOperator', line: 24, column: 28, reason: 'Ends the test process.' };
const unrecordedLine = `${file}:24:28 ArithmeticOperator: ${reason}`;

const malformedReport = "The mutation report does not match Stryker's JSON report schema.";
const malformedList =
  'runtime-errors.json: each entry needs a file, a mutator, a line, a column and a reason, as the report gives them.';

describe('lzUnrecordedRuntimeErrors', () => {
  it('returns nothing for a report without RuntimeError mutants', async () => {
    const report = reportOf([mutant('Killed'), mutant('Survived'), mutant('Timeout'), mutant('CompileError')]);

    assert.deepEqual(await unrecordedRuntimeErrors(report, []), []);
  });

  it('names a RuntimeError mutant that the list does not record by file, location, mutator and reason', async () => {
    assert.deepEqual(await unrecordedRuntimeErrors(reportOf([mutant('RuntimeError')]), []), [unrecordedLine]);
  });

  it('leaves out the reason when the report gives none', async () => {
    const report = reportOf([{ ...mutant('RuntimeError'), statusReason: undefined }]);

    assert.deepEqual(await unrecordedRuntimeErrors(report, []), [`${file}:24:28 ArithmeticOperator`]);
  });

  it('accepts a RuntimeError mutant that the list records', async () => {
    assert.deepEqual(await unrecordedRuntimeErrors(reportOf([mutant('RuntimeError')]), [recorded]), []);
  });

  lzTestEach([
    ['file', { ...recorded, file: 'packages/a/src/other.ts' }],
    ['mutator', { ...recorded, mutator: 'EqualityOperator' }],
    ['line', { ...recorded, line: 25 }],
    ['column', { ...recorded, column: 7 }],
  ])('still names a RuntimeError mutant when the recorded entry has another %s', async (_, entry) => {
    assert.deepEqual(await unrecordedRuntimeErrors(reportOf([mutant('RuntimeError')]), [entry]), [unrecordedLine]);
  });

  it('names the RuntimeError mutants of every file, in report order', async () => {
    const report = {
      files: {
        [file]: {
          mutants: [mutant('RuntimeError'), mutant('Killed'), mutant('RuntimeError', 'EqualityOperator', 26, 7)],
        },
        'packages/a/src/b.ts': { mutants: [mutant('RuntimeError', 'BlockStatement', 3, 1)] },
      },
    };

    assert.deepEqual(await unrecordedRuntimeErrors(report, []), [
      unrecordedLine,
      `${file}:26:7 EqualityOperator: ${reason}`,
      `packages/a/src/b.ts:3:1 BlockStatement: ${reason}`,
    ]);
  });

  lzTestEach([
    ['no object', 'report'],
    ['null', null],
    ['no files object', {}],
    ['an array for files', { files: [] }],
    ['a file without a mutants array', { files: { [file]: {} } }],
    ['a mutant that is no object', reportOf(['RuntimeError'])],
    ['a mutant without a mutator name', reportOf([{ ...mutant('RuntimeError'), mutatorName: 1 }])],
    ['a mutant without a status', reportOf([{ ...mutant('RuntimeError'), status: undefined }])],
    ['a mutant with a status reason that is no string', reportOf([{ ...mutant('RuntimeError'), statusReason: 1 }])],
    ['a mutant without a location', reportOf([{ ...mutant('RuntimeError'), location: undefined }])],
    ['a location without a start', reportOf([{ ...mutant('RuntimeError'), location: {} }])],
    ['a start without a line', reportOf([{ ...mutant('RuntimeError'), location: { start: { column: 1 } } }])],
    ['a start without a column', reportOf([{ ...mutant('RuntimeError'), location: { start: { line: 1 } } }])],
  ])('rejects a report with %s', async (_, report) => {
    await assert.rejects(unrecordedRuntimeErrors(report, []), { message: malformedReport });
  });

  lzTestEach([
    ['no array', {}],
    ['an entry that is no object', ['entry']],
    ['an entry without a file', [{ ...recorded, file: undefined }]],
    ['an entry without a mutator', [{ ...recorded, mutator: undefined }]],
    ['an entry without a line', [{ ...recorded, line: '24' }]],
    ['an entry without a column', [{ ...recorded, column: undefined }]],
    ['an entry without a reason', [{ ...recorded, reason: undefined }]],
    ['an entry with an empty reason', [{ ...recorded, reason: '' }]],
  ])('rejects a list with %s', async (_, list) => {
    await assert.rejects(unrecordedRuntimeErrors(reportOf([]), list), { message: malformedList });
  });
});

async function tempDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lz-runtime-errors-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  return dir;
}

async function writeJson(dir: string, name: string, value: unknown): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, JSON.stringify(value));

  return path;
}

describe('lzCheckRuntimeErrors', () => {
  it('reads the report and the list from their files', async (t) => {
    const dir = await tempDir(t);
    const reportFile = await writeJson(dir, 'report.json', reportOf([mutant('RuntimeError')]));

    assert.deepEqual(await checkRuntimeErrors(reportFile, await writeJson(dir, 'none.json', [])), [unrecordedLine]);
    assert.deepEqual(await checkRuntimeErrors(reportFile, await writeJson(dir, 'list.json', [recorded])), []);
  });
});

const script = join(import.meta.dirname, 'runtime-errors.ts');

function runCheck(args: readonly string[]): { readonly code: number | null; readonly stderr: string } {
  const { status, stderr } = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', windowsHide: true });

  return { code: status, stderr };
}

describe('runtime-errors.ts as a command', () => {
  it('exits 0 and prints nothing when every RuntimeError mutant is recorded', async (t) => {
    const reportFile = await writeJson(await tempDir(t), 'report.json', reportOf([mutant('Killed')]));

    assert.deepEqual(runCheck([reportFile]), { code: 0, stderr: '' });
  });

  it('exits 1 and names each unrecorded RuntimeError mutant on its own line', async (t) => {
    const report = reportOf([mutant('RuntimeError'), mutant('RuntimeError', 'EqualityOperator', 26, 7)]);
    const reportFile = await writeJson(await tempDir(t), 'report.json', report);

    assert.deepEqual(runCheck([reportFile]), {
      code: 1,
      stderr:
        'Stryker left RuntimeError mutants out of the mutation score. Kill each one with a test, or record why it ' +
        `cannot be killed in tools/eslint-rules/runtime-errors.json:\n  ${unrecordedLine}\n` +
        `  ${file}:26:7 EqualityOperator: ${reason}\n`,
    });
  });

  it('exits 1 with its usage as the error message when no report is given', () => {
    const { code, stderr } = runCheck([]);

    assert.deepEqual(
      { code, usage: /^Error: Usage: node tools\/eslint-rules\/runtime-errors\.ts <report\.json>$/m.test(stderr) },
      { code: 1, usage: true },
    );
  });
});
