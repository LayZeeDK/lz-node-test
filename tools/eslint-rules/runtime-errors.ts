import { readFile } from 'node:fs/promises';

import { lzIsRecord, lzParseReport } from './stryker-report.ts';

// Stryker leaves a RuntimeError mutant out of the mutation score, so a break threshold of 100 cannot see one. This
// check fails a run on each RuntimeError mutant that the list does not record with a reason.

interface Recorded {
  readonly file: string;
  readonly mutator: string;
  readonly line: number;
  readonly column: number;
}

const malformedList =
  'runtime-errors.json: each entry needs a file, a mutator, a line, a column and a reason, as the report gives them.';

function parseRecorded(entry: unknown): Recorded {
  if (
    !lzIsRecord(entry) ||
    typeof entry['file'] !== 'string' ||
    typeof entry['mutator'] !== 'string' ||
    typeof entry['line'] !== 'number' ||
    typeof entry['column'] !== 'number' ||
    typeof entry['reason'] !== 'string' ||
    entry['reason'] === ''
  ) {
    throw new Error(malformedList);
  }

  return { file: entry['file'], mutator: entry['mutator'], line: entry['line'], column: entry['column'] };
}

/** One line per RuntimeError mutant of the JSON report that no entry of the list records. */
export function lzUnrecordedRuntimeErrors(report: unknown, recorded: unknown): readonly string[] {
  if (!Array.isArray(recorded)) {
    throw new Error(malformedList);
  }

  const list = recorded.map(parseRecorded);

  return lzParseReport(report).flatMap(([file, mutants]) =>
    mutants
      .filter(
        (mutant) =>
          mutant.status === 'RuntimeError' &&
          !list.some(
            (entry) =>
              entry.file === file &&
              entry.mutator === mutant.mutatorName &&
              entry.line === mutant.line &&
              entry.column === mutant.column,
          ),
      )
      .map(({ mutatorName, statusReason, line, column }) => {
        const where = `${file}:${line}:${column} ${mutatorName}`;

        return statusReason === undefined ? where : `${where}: ${statusReason}`;
      }),
  );
}

export async function lzCheckRuntimeErrors(reportFile: string, recordedFile: string): Promise<readonly string[]> {
  const [report, recorded] = await Promise.all(
    [reportFile, recordedFile].map(async (path): Promise<unknown> => JSON.parse(await readFile(path, 'utf8'))),
  );

  return lzUnrecordedRuntimeErrors(report, recorded);
}
