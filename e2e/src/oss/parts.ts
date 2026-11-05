import { readFileSync } from 'node:fs';

import { parseSync } from '@babel/core';

import { lzParseReport } from '../report.ts';

/** Cuts fall between top-level statements because Stryker places a mutant only in a range that holds all of it. */
export function lzPartRanges(
  file: string,
  source: string,
  parts: number,
  mutantsByLine?: ReadonlyMap<number, number>,
): string[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new Error(`parts is a positive integer; got ${parts}.`);
  }

  const lineCount = source.split('\n').length;
  const weightOf = (line: number): number => (mutantsByLine === undefined ? 1 : (mutantsByLine.get(line) ?? 0));
  const weightBefore: number[] = [0];

  for (let line = 1; line <= lineCount; line++) {
    weightBefore.push((weightBefore[line - 1] ?? 0) + weightOf(line));
  }

  const total = weightBefore[lineCount] ?? 0;
  const candidates = linesStartingANewStatement(file, source);
  const cuts: number[] = [];

  for (let part = 1; part < parts; part++) {
    const target = (total * part) / parts;
    const distance = (line: number): number => Math.abs((weightBefore[line - 1] ?? 0) - target);
    const nearest = candidates
      .filter((line) => line > (cuts.at(-1) ?? 1))
      .reduce(
        (best: number | undefined, line) => (best === undefined || distance(line) < distance(best) ? line : best),
        undefined,
      );

    if (nearest === undefined) {
      break;
    }

    cuts.push(nearest);
  }

  const starts = [1, ...cuts];

  return starts.map((start, index) => `${file}:${start}-${(starts[index + 1] ?? lineCount + 1) - 1}`);
}

function linesStartingANewStatement(file: string, source: string): number[] {
  const ast = parseSync(source, { filename: file, configFile: false, babelrc: false, sourceType: 'unambiguous' });

  if (ast === null) {
    throw new Error(`${file} did not parse.`);
  }

  const statements = [...ast.program.directives, ...ast.program.body];

  return statements.flatMap((statement, index) => {
    const previous = statements[index - 1];
    const start = statement.loc?.start.line;
    const previousEnd = previous?.loc?.end.line;

    return start !== undefined && previousEnd !== undefined && previousEnd < start ? [start] : [];
  });
}

export function lzMutantsByLine(reportFile: string, file: string): Map<number, number> {
  const report = lzParseReport(readFileSync(reportFile, 'utf8'));
  const counts = new Map<number, number>();
  const key = [...report.keys()].find((name) => endsWithPath(name, file));

  for (const { line } of key === undefined ? [] : (report.get(key) ?? [])) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  return counts;
}

function endsWithPath(reportPath: string, file: string): boolean {
  return reportPath.replaceAll('\\', '/').endsWith(file);
}
