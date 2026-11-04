import { parseArgs } from 'node:util';

/** A replacement the driver makes in the project's copy before installing; refused unless `from` occurs exactly once. */
export interface LzOssPatch {
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

export interface LzOssProject {
  readonly name: string;
  readonly mutate: readonly string[];
  /** Both sides run these files: the lz side as its `testFiles`, the command side as `node --test`'s arguments. */
  readonly testFiles: readonly string[];
  /** The project's own `node --test` flags, without its coverage wrapper. */
  readonly nodeTestFlags: readonly string[];
  readonly patches: readonly LzOssPatch[];
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
  /** Stryker's `timeoutMS`, added to each mutant's limit; Stryker's default without `--mutant-timeout-ms`. */
  readonly mutantTimeoutMs: number | undefined;
}

export type LzStrykerOptions =
  | {
      readonly mutate: readonly string[];
      readonly plugins: readonly string[];
      readonly testRunner: 'lz-node-test';
      readonly lzNodeTest: { readonly testFiles: readonly string[] };
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
  { name: 'env-schema', mutate: ['index.js'], testFiles: ['test/**/*.test.js'], nodeTestFlags: [], patches: [] },
  {
    name: 'fastify-cookie',
    mutate: ['index.js', 'signer.js'],
    testFiles: ['test/**/*.test.js'],
    nodeTestFlags: [],
    patches: [],
  },
  {
    name: 'fast-json-stringify',
    mutate: ['index.js', 'lib/**/*.js', '!lib/schema-validator.js'],
    testFiles: ['test/*.test.js'],
    // A mutant whose memory grows without bound would grow in every file process at once.
    nodeTestFlags: ['--test-concurrency=1'],
    // Both sides' test processes share one sandbox, and this test writes, requires and deletes fixed file names in it.
    // Keyed by process, as the command runner runs in Stryker's own process, which has no STRYKER_MUTATOR_WORKER.
    patches: [
      {
        file: 'test/standalone-mode.test.js',
        from: "const tmpDir = 'test/fixtures'",
        to: "const tmpDir = path.join('test/fixtures', `process-${process.pid}`); fs.mkdirSync(tmpDir, { recursive: true })",
      },
    ],
  },
  {
    name: 'fastify',
    mutate: ['fastify.js', 'lib/**/*.js', '!lib/error-serializer.js', '!lib/config-validator.js'],
    testFiles: ['test/**/*.test.js', 'test/**/*.test.mjs'],
    nodeTestFlags: [],
    patches: [],
  },
  {
    name: 'restartable',
    mutate: ['index.js', 'lib/server.js'],
    testFiles: ['test/*.test.js'],
    nodeTestFlags: [],
    patches: [],
  },
  {
    name: 'sonic-boom',
    mutate: ['index.js'],
    testFiles: ['test/*.test.js'],
    // write.test.js runs out of heap below 2 GB; one file process at a time bounds the suite's memory.
    nodeTestFlags: ['--test-concurrency=1', '--test-timeout=240000'],
    patches: [],
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
    // build-safe-sonic-boom.test.js writes a file into lib/utils while index.test.js lists that folder.
    nodeTestFlags: ['--test-concurrency=1'],
    patches: [],
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
  '[--time-limit-minutes <n>, default 15] [--mutant-timeout-ms <n>] [--help]\n' +
  '       node e2e/src/oss/main.ts --merge <result.json>... --out <folder>\n' +
  '  --side    runs that side only and compares nothing; without it both sides run and are compared.\n' +
  "  --mutate  replaces the project's mutate set for this run; passed to stryker run as --mutate. To select the\n" +
  '            mutant at a mutation.json position, widen the range by one column on each side:\n' +
  '            file.js:12:4-12:20 for a mutant at 12:5-12:19.\n' +
  '  A side that ends before its report, such as at --time-limit-minutes, leaves <side>.checkpoint.json in --out\n' +
  '  with the mutants it tested. A rerun into the same --out with the same project, source commit, Node.js, --mutate,\n' +
  '  --mutant-timeout-ms and tarballs tests only the rest; any other rerun starts afresh.\n' +
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
export function lzStrykerArgs({ mutate, mutantTimeoutMs }: Pick<LzOssOptions, 'mutate' | 'mutantTimeoutMs'>): string[] {
  return [
    ...(mutate.length === 0 ? [] : ['--mutate', mutate.join(',')]),
    ...(mutantTimeoutMs === undefined ? [] : ['--timeoutMS', String(mutantTimeoutMs)]),
  ];
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
      'mutant-timeout-ms': { type: 'string' },
    },
    strict: true,
    allowPositionals: false,
  });
  const {
    source,
    out,
    concurrency,
    tarballs,
    'time-limit-minutes': timeLimitMinutes,
    'mutant-timeout-ms': mutantTimeoutMs,
  } = values;
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

  if (mutantTimeoutMs !== undefined && !positiveInteger.test(mutantTimeoutMs)) {
    throw new Error(`${lzOssUsage}\n--mutant-timeout-ms is a positive integer.`);
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
    mutantTimeoutMs: mutantTimeoutMs === undefined ? undefined : Number(mutantTimeoutMs),
  };
}

/**
 * The command side's `node --test` with the test files named, not discovered: discovery would also run a file a
 * test writes under `test/`, such as another worker's fixture.
 */
export function lzNodeTestCommand({ testFiles, nodeTestFlags }: LzOssProject): string {
  return ['node --test', ...nodeTestFlags, ...testFiles.map((pattern) => `"${pattern}"`)].join(' ');
}

/**
 * Both sides import the operators, so they mutate the same code into the same mutants. The command side runs
 * lzNodeTestCommand's `node --test`, with coverage analysis off as that runner reports no coverage.
 */
export function lzStrykerOptions(side: LzSide, project: LzOssProject): LzStrykerOptions {
  const { mutate, testFiles } = project;
  const command = lzNodeTestCommand(project);

  return side === 'lz'
    ? {
        mutate,
        plugins: ['@stryker-mutator/*', '@layzee/stryker-node-test-runner'],
        testRunner: 'lz-node-test',
        lzNodeTest: { testFiles },
      }
    : { mutate, testRunner: 'command', commandRunner: { command }, coverageAnalysis: 'off' };
}

export function lzStrykerConfig(side: LzSide, project: LzOssProject): string {
  return (
    "import '@layzee/stryker-node-mutators';\n\n" +
    `export default ${JSON.stringify(lzStrykerOptions(side, project), null, 2)};\n`
  );
}
