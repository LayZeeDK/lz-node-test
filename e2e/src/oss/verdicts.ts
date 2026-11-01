import type { LzMutantDetail, LzMutantStatus, LzReport } from '../report.ts';
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

export function lzReportScore(report: LzReport): LzScore & { readonly mutants: number } {
  const mutants = [...report.values()].flat();

  return { ...lzScore(mutants), mutants: mutants.length };
}

export function lzMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** Without a report on both sides there is nothing to compare, which an empty disagreement list would hide. */
export function lzComparison(bySide: LzBySide<LzSideReport>): LzComparison {
  const { lz, command } = bySide;

  if (lz === undefined || command === undefined) {
    const ran = lzSides.filter((side) => bySide[side] !== undefined);
    const missing = lzSides.filter((side) => bySide[side] === undefined);

    return {
      compared: false,
      reason: `Only the ${ran.join(' and ')} side ran; merge its result.json with a ${missing.join(' and ')} run with --merge.`,
    };
  }

  if (!lz.reported || !command.reported) {
    return { compared: false, reason: 'A side wrote no report.' };
  }

  try {
    const verdicts = lzCompare(lz.report, command.report);

    return { compared: true, disagreements: verdicts.filter((verdict) => verdict.lz !== verdict.command), verdicts };
  } catch (error) {
    return { compared: false, reason: lzMessageOf(error) };
  }
}
