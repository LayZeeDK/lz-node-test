// What the checks on Stryker's JSON report read of it.

export interface LzMutant {
  readonly mutatorName: string;
  readonly status: string;
  readonly statusReason: string | undefined;
  readonly line: number;
  readonly column: number;
}

const malformedReport = "The mutation report does not match Stryker's JSON report schema.";

export function lzIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseMutant(value: unknown): LzMutant {
  const location = lzIsRecord(value) ? value['location'] : undefined;
  const start = lzIsRecord(location) ? location['start'] : undefined;

  if (
    !lzIsRecord(value) ||
    !lzIsRecord(start) ||
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
  const files = lzIsRecord(report) ? report['files'] : undefined;

  if (!lzIsRecord(files)) {
    throw new Error(malformedReport);
  }

  return Object.entries(files).map(([file, result]) => {
    const mutants = lzIsRecord(result) ? result['mutants'] : undefined;

    if (!Array.isArray(mutants)) {
      throw new Error(malformedReport);
    }

    return [file, mutants.map(parseMutant)];
  });
}
