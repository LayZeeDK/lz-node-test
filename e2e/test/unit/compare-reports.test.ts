import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzCompareReports } from '../../src/compare-reports.ts';
import { lzParseReport, type LzReport } from '../../src/report.ts';

function mutant(status: string, line = 2, replacement = '"Stryker was here!"'): Record<string, unknown> {
  return {
    id: '1',
    mutatorName: 'StringLiteral',
    replacement,
    status,
    location: { start: { line, column: 10 }, end: { line, column: 15 } },
  };
}

function reportJson(files: Readonly<Record<string, readonly unknown[]>>): string {
  return JSON.stringify({
    schemaVersion: '2',
    thresholds: { high: 80, low: 60 },
    files: Object.fromEntries(
      Object.entries(files).map(([file, mutants]) => [file, { language: 'typescript', source: '', mutants }]),
    ),
  });
}

function report(files: Readonly<Record<string, readonly unknown[]>>): LzReport {
  return lzParseReport(reportJson(files));
}

function compareFiles(
  t: TestContext,
  firstJson: string,
  secondJson: string,
): { status: number | null; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lz-compare-reports-'));
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(join(dir, 'first.json'), firstJson);
  writeFileSync(join(dir, 'second.json'), secondJson);
  const { status, stdout } = spawnSync(
    process.execPath,
    [join(import.meta.dirname, '../../src/compare-reports-cli.ts'), join(dir, 'first.json'), join(dir, 'second.json')],
    { encoding: 'utf8', windowsHide: true },
  );

  return { status, stdout };
}

describe('lzCompareReports', () => {
  it('finds no difference between two reports with the same mutants and statuses', () => {
    const first = report({ 'src/grow.ts': [mutant('Killed'), mutant('Survived', 3)] });
    const second = report({ 'src/grow.ts': [mutant('Killed'), mutant('Survived', 3)] });

    assert.deepEqual(lzCompareReports(first, second), []);
  });

  it('names a mutant whose status differs by file, location, mutator and replacement', () => {
    const first = report({ 'src/grow.ts': [mutant('Killed'), mutant('Survived', 3)] });
    const second = report({ 'src/grow.ts': [mutant('Killed'), mutant('Killed', 3)] });

    assert.deepEqual(lzCompareReports(first, second), [
      'src/grow.ts@3:10-3:15 StringLiteral: "Stryker was here!": Survived -> Killed',
    ]);
  });

  it('names a mutant that only one of the reports has as absent from the other', () => {
    const first = report({ 'src/grow.ts': [mutant('Killed'), mutant('Survived', 3)] });
    const second = report({ 'src/grow.ts': [mutant('Killed')], 'src/shrink.ts': [mutant('NoCoverage')] });

    assert.deepEqual(lzCompareReports(first, second), [
      'src/grow.ts@3:10-3:15 StringLiteral: "Stryker was here!": Survived -> absent',
      'src/shrink.ts@2:10-2:15 StringLiteral: "Stryker was here!": absent -> NoCoverage',
    ]);
  });

  it('tells apart mutants at one location that differ in their replacement only', () => {
    const first = report({ 'src/grow.ts': [mutant('Killed', 2, '""'), mutant('Survived', 2, '"x"')] });
    const second = report({ 'src/grow.ts': [mutant('Killed', 2, '""'), mutant('Killed', 2, '"x"')] });

    assert.deepEqual(lzCompareReports(first, second), ['src/grow.ts@2:10-2:15 StringLiteral: "x": Survived -> Killed']);
  });

  it('prints a replacement that spans lines on one line', () => {
    const first = report({ 'src/grow.ts': [mutant('Survived', 2, 'items\n  .map(grow)')] });
    const second = report({ 'src/grow.ts': [mutant('Killed', 2, 'items\n  .map(grow)')] });

    assert.deepEqual(lzCompareReports(first, second), [
      'src/grow.ts@2:10-2:15 StringLiteral: items .map(grow): Survived -> Killed',
    ]);
  });
});

describe('compare-reports-cli.ts', () => {
  it('prints each difference between two report files and exits with 1', (t) => {
    const result = compareFiles(
      t,
      reportJson({ 'src/grow.ts': [mutant('Survived')] }),
      reportJson({ 'src/grow.ts': [mutant('Killed')] }),
    );

    assert.deepEqual(result, {
      status: 1,
      stdout: 'src/grow.ts@2:10-2:15 StringLiteral: "Stryker was here!": Survived -> Killed\n',
    });
  });

  it('prints nothing and exits with 0 when the report files agree', (t) => {
    const json = reportJson({ 'src/grow.ts': [mutant('Killed')] });

    assert.deepEqual(compareFiles(t, json, json), { status: 0, stdout: '' });
  });
});
