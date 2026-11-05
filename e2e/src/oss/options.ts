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
  readonly npmBefore: string;
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
    // One process for every test file instead of one each, so a mutant whose memory grows without bound grows in one
    // process.
    nodeTestFlags: ['--experimental-test-isolation=none'],
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
    // This test expects the open to fail, but a mutant that turns mkdir on creates the folder on the drive the run
    // is on (C:\path\to on Windows), and from then on the test fails without a mutant. A folder can never be created
    // under a file.
    patches: [
      {
        file: 'test/sync.test.js',
        from: "dest: '/path/to/nowwhere'",
        to: 'dest: `${__filename}/nowwhere`',
      },
    ],
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
  { name: 'borp', mutate: ['borp.js', 'lib/**/*.js'], testFiles: ['test/*.test.js'], nodeTestFlags: [], patches: [] },
  {
    name: 'execa',
    mutate: ['index.js', 'lib/**/*.js'],
    // Leaves out test/verbose, whose files fail on Windows with every subtest passing, arguments/encoding-option.js,
    // which fails the same way, and methods/node.js, whose nodePath tests download a Node.js 16 that has no Windows
    // arm64 build.
    testFiles: [
      'test/convert/*.js',
      'test/io/*.js',
      'test/ipc/*.js',
      'test/pipe/*.js',
      'test/resolve/*.js',
      'test/return/*.js',
      'test/stdio/*.js',
      'test/terminate/*.js',
      'test/transform/*.js',
      'test/arguments/command-resolution.js',
      'test/arguments/cwd.js',
      'test/arguments/env.js',
      'test/arguments/escape-no-icu.js',
      'test/arguments/escape.js',
      'test/arguments/fd-options.js',
      'test/arguments/local.js',
      'test/arguments/prototype-pollution.js',
      'test/arguments/shell.js',
      'test/arguments/specific.js',
      'test/methods/bind.js',
      'test/methods/command.js',
      'test/methods/create.js',
      'test/methods/main-async.js',
      'test/methods/override-promise.js',
      'test/methods/parameters-args.js',
      'test/methods/parameters-command.js',
      'test/methods/parameters-options.js',
      'test/methods/promise.js',
      'test/methods/script.js',
      'test/methods/template.js',
    ],
    // The suite's own flags: its tests spawn subprocesses and share fixture folders.
    nodeTestFlags: ['--test-concurrency=1', '--test-timeout=240000'],
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
  '--npm-before <date> [--side <lz|command>] [--mutate <pattern>]... [--tarballs <folder>] [--prepare-only] ' +
  '[--time-limit-minutes <n>, default 15] [--mutant-timeout-ms <n>] [--help]\n' +
  '       node e2e/src/oss/main.ts --merge <result.json> [--merge <result.json>]... --out <folder>\n' +
  '  --npm-before\n' +
  '            passed to npm install as --before: the copy gets the newest versions published before that past\n' +
  '            date or UTC time, which must come after the workspace pins of Stryker, TypeScript and @types/node\n' +
  '            were published. Give every part of one merge, and every Node.js version compared, the same one:\n' +
  "            otherwise npm 11 follows a project's own min-release-age as the clock moves, and npm 10 ignores it.\n" +
  '  --side    runs that side only and compares nothing; without it both sides run and are compared.\n' +
  "  --mutate  replaces the project's mutate set for this run; passed to stryker run as --mutate. To select the\n" +
  '            mutant at a mutation.json position, widen the range by one column on each side:\n' +
  '            file.js:12:4-12:20 for a mutant at 12:5-12:19.\n' +
  '  A side that ends before its report, such as at --time-limit-minutes, leaves <side>.checkpoint.json in --out\n' +
  '  with the mutants it tested, and <side>.checkpoint.json.key naming what it ran with. A rerun into the same --out\n' +
  "  with the same fields a merge matches (below), --mutate and the side's Stryker configuration tests only the\n" +
  '  rest; any other rerun discards the checkpoint and says so. A clone with uncommitted changes is not told apart\n' +
  '  from its commit.\n' +
  "  --merge   compares the sides of earlier runs from their result.json, each read with its sides' reports beside\n" +
  '            it. Batches of one side merge into one; a mutant in two batches is refused. A merged result.json\n' +
  '            is refused: merges do not compose, so merge the runs it lists in mergedFrom. A side that wrote no\n' +
  "            report is refused; a run removes its sides' earlier reports and logs from --out first. Runs that\n" +
  "            differ in any of result.json's project, sourceCommit, node, platform, mutantTimeoutMs,\n" +
  '            installedVersions, tarballDigests and projectSetup are refused, naming the field and, for a list, the\n' +
  '            entries that not every run has, as are a result.json that lacks one,\n' +
  '            runs of one side whose strykerConfig differs, and a side that records none; the workspace commit may\n' +
  '            differ. A result.json given twice is refused, however its path is spelt.';
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
      'npm-before': { type: 'string' },
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
    'npm-before': npmBefore,
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

  if (npmBefore === undefined) {
    throw new Error(
      `${lzOssUsage}\n--npm-before is required: npm installs the newest versions published before it, so runs that share it install one tree.`,
    );
  }

  const before = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z)?$/.test(npmBefore)
    ? Date.parse(npmBefore)
    : Number.NaN;

  if (Number.isNaN(before) || !new Date(before).toISOString().startsWith(npmBefore.slice(0, 10))) {
    throw new Error(
      `${lzOssUsage}\n--npm-before is a date such as 2026-11-04 or a UTC time such as 2026-11-04T12:00:00Z.`,
    );
  }

  if (before > Date.now()) {
    throw new Error(
      `${lzOssUsage}\n--npm-before must be in the past: a later date installs whatever is newest when the run starts.`,
    );
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
    npmBefore: new Date(before).toISOString(),
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
 * Both sides install the default node mutators, so they mutate the same code into the same mutants. The command side runs
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
    "import { lzNodeMutators } from '@layzee/stryker-node-mutators';\n\nawait lzNodeMutators();\n\n" +
    `export default ${JSON.stringify(lzStrykerOptions(side, project), null, 2)};\n`
  );
}
