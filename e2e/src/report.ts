export type LzMutantStatus =
  | 'Killed'
  | 'Survived'
  | 'NoCoverage'
  | 'CompileError'
  | 'RuntimeError'
  | 'Timeout'
  | 'Ignored'
  | 'Pending';

const statuses: readonly LzMutantStatus[] = [
  'Killed',
  'Survived',
  'NoCoverage',
  'CompileError',
  'RuntimeError',
  'Timeout',
  'Ignored',
  'Pending',
];

export interface LzMutantDetail {
  /** 1-based, as the report's `location.start` has it. */
  readonly line: number;
  /** 1-based, as the report's `location.start` has it. */
  readonly column: number;
  /** As the report's `location.end` has it, which tells apart mutants that start at one place. */
  readonly endLine: number;
  readonly endColumn: number;
  readonly mutator: string;
  readonly replacement: string;
  readonly status: LzMutantStatus;
  /** Whether only code outside any test, such as module-level code, reaches the mutant. */
  readonly static: boolean;
  readonly statusReason: string;
  readonly killedBy: readonly string[];
  readonly coveredBy: readonly string[];
}

/** Keyed by the report's path: relative, with forward slashes on every platform. */
export type LzReport = ReadonlyMap<string, readonly LzMutantDetail[]>;

export function lzParseReport(json: string): LzReport {
  const report: unknown = JSON.parse(json);

  if (!lzIsRecord(report)) {
    notAReport();
  }

  const { files } = report;

  if (!lzIsRecord(files)) {
    notAReport('files');
  }

  return new Map(Object.entries(files).map(([file, entry]) => [file, parseFile(entry, `files["${file}"]`)]));
}

export function lzMutantLine({ line, column, mutator, replacement, status }: LzMutantDetail): string {
  return [`${line}:${column}`, mutator, lzOneLine(replacement), status].filter((part) => part !== '').join(' ');
}

/** A replacement as one line, for output that a reader scans line by line. */
export function lzOneLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ');
}

export function lzIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFile(entry: unknown, path: string): LzMutantDetail[] {
  if (!lzIsRecord(entry) || !Array.isArray(entry['mutants'])) {
    notAReport(`${path}.mutants`);
  }

  const mutants: unknown[] = entry['mutants'];

  return mutants.map((mutant, index) => parseMutant(mutant, `${path}.mutants[${index}]`)).sort(byPosition);
}

function parseMutant(mutant: unknown, path: string): LzMutantDetail {
  if (!lzIsRecord(mutant)) {
    notAReport(path);
  }

  const {
    mutatorName,
    replacement = '',
    location,
    status,
    static: isStatic = false,
    statusReason = '',
    killedBy = [],
    coveredBy = [],
  } = mutant;
  const start = lzIsRecord(location) ? location['start'] : undefined;
  const end = lzIsRecord(location) ? location['end'] : undefined;

  if (!lzIsRecord(start) || typeof start['line'] !== 'number' || typeof start['column'] !== 'number') {
    notAReport(`${path}.location.start`);
  }

  if (!lzIsRecord(end) || typeof end['line'] !== 'number' || typeof end['column'] !== 'number') {
    notAReport(`${path}.location.end`);
  }

  if (typeof mutatorName !== 'string') {
    notAReport(`${path}.mutatorName`);
  }

  if (typeof replacement !== 'string') {
    notAReport(`${path}.replacement`);
  }

  if (!isStatus(status)) {
    notAReport(`${path}.status`);
  }

  if (typeof isStatic !== 'boolean') {
    notAReport(`${path}.static`);
  }

  if (typeof statusReason !== 'string') {
    notAReport(`${path}.statusReason`);
  }

  if (!lzIsStrings(killedBy)) {
    notAReport(`${path}.killedBy`);
  }

  if (!lzIsStrings(coveredBy)) {
    notAReport(`${path}.coveredBy`);
  }

  return {
    line: start['line'],
    column: start['column'],
    endLine: end['line'],
    endColumn: end['column'],
    mutator: mutatorName,
    replacement,
    status,
    static: isStatic,
    statusReason,
    killedBy,
    coveredBy,
  };
}

function byPosition(a: LzMutantDetail, b: LzMutantDetail): number {
  return (
    a.line - b.line ||
    a.column - b.column ||
    compareText(a.mutator, b.mutator) ||
    compareText(a.replacement, b.replacement) ||
    a.endLine - b.endLine ||
    a.endColumn - b.endColumn
  );
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isStatus(value: unknown): value is LzMutantStatus {
  return statuses.some((status) => status === value);
}

export function lzIsStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function notAReport(field?: string): never {
  const message = 'not a mutation report';

  throw new Error(field === undefined ? message : `${message}: ${field}`);
}
