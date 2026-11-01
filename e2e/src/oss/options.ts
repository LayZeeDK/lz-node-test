import { parseArgs } from 'node:util';

export interface LzOssProject {
  readonly name: string;
  readonly mutate: readonly string[];
  readonly testFiles: readonly string[];
  /** The project's own `node:test` command, without its coverage wrapper. */
  readonly command: string;
}

export type LzSide = 'lz' | 'command';

export const lzSides: readonly LzSide[] = ['lz', 'command'];

export interface LzOssOptions {
  readonly project: LzOssProject;
  /** The OSS clone, which the driver copies and never writes to. */
  readonly source: string;
  readonly out: string;
  readonly concurrency: number;
  /** The sides to run, in order; both unless `--side` names one. */
  readonly sides: readonly LzSide[];
  /** Patterns or ranges that replace the project's `mutate` set; empty to mutate the whole set. */
  readonly mutate: readonly string[];
  /** A folder of `.tgz` files to install instead of packing the workspace. */
  readonly tarballs: string | undefined;
  /** Install and write the configurations, keep the copy, and run no Stryker. */
  readonly prepareOnly: boolean;
  /** How long each side's `stryker run` may take before the driver ends it. */
  readonly timeLimitMinutes: number;
}

export type LzStrykerOptions =
  | {
      readonly mutate: readonly string[];
      readonly plugins: readonly string[];
      readonly testRunner: 'lz-stryker-node-test';
      readonly lzStrykerNodeTest: { readonly testFiles: readonly string[] };
    }
  | {
      readonly mutate: readonly string[];
      readonly testRunner: 'command';
      readonly commandRunner: { readonly command: string };
      readonly coverageAnalysis: 'off';
    };

/** The run folder's prefix, which the next run's dead-run sweep matches. */
export const lzOssRunPrefix = 'lz-oss-driver-';
/** A prepared folder stays for manual runs, so its prefix is one the sweep never matches. */
export const lzOssPreparedPrefix = 'lz-oss-prepared-';

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
  { name: 'restartable', mutate: ['index.js', 'lib/server.js'], testFiles: ['test/*.test.js'], command: 'node --test' },
  {
    name: 'sonic-boom',
    mutate: ['index.js'],
    testFiles: ['test/*.test.js'],
    command: 'node --test --test-timeout=240000 "test/*.test.js"',
  },
  {
    name: 'pino-pretty',
    mutate: ['index.js', 'lib/**/*.js', '!lib/**/*.test.js'],
    testFiles: [
      'lib/**/*.test.js',
      'test/basic.test.js',
      'test/boolean-options.test.js',
      'test/cli.test.js',
      'test/crlf.test.js',
      'test/error-objects.test.js',
    ],
    command:
      'node --test "lib/**/*.test.js" "test/basic.test.js" "test/boolean-options.test.js" "test/cli.test.js" ' +
      '"test/crlf.test.js" "test/error-objects.test.js"',
  },
];

export interface LzMergeOptions {
  /** The result.json files of earlier runs, each with its sides' `<side>.mutation.json` beside it. */
  readonly merge: readonly string[];
  readonly out: string;
}

export const lzOssUsage =
  'Usage: node e2e/src/oss/main.ts --project <name> --source <clone> --out <folder> --concurrency <n> ' +
  '[--side <lz|command>] [--mutate <pattern>]... [--tarballs <folder>] [--prepare-only] ' +
  '[--time-limit-minutes <n>, default 15] [--help]\n' +
  '       node e2e/src/oss/main.ts --merge <result.json>... --out <folder>\n' +
  '  --side    runs that side only and compares nothing; without it both sides run and are compared.\n' +
  "  --mutate  replaces the project's mutate set for this run; passed to stryker run as --mutate. To select the\n" +
  '            mutant at a mutation.json position, widen the range by one column on each side:\n' +
  '            file.js:12:4-12:20 for a mutant at 12:5-12:19.\n' +
  "  --merge   compares the sides of earlier runs from their result.json, each read with its sides' reports beside\n" +
  '            it. Batches of one side merge into one; a mutant in two batches is refused. A merged result.json\n' +
  '            is refused: merges do not compose, so merge the runs it lists in mergedFrom. A side that wrote no\n' +
  "            report is refused; a run removes its sides' earlier reports and logs from --out first. Runs that\n" +
  "            differ in any of result.json's project, workspaceCommit, node and tarballs are refused, naming the\n" +
  '            field. A result.json given twice is refused, however its path is spelt.';
