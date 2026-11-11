import { lzMutantsByKey, lzOneLine, type LzMutantStatus, type LzReport } from './report.ts';

interface Entry {
  readonly label: string;
  readonly status: LzMutantStatus;
}

/**
 * Each mutant whose status differs, or that one report lacks. Mutants are keyed as Stryker's incremental mode keys
 * them: file, location, mutator and replacement, which tells apart the mutants one mutator makes at one place.
 */
export function lzCompareReports(first: LzReport, second: LzReport): string[] {
  const firstEntries = entriesByKey(first);
  const secondEntries = entriesByKey(second);
  const differences: string[] = [];

  const labels = new Map([...firstEntries, ...secondEntries].map(([key, { label }]) => [key, label]));

  for (const [key, label] of labels) {
    const firstStatus = firstEntries.get(key)?.status ?? 'absent';
    const secondStatus = secondEntries.get(key)?.status ?? 'absent';

    if (firstStatus !== secondStatus) {
      differences.push(`${label}: ${firstStatus} -> ${secondStatus}`);
    }
  }

  return differences;
}

function entriesByKey(report: LzReport): Map<string, Entry> {
  return new Map(
    [...lzMutantsByKey(report)].map(([key, { file, mutant }]): [string, Entry] => {
      const { line, column, endLine, endColumn, mutator, replacement, status } = mutant;
      const label = `${file}@${line}:${column}-${endLine}:${endColumn} ${mutator}: ${lzOneLine(replacement)}`;

      return [key, { label, status }];
    }),
  );
}
