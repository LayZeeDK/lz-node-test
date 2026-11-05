import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { lzIsRecord, lzParseReport, type LzReport } from '../report.ts';
import { lzSides, type LzSide } from './options.ts';
import { lzDecidingFields, lzParseOssResult, type LzDecidingFields, type LzMergeResult } from './result.ts';
import { lzBySide, lzComparison, lzMutantKey, lzReportScore } from './verdicts.ts';

/** One side's report from one run. */
interface LzBatch {
  /** The result.json it came from. */
  readonly file: string;
  readonly side: LzSide;
  /** Batches of one side must share it, whichever workspace commit wrote them. */
  readonly strykerConfig: string;
  readonly report: LzReport;
}

interface LzRun {
  readonly project: string;
  readonly deciding: ReadonlyMap<keyof LzDecidingFields, unknown>;
  readonly reports: readonly LzBatch[];
}

/** Merges the driver's result.json files into one comparison, written to `out`'s result.json, whose path it returns. */
export function lzMerge(files: readonly string[], out: string): string {
  const resolved = files.map((file) => resolve(file));
  const repeated = resolved.find((file, index) => resolved.indexOf(file) !== index);

  if (repeated !== undefined) {
    throw new Error(`--merge got ${repeated} more than once; give each result.json once.`);
  }

  const runs = files.map(readRun);
  const [first] = runs;

  if (first === undefined) {
    throw new Error('--merge takes at least one result.json.');
  }

  lzDecidingFields.forEach((field) => {
    const values = runs.map(({ deciding }) => deciding.get(field));
    const json = values.map((value) => JSON.stringify(value));
    const distinct = json.flatMap((text, index) => (json.indexOf(text) === index ? [values[index]] : []));

    if (distinct.length !== 1) {
      throw new Error(`--merge takes runs of one ${field}; found ${distinct.map(shown).join(' and ')}.`);
    }
  });
  const { project } = first;
  const reports = runs.flatMap((run) => run.reports);
  const merged = lzSides
    .filter((side) => reports.some((report) => report.side === side))
    .map((side) => ({ side, report: reportOf(reports, side) }));
  const file = join(out, 'result.json');
  const result: LzMergeResult = {
    project,
    mergedFrom: files,
    scores: lzBySide(merged, ({ report }) => lzReportScore(report)),
    ...lzComparison(lzBySide(merged, ({ report }) => ({ reported: true, report }))),
  };

  mkdirSync(out, { recursive: true });
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);

  return file;
}

function readRun(file: string): LzRun {
  const { project, deciding, sides } = lzParseOssResult(file, JSON.parse(readFileSync(file, 'utf8')));
  const ran = lzSides.filter((side) => side in sides);

  if (ran.length === 0) {
    throw new Error(`${file} holds no side's results.`);
  }

  return {
    project,
    deciding,
    reports: ran.map((side) => {
      const entry = sides[side];
      const reportFile = `${side}.mutation.json`;

      if (!lzIsRecord(entry) || !lzIsRecord(entry['stryker']) || entry['stryker']['reported'] !== true) {
        throw new Error(`The ${side} side of ${file} wrote no report, so its ${reportFile} is not this run's.`);
      }

      const strykerConfig = entry['strykerConfig'];

      if (typeof strykerConfig !== 'string') {
        throw new Error(`The ${side} side of ${file} records no strykerConfig, so a merge cannot tell what it ran.`);
      }

      const reportPath = join(dirname(file), reportFile);

      if (!existsSync(reportPath)) {
        throw new Error(`The ${side} side of ${file} has no ${reportFile} beside it.`);
      }

      return { file, side, strykerConfig, report: lzParseReport(readFileSync(reportPath, 'utf8')) };
    }),
  };
}

/** For a refusal only, which names a commit or version plainly; the match itself compares JSON. */
function shown(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** One report of all the side's batches. */
function reportOf(reports: readonly LzBatch[], side: LzSide): LzReport {
  const ofSide = reports.filter((report) => report.side === side);
  const [first] = ofSide;
  const other = ofSide.find(({ strykerConfig }) => strykerConfig !== first?.strykerConfig);

  if (first !== undefined && other !== undefined) {
    throw new Error(
      `--merge takes runs of one Stryker configuration per side; the ${side} sides of ${first.file} and ${other.file} ran different ones.`,
    );
  }

  const holders = new Map<string, string>();

  ofSide.forEach(({ file, report }) => {
    report.forEach((mutants, path) => {
      mutants.forEach((mutant) => {
        const key = lzMutantKey(path, mutant);
        const holder = holders.get(key);

        // Two mutants at one key inside one report are for the comparison to refuse.
        if (holder !== undefined && holder !== file) {
          throw new Error(`The ${side} side of ${holder} and ${file} both hold ${key}; batches must not overlap.`);
        }

        holders.set(key, file);
      });
    });
  });
  const paths = new Set(ofSide.flatMap(({ report }) => [...report.keys()]));

  return new Map([...paths].map((path) => [path, ofSide.flatMap(({ report }) => report.get(path) ?? [])]));
}
