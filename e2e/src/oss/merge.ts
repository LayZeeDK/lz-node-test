import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { lzIsRecord, lzParseReport, type LzReport } from '../report.ts';
import { lzSides, type LzSide } from './options.ts';
import type { LzMergeResult } from './result.ts';
import { lzBySide, lzComparison, lzMutantKey, lzReportScore } from './verdicts.ts';

/** One side's report from one run. */
interface LzBatch {
  /** The result.json it came from. */
  readonly file: string;
  readonly side: LzSide;
  readonly report: LzReport;
}

interface LzRun {
  readonly project: string;
  readonly reports: readonly LzBatch[];
}

/** Merges the driver's result.json files into one comparison, written to `out`'s result.json, whose path it returns. */
export function lzMerge(files: readonly string[], out: string): string {
  const runs = files.map(readRun);
  const projects = [...new Set(runs.map(({ project }) => project))];
  const [project] = projects;

  if (project === undefined || projects.length !== 1) {
    throw new Error(`--merge takes runs of one project; found ${projects.join(' and ')}.`);
  }

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
  const result: unknown = JSON.parse(readFileSync(file, 'utf8'));

  if (lzIsRecord(result) && 'mergedFrom' in result) {
    throw new Error(
      `${file} is the result of a merge; merges do not compose, so merge the runs it lists in mergedFrom.`,
    );
  }

  if (!lzIsRecord(result) || typeof result['project'] !== 'string' || !lzIsRecord(result['sides'])) {
    throw new Error(`${file} is not the result.json of a driver run.`);
  }

  const { sides } = result;
  const ran = lzSides.filter((side) => side in sides);

  if (ran.length === 0) {
    throw new Error(`${file} holds no side's results.`);
  }

  return {
    project: result['project'],
    reports: ran.map((side) => ({
      file,
      side,
      report: lzParseReport(readFileSync(join(dirname(file), `${side}.mutation.json`), 'utf8')),
    })),
  };
}

/** One report of all the side's batches. */
function reportOf(reports: readonly LzBatch[], side: LzSide): LzReport {
  const ofSide = reports.filter((report) => report.side === side);
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