const positiveInteger = /^[1-9]\d*$/;

export function lzParseMergeOptions(args: readonly string[]): LzMergeOptions {
  const { values } = parseArgs({
    args: [...args],
    options: { merge: { type: 'string', multiple: true, default: [] }, out: { type: 'string' } },
    strict: true,
    allowPositionals: false,
  });

  if (values.out === undefined) {
    throw new Error(`${lzOssUsage}\n--out is required.`);
  }

  return { merge: values.merge, out: values.out };
}

/** The arguments `stryker run` gets beside its config file, concurrency and reporters. */
export function lzStrykerArgs(mutate: readonly string[]): string[] {
  return mutate.length === 0 ? [] : ['--mutate', mutate.join(',')];
}

export type LzOssCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'merge'; readonly options: LzMergeOptions }
  | { readonly kind: 'run'; readonly options: LzOssOptions };

/** Help wins over everything; `--merge` picks the merge, whose strict parse refuses the options of a run. */
export function lzParseCommand(args: readonly string[]): LzOssCommand {
  const { tokens } = parseArgs({ args: [...args], strict: false, tokens: true });
  const names = new Set(tokens.flatMap((token) => (token.kind === 'option' ? [token.name] : [])));

  if (names.has('help') || names.has('h')) {
    return { kind: 'help' };
  }

  return names.has('merge')
    ? { kind: 'merge', options: lzParseMergeOptions(args) }
    : { kind: 'run', options: lzParseOptions(args) };
}

export function lzParseOptions(args: readonly string[]): LzOssOptions {
  const { values } = parseArgs({
    args: [...args],
    options: {
      project: { type: 'string' },
      source: { type: 'string' },
      out: { type: 'string' },
      concurrency: { type: 'string' },
      side: { type: 'string' },
      mutate: { type: 'string', multiple: true, default: [] },
      tarballs: { type: 'string' },
      'prepare-only': { type: 'boolean', default: false },
      'time-limit-minutes': { type: 'string', default: '15' },
    },
    strict: true,
    allowPositionals: false,
  });
  const { source, out, concurrency, tarballs, 'time-limit-minutes': timeLimitMinutes } = values;
  const project = projects.find(({ name }) => name === values.project);

  if (project === undefined) {
    throw new Error(`${lzOssUsage}\n--project is one of ${projects.map(({ name }) => name).join(', ')}.`);
  }

  if (source === undefined || out === undefined) {
    throw new Error(`${lzOssUsage}\n--source and --out are required.`);
  }

  if (concurrency === undefined || !positiveInteger.test(concurrency)) {
    throw new Error(`${lzOssUsage}\n--concurrency is a positive integer; size it to the machine's current load.`);
  }

  if (!positiveInteger.test(timeLimitMinutes)) {
    throw new Error(`${lzOssUsage}\n--time-limit-minutes is a positive integer.`);
  }

  const side = lzSides.find((known) => known === values.side);

  if (values.side !== undefined && side === undefined) {
    throw new Error(`${lzOssUsage}\n--side is lz or command.`);
  }

  if (values.mutate.some((pattern) => pattern.includes(','))) {
    throw new Error(`${lzOssUsage}\n--mutate takes one pattern without a comma; repeat it for more.`);
  }

  return {
    project,
    source,
    out,
    concurrency: Number(concurrency),
    sides: side === undefined ? lzSides : [side],
    mutate: values.mutate,
    tarballs,
    prepareOnly: values['prepare-only'],
    timeLimitMinutes: Number(timeLimitMinutes),
  };
}

/**
 * Both sides import the operators, so they mutate the same code into the same mutants. The command side runs the
 * project's own command, with coverage analysis off as that runner reports no coverage.
 */
export function lzStrykerOptions(side: LzSide, { mutate, testFiles, command }: LzOssProject): LzStrykerOptions {
  return side === 'lz'
    ? {
        mutate,
        plugins: ['@stryker-mutator/*', '@layzee/stryker-node-test-runner'],
        testRunner: 'lz-stryker-node-test',
        lzStrykerNodeTest: { testFiles },
      }
    : { mutate, testRunner: 'command', commandRunner: { command }, coverageAnalysis: 'off' };
}

export function lzStrykerConfig(side: LzSide, project: LzOssProject): string {
  return (
    "import '@layzee/stryker-node-test-mutators';\n\n" +
    `export default ${JSON.stringify(lzStrykerOptions(side, project), null, 2)};\n`
  );
}
