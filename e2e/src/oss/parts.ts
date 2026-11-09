import { readFileSync } from 'node:fs';

import { parseSync } from '@babel/core';

import { lzParseReport } from '../report.ts';

/** Cuts fall between top-level statements because Stryker places a mutant only in a range that holds all of it. */
export function lzPartRanges(
  file: string,
  source: string,
  parts: number,
  weightOf: (line: number) => number = lzLineWeights(undefined),
): string[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new Error(`parts is a positive integer; got ${parts}.`);
  }

  const { lineCount, candidates } = statementStarts(file, source);
  const weightBefore: number[] = [0];
  const sumBefore = (line: number): number => {
    const index = line - 1;

    // Stryker disable next-line LzJsNumericLiteral: unreachable, as every line from 1 to lineCount + 1 has a sum
    return weightBefore[index] ?? 0;
  };

  for (let line = 1; line <= lineCount; line++) {
    // Stryker disable next-line ArithmeticOperator: equivalent, as negating every sum negates the targets too, so every distance stays
    weightBefore.push(sumBefore(line) + weightOf(line));
  }

  const total = sumBefore(lineCount + 1);
  const cuts: number[] = [];

  for (let part = 1; part < parts; part++) {
    const target = (total * part) / parts;
    const distance = (line: number): number => Math.abs(sumBefore(line) - target);
    const nearest = candidates
      .filter((line) => cuts.every((cut) => line > cut))
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

/** Line numbers as Babel counts them, which Stryker's locations use: U+2028 and a lone CR end a line too. */
function statementStarts(file: string, source: string): { lineCount: number; candidates: number[] } {
  const ast = parseSync(source, { filename: file, configFile: false, babelrc: false, sourceType: 'unambiguous' });
  const lineCount = ast?.program.loc?.end.line;

  if (ast === null || lineCount === undefined) {
    // Stryker disable next-line StringLiteral: unreachable, as with config files off nothing ignores the file, so Babel returns a program or throws
    throw new Error(`${file} did not parse.`);
  }

  const statements = [...ast.program.directives, ...ast.program.body];
  const candidates = statements.flatMap((statement, index) => {
    const previous = statements[index - 1];
    const start = statement.loc?.start.line;
    const previousEnd = previous?.loc?.end.line;

    return start !== undefined && previousEnd !== undefined && previousEnd < start ? [start] : [];
  });

  return { lineCount, candidates };
}

/** Weighs each line by its mutants in `counts`, a line without any by 0; without counts, every line alike. */
export function lzLineWeights(counts: ReadonlyMap<number, number> | undefined): (line: number) => number {
  if (counts === undefined) {
    // Stryker disable next-line LzJsNumericLiteral: equivalent, as a weight every line shares scales every target and distance alike
    return () => 1;
  }

  return (line) => counts.get(line) ?? 0;
}

export function lzMutantsByLine(reportFile: string, file: string): Map<number, number> {
  const report = lzParseReport(readFileSync(reportFile, 'utf8'));
  const mutants = report.get(file);

  if (mutants === undefined) {
    throw new Error(`${reportFile} has no file "${file}"; it has ${[...report.keys()].join(', ')}.`);
  }

  const counts = new Map<number, number>();

  for (const { line } of mutants) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  return counts;
}
