import { parseArgs } from 'node:util';

import type { LzMutantDetail, LzMutantStatus, LzReport } from '../../../e2e/src/report.ts';

export interface LzOssProject {
  readonly name: string;
  readonly mutate: readonly string[];
  readonly testFiles: readonly string[];
  /** The project's own `node:test` command, without its coverage wrapper. */
  readonly command: string;
}

export type LzSide = 'lz' | 'command';

export interface LzOssOptions {
  readonly project: LzOssProject;
  /** The OSS clone, which the driver copies and never writes to. */
  readonly source: string;
  readonly out: string;
  readonly concurrency: number;
  /** A folder of `.tgz` files to install instead of packing the workspace. */
  readonly tarballs: string | undefined;
  /** Install and write the configurations, keep the copy, and run no Stryker. */
  readonly prepareOnly: boolean;
}

export interface LzProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly workingSetBytes: number;
  /** Windows FILETIME of the start, so a reused process id is told apart from the process it replaced. */
  readonly created: bigint;
  readonly name: string;
}

export interface LzProcessPeaks {
  readonly samples: number;
  readonly peakCount: number;
  readonly peakWorkingSetBytes: number;
}

export interface LzScore {
  readonly counts: Readonly<Record<string, number>>;
  /** Stryker's mutation score: Killed and Timeout over those plus Survived and NoCoverage; null with none of them. */
  readonly score: number | null;
}

export interface LzVerdict {
  /** `file:line:column mutator replacement`, as both reports locate the mutant. */
  readonly mutant: string;
  readonly lz: LzMutantStatus | null;
  readonly command: LzMutantStatus | null;
}

const projects: readonly LzOssProject[] = [
  { name: 'env-schema', mutate: ['index.js'], testFiles: ['test/**/*.test.js'], command: 'node --test' },
  {
    name: 'fastify-cookie',
    mutate: ['index.js', 'signer.js'],
    testFiles: ['test/**/*.test.js'],
    command: 'node --test',
  },
  {
    name: 'fast-json-stringify',
    mutate: ['index.js', 'lib/**/*.js', '!lib/schema-validator.js'],
    testFiles: ['test/*.test.js'],
    command: 'node --test',
  },
  {
    name: 'fastify',
    mutate: ['fastify.js', 'lib/**/*.js', '!lib/error-serializer.js', '!lib/config-validator.js'],
    testFiles: ['test/**/*.test.js', 'test/**/*.test.mjs'],
    command: 'node --test "test/**/*.test.js" "test/**/*.test.mjs"',
  },
];

const usage =
  'Usage: node tools/oss-driver/src/main.ts --project <name> --source <clone> --out <folder> --concurrency <n> ' +
  '[--tarballs <folder>] [--prepare-only]';

