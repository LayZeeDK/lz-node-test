import { parseArgs } from 'node:util';

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

export const lzOssUsage =
  'Usage: node e2e/src/oss/main.ts --project <name> --source <clone> --out <folder> --concurrency <n> ' +
  '[--tarballs <folder>] [--prepare-only] [--time-limit-minutes <n>, default 15] [--help]';
const positiveInteger = /^[1-9]\d*$/;

export function lzWantsHelp(args: readonly string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

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

  return {
    project,
    source,
    out,
    concurrency: Number(concurrency),
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
