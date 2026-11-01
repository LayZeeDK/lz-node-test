import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { lzIsRecord, lzParseReport, type LzReport } from '../report.ts';
import { lzSides, type LzSide } from './options.ts';
import { lzComparison, lzScore, type LzScore } from './verdicts.ts';

interface LzSideReport {
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
      side,
      report: lzParseReport(readFileSync(join(dirname(file), `${side}.mutation.json`), 'utf8')),
    })),
  };
}

function reportOf(reports: readonly LzSideReport[], side: LzSide): LzReport | undefined {
  const ofSide = reports.filter((report) => report.side === side);

  if (ofSide.length > 1) {
    throw new Error(`--merge takes one run of each side; ${ofSide.length} hold the ${side} side.`);
  }

  return ofSide[0]?.report;
}

function scoreOf(report: LzReport): LzScore & { readonly mutants: number } {
  const mutants = [...report.values()].flat();

  return { ...lzScore(mutants), mutants: mutants.length };
}
