import type { LzMutantDetail, LzMutantStatus, LzReport } from './report.ts';

/**
 * Each mutant whose status differs, or that one report lacks. Mutants are keyed as Stryker's incremental mode keys
 * them: file, location, mutator and replacement, which tells apart the mutants one operator makes at one place.
 */
export function lzCompareReports(first: LzReport, second: LzReport): string[] {
  const firstStatuses = statusesByKey(first);
  const secondStatuses = statusesByKey(second);
  const differences: string[] = [];

  for (const key of new Set([...firstStatuses.keys(), ...secondStatuses.keys()])) {
    const firstStatus = firstStatuses.get(key) ?? 'absent';
    const secondStatus = secondStatuses.get(key) ?? 'absent';

    if (firstStatus !== secondStatus) {
      differences.push(`${key}: ${firstStatus} -> ${secondStatus}`);
    }
  }

  return differences;
}

function statusesByKey(report: LzReport): Map<string, LzMutantStatus> {
  return new Map(
    [...report].flatMap(([file, mutants]) => mutants.map((mutant) => [mutantKey(file, mutant), mutant.status])),
  );
}

function mutantKey(file: string, { line, column, endLine, endColumn, mutator, replacement }: LzMutantDetail): string {
  return `${file}@${line}:${column}-${endLine}:${endColumn} ${mutator}: ${replacement.replaceAll(/\s+/g, ' ')}`;
}
