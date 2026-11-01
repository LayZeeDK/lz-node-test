import { readFile } from 'node:fs/promises';

// Stryker leaves a RuntimeError mutant out of the mutation score, so a break threshold of 100 cannot see one. This
// check fails a run on each RuntimeError mutant that the list does not record with a reason.

export interface LzMutant {
  readonly mutatorName: string;
  readonly status: string;
  readonly statusReason: string | undefined;
  readonly line: number;
  readonly column: number;
}

interface Recorded {
  readonly file: string;
  readonly mutator: string;
  readonly line: number;
  readonly column: number;
}

const malformedReport = "The mutation report does not match Stryker's JSON report schema.";
const malformedList =
  'runtime-errors.json: each entry needs a file, a mutator, a line, a column and a reason, as the report gives them.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMutant(value: unknown): LzMutant {
  const location = isRecord(value) ? value['location'] : undefined;
  const start = isRecord(location) ? location['start'] : undefined;

  if (
    !isRecord(value) ||
    !isRecord(start) ||
    typeof value['mutatorName'] !== 'string' ||
    typeof value['status'] !== 'string' ||
    !['string', 'undefined'].includes(typeof value['statusReason']) ||
    typeof start['line'] !== 'number' ||
    typeof start['column'] !== 'number'
  ) {
    throw new Error(malformedReport);
  }

  return {
    mutatorName: value['mutatorName'],
    status: value['status'],
    statusReason: typeof value['statusReason'] === 'string' ? value['statusReason'] : undefined,
    line: start['line'],
    column: start['column'],
  };
}

/** The mutants of Stryker's JSON report per file; throws when the report does not match its schema. */
export function lzParseReport(report: unknown): readonly (readonly [file: string, mutants: readonly LzMutant[]])[] {
  const files = isRecord(report) ? report['files'] : undefined;

  if (!isRecord(files)) {
    throw new Error(malformedReport);
  }

  return Object.entries(files).map(([file, result]) => {
    const mutants = isRecord(result) ? result['mutants'] : undefined;

    if (!Array.isArray(mutants)) {
      throw new Error(malformedReport);
    }

    return [file, mutants.map(parseMutant)];
  });
}

function parseRecorded(entry: unknown): Recorded {
  if (
    !isRecord(entry) ||
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
