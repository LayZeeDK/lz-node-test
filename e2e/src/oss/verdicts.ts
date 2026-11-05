import { lzMutantLabel, lzMutantsByKey, type LzMutantDetail, type LzMutantStatus, type LzReport } from '../report.ts';
import { lzSides, type LzSide } from './options.ts';

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
export type LzBySide<T> = { readonly [TSide in LzSide]?: T };

/** What a side that ran left to compare; no report when Stryker threw or wrote none. */
export type LzSideReport = { readonly reported: true; readonly report: LzReport } | { readonly reported: false };

/** Keys each item's value by its side, in the items' order. */
export function lzBySide<TItem extends { readonly side: LzSide }, T>(
  items: readonly TItem[],
  of: (item: TItem) => T,
): LzBySide<T> {
  return items.reduce<LzBySide<T>>((bySide, item) => ({ ...bySide, [item.side]: of(item) }), {});
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

export interface LzMutantsScore extends LzScore {
  readonly mutants: number;
}

export function lzReportScore(report: LzReport): LzMutantsScore {
  const mutants = [...report.values()].flat();

  return { ...lzScore(mutants), mutants: mutants.length };
}

export function lzMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function lzCompare(lz: LzReport, command: LzReport): LzVerdict[] {
  const lzStatuses = lzMutantsByKey(lz);
  const commandStatuses = lzMutantsByKey(command);
  const labels = new Map(
    [...lzStatuses, ...commandStatuses].map(([key, { file, mutant }]) => [key, lzMutantLabel(file, mutant)]),
  );

  return [...labels].map(([key, label]) => ({
    mutant: label,
    lz: lzStatuses.get(key)?.mutant.status ?? null,
    command: commandStatuses.get(key)?.mutant.status ?? null,
  }));
}

/** Without a report on both sides there is nothing to compare, which an empty disagreement list would hide. */
export function lzComparison(bySide: LzBySide<LzSideReport>): LzComparison {
  const ran = lzSides.filter((side) => bySide[side] !== undefined);
  const missing = lzSides.filter((side) => bySide[side] === undefined);

  if (ran.length === 0) {
    return { compared: false, reason: 'No side ran.' };
  }

  if (missing.length > 0) {
    return {
      compared: false,
      reason: `Only the ${ran.join(' and ')} side ran; merge its result.json with a ${missing.join(' and ')} run with --merge.`,
    };
  }

  const { lz, command } = bySide;

  if (lz === undefined || command === undefined || !lz.reported || !command.reported) {
    return { compared: false, reason: 'A side wrote no report.' };
  }

  try {
    const verdicts = lzCompare(lz.report, command.report);

    return { compared: true, disagreements: verdicts.filter((verdict) => verdict.lz !== verdict.command), verdicts };
  } catch (error) {
    return { compared: false, reason: lzMessageOf(error) };
  }
}
