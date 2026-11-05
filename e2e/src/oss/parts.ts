import { readFileSync } from 'node:fs';

import { parseSync } from '@babel/core';

import { lzParseReport } from '../report.ts';

/**
 * `--mutate` line ranges that split `file` into at most `parts` parts. A cut falls only where a top-level statement
 * starts on a line after the previous one ends, so no mutant spans two parts: a line range places only the mutants
 * inside it. Each cut is the allowed line nearest an even share of the weight, which is the mutants that start on
 * each line when `mutantsByLine` is given, else one a line.
 */
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
  const before: number[] = [0];

  for (let line = 1; line <= lineCount; line++) {
    before.push((before[line - 1] ?? 0) + weightOf(line));
  }

  const total = before[lineCount] ?? 0;
  const candidates = cutLines(file, source);
  const cuts: number[] = [];

  for (let part = 1; part < parts; part++) {
    const target = (total * part) / parts;
    const open = candidates.filter((line) => line > (cuts.at(-1) ?? 1));
    const nearest = open.reduce<number | undefined>(
      (best, line) =>
        best === undefined || Math.abs((before[line - 1] ?? 0) - target) < Math.abs((before[best - 1] ?? 0) - target)
          ? line
          : best,
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

/** The lines where a top-level statement or directive starts after the previous one has ended. */
function cutLines(file: string, source: string): number[] {
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

/** Mutants that start on each line of `file`, from a mutation.json whose file key ends with `file`. */
export function lzMutantsByLine(reportFile: string, file: string): Map<number, number> {
  const report = lzParseReport(readFileSync(reportFile, 'utf8'));
  const counts = new Map<number, number>();
  const key = [...report.keys()].find((name) => name.replaceAll('\\', '/').endsWith(file));

  for (const { line } of key === undefined ? [] : (report.get(key) ?? [])) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  return counts;
}
