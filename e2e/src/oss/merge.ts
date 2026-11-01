import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { lzIsRecord, lzParseReport, type LzReport } from '../report.ts';
import { lzSides, type LzSide } from './options.ts';
import { lzComparison, lzMutantKey, lzScore, type LzScore } from './verdicts.ts';

interface LzSideReport {
  /** The result.json it came from. */
  readonly file: string;
  readonly side: LzSide;
  readonly report: LzReport;
}

interface LzRun {
  readonly project: string;
  readonly reports: readonly LzSideReport[];
}

/** Merges the driver's result.json files into one comparison, written to `out`'s result.json, whose path it returns. */
export function lzMerge(files: readonly string[], out: string): string {
  const runs = files.map(readRun);
  const projects = [...new Set(runs.map(({ project }) => project))];

  if (projects.length !== 1) {
    throw new Error(`--merge takes runs of one project; found ${projects.join(' and ')}.`);
  }

  const reports = runs.flatMap((run) => run.reports);
  const lz = reportOf(reports, 'lz');
  const command = reportOf(reports, 'command');
  const bySide = { ...(lz === undefined ? {} : { lz }), ...(command === undefined ? {} : { command }) };
  const file = join(out, 'result.json');
  const result = {
    project: projects[0],
    mergedFrom: files,
    scores: Object.fromEntries(Object.entries(bySide).map(([side, report]) => [side, scoreOf(report)])),
    ...lzComparison(bySide),
  };

  mkdirSync(out, { recursive: true });
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);

  return file;
}

function readRun(file: string): LzRun {
  const result: unknown = JSON.parse(readFileSync(file, 'utf8'));

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

/** One report of all the side's batches, or undefined when no run holds the side. */
function reportOf(reports: readonly LzSideReport[], side: LzSide): LzReport | undefined {
  const ofSide = reports.filter((report) => report.side === side);

  if (ofSide.length === 0) {
    return undefined;
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

function scoreOf(report: LzReport): LzScore & { readonly mutants: number } {
  const mutants = [...report.values()].flat();

  return { ...lzScore(mutants), mutants: mutants.length };
}
