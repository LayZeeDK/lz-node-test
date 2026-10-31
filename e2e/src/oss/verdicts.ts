import type { LzMutantDetail, LzMutantStatus, LzReport } from '../report.ts';

export interface LzScore {
  readonly counts: Readonly<Record<string, number>>;
  /** Stryker's mutation score: Killed and Timeout over those plus Survived and NoCoverage; null with none of them. */
  readonly score: number | null;
}

export interface LzVerdict {
  /** `file:line:column-endLine:endColumn mutator replacement`, as both reports locate the mutant. */
  readonly mutant: string;
  readonly lz: LzMutantStatus | null;
  readonly command: LzMutantStatus | null;
}

export function lzScore(mutants: readonly LzMutantDetail[]): LzScore {
  const count = (status: LzMutantStatus): number => mutants.filter((mutant) => mutant.status === status).length;
  const detected = count('Killed') + count('Timeout');
  const valid = detected + count('Survived') + count('NoCoverage');

  return {
    counts: Object.fromEntries(
      [...new Set(mutants.map(({ status }) => status))].sort().map((status) => [status, count(status)]),
    ),
    score: valid === 0 ? null : (detected / valid) * 100,
  };
}

export function lzCompare(lz: LzReport, command: LzReport): LzVerdict[] {
  const lzStatuses = statusesOf(lz);
  const commandStatuses = statusesOf(command);
  const mutants = [...new Set([...lzStatuses.keys(), ...commandStatuses.keys()])];

  return mutants.map((mutant) => ({
    mutant,
    lz: lzStatuses.get(mutant) ?? null,
    command: commandStatuses.get(mutant) ?? null,
  }));
}

function statusesOf(report: LzReport): Map<string, LzMutantStatus> {
  return new Map(
    [...report].flatMap(([file, mutants]) =>
      mutants.map(({ line, column, endLine, endColumn, mutator, replacement, status }): [string, LzMutantStatus] => [
        `${file}:${line}:${column}-${endLine}:${endColumn} ${mutator} ${replacement.replaceAll(/\s+/g, ' ')}`,
        status,
      ]),
    ),
  );
}
