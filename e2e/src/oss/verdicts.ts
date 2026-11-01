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

export type LzComparison =
  | { readonly compared: false; readonly reason: string }
  | { readonly compared: true; readonly disagreements: readonly LzVerdict[]; readonly verdicts: readonly LzVerdict[] };

/** A side left out did not run. */
export interface LzBySide<T> {
  readonly lz?: T;
  readonly command?: T;
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

export function lzMutantKey(
  file: string,
  { line, column, endLine, endColumn, mutator, replacement }: LzMutantDetail,
): string {
  return `${file}:${line}:${column}-${endLine}:${endColumn} ${mutator} ${replacement.replaceAll(/\s+/g, ' ')}`;
}

function statusesOf(report: LzReport): Map<string, LzMutantStatus> {
  const entries = [...report].flatMap(([file, mutants]) =>
    mutants.map((mutant): [string, LzMutantStatus] => [lzMutantKey(file, mutant), mutant.status]),
  );
  const statuses = new Map(entries);

  if (statuses.size !== entries.length) {
    const keys = entries.map(([key]) => key);
    const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);

    throw new Error(`Two mutants share the key "${duplicate ?? ''}"; the comparison would drop one.`);
  }

  return statuses;
}

/**
 * A side that is null ran and wrote no report. Without a report on both sides there is nothing to compare, which an
 * empty disagreement list would hide.
 */
export function lzComparison({ lz, command }: LzBySide<LzReport | null>): LzComparison {
  if (lz === undefined || command === undefined) {
    const [ran, other] = lz === undefined ? ['command', 'lz'] : ['lz', 'command'];

    return {
      compared: false,
      reason: `Only the ${ran} side ran; merge its result.json with a ${other} run with --merge.`,
    };
  }

  if (lz === null || command === null) {
    return { compared: false, reason: 'A side wrote no report.' };
  }

  try {
    const verdicts = lzCompare(lz, command);

    return { compared: true, disagreements: verdicts.filter((verdict) => verdict.lz !== verdict.command), verdicts };
  } catch (error) {
    return { compared: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