export function lzParseOptions(args: readonly string[]): LzOssOptions {
  const { values } = parseArgs({
    args: [...args],
    options: {
      project: { type: 'string' },
      source: { type: 'string' },
      out: { type: 'string' },
      concurrency: { type: 'string' },
      tarballs: { type: 'string' },
      'prepare-only': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const { source, out, concurrency, tarballs } = values;
  const project = projects.find(({ name }) => name === values.project);

  if (project === undefined) {
    throw new Error(`${usage}\n--project is one of ${projects.map(({ name }) => name).join(', ')}.`);
  }

  if (source === undefined || out === undefined) {
    throw new Error(`${usage}\n--source and --out are required.`);
  }

  if (concurrency === undefined || !/^[1-9]\d*$/.test(concurrency)) {
    throw new Error(`${usage}\n--concurrency is a positive integer; size it to the machine's current load.`);
  }

  return { project, source, out, concurrency: Number(concurrency), tarballs, prepareOnly: values['prepare-only'] };
}

/**
 * Both sides import the operators, so they mutate the same code into the same mutants. The command side runs the
 * project's own command, with coverage analysis off as that runner reports no coverage.
 */
export function lzStrykerOptions(side: LzSide, { mutate, testFiles, command }: LzOssProject): Record<string, unknown> {
  return side === 'lz'
    ? {
        mutate,
        plugins: ['@stryker-mutator/*', '@layzee/lz-stryker-node-test-runner'],
        testRunner: 'lz-stryker-node-test',
        lzStrykerNodeTest: { testFiles },
      }
    : { mutate, testRunner: 'command', commandRunner: { command }, coverageAnalysis: 'off' };
}

export function lzStrykerConfig(side: LzSide, project: LzOssProject): string {
  return (
    "import '@layzee/lz-stryker-node-test-mutators';\n\n" +
    `export default ${JSON.stringify(lzStrykerOptions(side, project), null, 2)};\n`
  );
}

/**
 * Reads the sampler's output: one line per process, `pid ppid workingSetBytes created name`, and a `--` line after
 * each sample. Text after the last `--` is a sample the stop cut short, and is dropped.
 */
export function lzParseSamples(text: string): LzProcessRow[][] {
  return text
    .split(/^--\r?$/m)
    .slice(0, -1)
    .map((sample) =>
      sample
        .split(/\r?\n/)
        .filter((line) => line !== '')
        .map(parseRow),
    );
}

function parseRow(line: string): LzProcessRow {
  const match = /^(\d+) (\d+) (\d+) (\d+) (.*)$/.exec(line);

  if (match === null) {
    throw new Error(`Not a process line: "${line}"`);
  }

  const [, pid = '', ppid = '', workingSet = '', created = '', name = ''] = match;

  return { pid: Number(pid), ppid: Number(ppid), workingSetBytes: Number(workingSet), created: BigInt(created), name };
}

/**
 * The processes below `rootPid`, leaving out `excluded` and what runs below it. A child counts only if it started
 * after its parent, as one whose parent id was reused by a later process did not.
 */
export function lzDescendants(
  rows: readonly LzProcessRow[],
  rootPid: number,
  excluded: ReadonlySet<number>,
): LzProcessRow[] {
  const childrenOf = (parent: LzProcessRow | undefined, pid: number): LzProcessRow[] =>
    rows
      .filter(
        (row) =>
          row.ppid === pid &&
          row.pid !== pid &&
          !excluded.has(row.pid) &&
          (parent === undefined || row.created > parent.created),
      )
      .flatMap((row) => [row, ...childrenOf(row, row.pid)]);

  return childrenOf(
    rows.find(({ pid }) => pid === rootPid),
    rootPid,
  );
}

export function lzPeaks(samples: readonly (readonly LzProcessRow[])[]): LzProcessPeaks {
  return {
    samples: samples.length,
    peakCount: Math.max(0, ...samples.map((sample) => sample.length)),
    peakWorkingSetBytes: Math.max(
      0,
      ...samples.map((sample) => sample.reduce((sum, { workingSetBytes }) => sum + workingSetBytes, 0)),
    ),
  };
}

/**
 * The processes of `now` that are, or descend from, a child of `rootPid` that a sample saw. The walk goes through
 * processes that ended, as a process whose parent ended still names that parent's id; children of `rootPid` that no
 * sample saw, such as the one taking `now`, are not part of the run.
 */
export function lzLeftovers(
  seen: readonly LzProcessRow[],
  now: readonly LzProcessRow[],
  rootPid: number,
): LzProcessRow[] {
  const isNow = (row: LzProcessRow): boolean =>
    now.some(({ pid, created }) => pid === row.pid && created === row.created);
  const rows = [...now, ...uniqueByPid(seen.filter((row) => !isNow(row)))];

  return uniqueByPid(seen.filter(({ ppid }) => ppid === rootPid))
    .flatMap((run) => [run, ...lzDescendants(rows, run.pid, new Set())])
    .filter(isNow);
}

function uniqueByPid(rows: readonly LzProcessRow[]): LzProcessRow[] {
  return [...new Map(rows.map((row) => [row.pid, row])).values()];
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
      mutants.map(({ line, column, mutator, replacement, status }): [string, LzMutantStatus] => [
        `${file}:${line}:${column} ${mutator} ${replacement.replaceAll(/\s+/g, ' ')}`,
        status,
      ]),
    ),
  );
}

export function lzNewEntries(before: readonly string[], after: readonly string[]): string[] {
  return after.filter((entry) => !before.includes(entry)).sort();
}
