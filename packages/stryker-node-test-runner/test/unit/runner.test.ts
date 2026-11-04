import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import type { CoverageAnalysis, MutantCoverage } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { TestStatus } from '@stryker-mutator/api/test-runner';

import { lzTestEach } from '@layzee/node-test-extensions';
import { lzTestFor } from '@layzee/node-test-extensions';
import { activeMutantEnv, envNames, type ProcessRecord, type RecordedTest } from '../../src/record.ts';
import { callMember, construct, member } from '../reflect.fixtures.ts';
import { activeMutant, dryRun, hookUrl, logger, strykerOptions } from '../runner.fixtures.ts';
import {
  LzNodeTestTestRunner,
  lzFileError,
  lzFilesFor,
  lzRunEnv,
  type LzRunEnvInput,
  lzRunInPool,
  type LzRunOptions,
  lzTestRunnerConcurrency,
  lzToTestResults,
} from '../../src/runner.ts';

const file = join('/repo', 'a.test.mjs');

describe('lzToTestResults', () => {
  const base = (id: string) => ({ id, name: id.slice(`${file} > `.length), fileName: file });

  it('reports each recorded test with its status, failure message, and rounded time plus the time the file spent outside its tests', () => {
    assert.deepEqual(
      lzToTestResults(
        file,
        [
          { id: `${file} > passes`, status: 'passed', timeSpentMs: 1.6 },
          { id: `${file} > fails`, status: 'failed', failureMessage: 'boom', timeSpentMs: 2.4 },
          { id: `${file} > fails silently`, status: 'failed', timeSpentMs: 0 },
          { id: `${file} > skipped`, status: 'skipped', timeSpentMs: 0.4 },
        ],
        10.4,
      ),
      [
        { ...base(`${file} > passes`), timeSpentMs: 8, status: TestStatus.Success },
        { ...base(`${file} > fails`), timeSpentMs: 8, status: TestStatus.Failed, failureMessage: 'boom' },
        {
          ...base(`${file} > fails silently`),
          timeSpentMs: 6,
          status: TestStatus.Failed,
          failureMessage: 'Test failed',
        },
        { ...base(`${file} > skipped`), timeSpentMs: 6, status: TestStatus.Skipped },
      ],
    );
  });

  it("counts a parent test's time once, as it includes the time of the subtests it runs", () => {
    assert.deepEqual(
      lzToTestResults(
        file,
        [
          { id: `${file} > parent > first`, status: 'passed', timeSpentMs: 1 },
          { id: `${file} > parent > second > third`, status: 'passed', timeSpentMs: 2 },
          { id: `${file} > parent > second`, status: 'passed', timeSpentMs: 3 },
          { id: `${file} > parent`, status: 'passed', timeSpentMs: 5 },
          { id: `${file} > parenthood`, status: 'passed', timeSpentMs: 1 },
        ],
        10,
      ).map((result) => result.timeSpentMs),
      [5, 6, 7, 9, 5],
    );
  });

  it('reports where a test is declared when the hook recorded it', () => {
    const startPosition = { line: 4, column: 2 };

    assert.deepEqual(
      lzToTestResults(file, [{ id: `${file} > passes`, status: 'passed', timeSpentMs: 1, startPosition }], 1),
      [{ ...base(`${file} > passes`), timeSpentMs: 1, status: TestStatus.Success, startPosition }],
    );
  });
});

describe('lzFileError', () => {
  const command =
    `To reproduce it without the mutant, run \`node "--test" "--no-deprecation" "${file}"\` in ${process.cwd()}, ` +
    "without the runner's reporter and hook.";

  lzTestFor<
    readonly [
      string,
      number | null,
      string,
      readonly { readonly diagnostics?: readonly string[]; readonly heldOpen?: readonly string[] }[],
      readonly string[],
    ]
  >([
    ['trimmed stderr', 1, '  \nline 1\nline 2 \n', [], ['Stderr, at most its last 8 KiB:', 'line 1', 'line 2']],
    ['no stderr', 3, ' \n', [], []],
    ['the missing exit code of a killed process', null, '', [], []],
    [
      'the diagnostics of every process',
      1,
      'out',
      [{ diagnostics: ['late 1'] }, {}, { diagnostics: ['late 2'] }],
      ['Diagnostics:', 'late 1', 'late 2', 'Stderr, at most its last 8 KiB:', 'out'],
    ],
    [
      'what held it open, which hid an error raised after a test ended',
      1,
      '',
      [{ heldOpen: ['TCPServerWrap', 'Timeout'] }, { heldOpen: [] }],
      [
        'It stayed alive after its tests, held open by TCPServerWrap, Timeout, until the runner ended it; node:test ' +
          'reports an error raised after a test ended only when its process ends by itself.',
      ],
    ],
  ])('names the file, the exit code and the command, with %s', ([, exitCode, stderr, records, end]) => {
    const run = {
      records: records.map((record) => ({
        tests: [],
        ...(record.diagnostics && { diagnostics: [...record.diagnostics] }),
        ...(record.heldOpen && { heldOpen: [...record.heldOpen] }),
      })),
      exitCode,
      stderr,
      fileArgs: ['--no-deprecation', file],
      nodeOptions: [],
    };

    assert.equal(
      lzFileError(file, run),
      [
        `Error running file "${file}": node exited with code ${String(exitCode)} outside any test.`,
        command,
        ...end,
      ].join('\n'),
    );
  });

  it("names the test file's NODE_OPTIONS without the runner's hook and reporters", () => {
    const run = {
      records: [],
      exitCode: 1,
      stderr: '',
      fileArgs: ['--stack-size=900', file],
      nodeOptions: ['--import tsx', '--max-old-space-size=100'],
    };

    assert.equal(
      lzFileError(file, run).split('\n')[1],
      `To reproduce it without the mutant, run \`node "--test" "--stack-size=900" "${file}"\` in ${process.cwd()} ` +
        "with NODE_OPTIONS set to `--import tsx --max-old-space-size=100`, without the runner's reporter and hook.",
    );
  });
});

describe('LzNodeTestTestRunner options', () => {
  const runner = (lzNodeTest: unknown) => new LzNodeTestTestRunner({ ...strykerOptions(), lzNodeTest }, logger());

  it("takes Stryker's two constructor parameters only", () => {
    assert.equal(LzNodeTestTestRunner.length, 2);
  });

  lzTestEach([
    ['no options', undefined],
    ['empty options', {}],
    ['every option', { testFiles: ['a.test.ts'], nodeArgs: ['--enable-source-maps'], maxMemoryMB: 512 }],
  ])('takes %s', (_title, options) => {
    assert.ok(runner(options) instanceof LzNodeTestTestRunner);
  });

  lzTestFor([null, [], 'options'])('refuses %j, which is no options object', (options) => {
    assert.throws(() => runner(options), { message: 'not valid lzNodeTest options' });
  });

  lzTestEach([
    [{ testFiles: 'a.test.ts' }, 'testFiles'],
    [{ testFiles: [1] }, 'testFiles'],
    [{ nodeArgs: '--enable-source-maps' }, 'nodeArgs'],
    [{ nodeArgs: [null] }, 'nodeArgs'],
    [{ maxMemoryMB: '512' }, 'maxMemoryMB'],
  ])('refuses %j, naming %s', (options, field) => {
    assert.throws(() => runner(options), { message: `not valid lzNodeTest options: ${field}` });
  });
});

describe('LzNodeTestTestRunner dry run coverage', () => {
  /** A runner whose test file reports `record` without running. */
  class RecordingRunner extends LzNodeTestTestRunner {
    readonly #record: ProcessRecord;

    constructor(record: ProcessRecord, log: Logger) {
      super(strykerOptions({ lzNodeTest: { maxMemoryMB: 512 } }), log);
      this.#record = record;
    }

    override runFile() {
      return Promise.resolve({ records: [this.#record], exitCode: 0, stderr: '', fileArgs: [], nodeOptions: [] });
    }
  }

  const test = `${file} > passes`;
  const dryRunWarnings = async (
    coverageAnalysis: CoverageAnalysis,
    mutantCoverage: MutantCoverage,
    status: RecordedTest['status'] = 'passed',
    others: readonly RecordedTest[] = [],
  ) => {
    const warnings: string[] = [];
    const tests = [{ id: test, status, timeSpentMs: 1 }, ...others];
    const record: ProcessRecord = { main: true, tests, mutantCoverage };

    await new RecordingRunner(record, logger({ warnings })).dryRun({ ...dryRun, coverageAnalysis, testFiles: [file] });

    return warnings;
  };

  lzTestFor<CoverageAnalysis>(['perTest', 'all'])(
    'warns once, naming the likely causes, when the tests reach no instrumented code with coverage analysis %s',
    async (coverageAnalysis) => {
      const warnings = await dryRunWarnings(coverageAnalysis, { static: {}, perTest: { [test]: {} } });
      const [warning = ''] = warnings;

      assert.equal(warnings.length, 1);
      assert.match(warning, /NoCoverage/);
      assert.match(warning, /dist\//);
      assert.match(warning, /sandbox/);
    },
  );

  it('warns when the tests reach no instrumented code and only some of them are skipped', async () => {
    const passes: RecordedTest = { id: `${file} > also passes`, status: 'passed', timeSpentMs: 1 };

    assert.equal((await dryRunWarnings('perTest', { static: {}, perTest: {} }, 'skipped', [passes])).length, 1);
  });

  lzTestEach<[string, CoverageAnalysis, MutantCoverage, RecordedTest['status']]>([
    ['a static hit', 'perTest', { static: { 1: 1 }, perTest: {} }, 'passed'],
    ['a hit in a test', 'perTest', { static: {}, perTest: { [test]: { 1: 1 } } }, 'passed'],
    ['a hit with coverage analysis all', 'all', { static: {}, perTest: { [test]: { 1: 1 } } }, 'passed'],
    ['coverage analysis off', 'off', { static: {}, perTest: {} }, 'passed'],
    ['only skipped tests', 'perTest', { static: {}, perTest: {} }, 'skipped'],
  ])('does not warn about coverage with %s', async (_title, coverageAnalysis, mutantCoverage, status) => {
    assert.deepEqual(await dryRunWarnings(coverageAnalysis, mutantCoverage, status), []);
  });
});

describe('lzFilesFor', () => {
  const a = join('/repo', 'a.test.mjs');
  const b = join('/repo', 'b.test.mjs');
  const longer = `${a}.old`;
  const files = [a, b, longer];

  it('returns every file without a filter', () => {
    assert.deepEqual(lzFilesFor(files, undefined), files);
  });

  it('returns no file for an empty filter', () => {
    assert.deepEqual(lzFilesFor(files, []), []);
  });

  it('returns the files that contain a filtered test, or that the filter names themselves', () => {
    assert.deepEqual(lzFilesFor(files, [`${longer} > suite > test`]), [longer]);
    assert.deepEqual(lzFilesFor(files, [`${a} > test`]), [a]);
    assert.deepEqual(lzFilesFor(files, [b, `${a} > test`]), [a, b]);
  });
});

describe('lzRunInPool', () => {
  function setup(count: number, limit: number, stops: (result: number) => boolean = () => false) {
    const started: number[] = [];
    const settle: ((result: number) => void)[] = [];
    const fail: ((error: Error) => void)[] = [];
    const pool = lzRunInPool(
      Array.from({ length: count }, (_, index) => index),
      limit,
      (item) => {
        started.push(item);

        return new Promise<number>((resolve, reject) => {
          settle[item] = resolve;
          fail[item] = reject;
        });
      },
      stops,
    );
    const turn = () => setImmediate();

    return { started, settle, fail, pool, turn };
  }

  it('runs at most `limit` items at once, starting them in order, and returns their results in order', async () => {
    const { started, settle, pool, turn } = setup(5, 2);

    await turn();
    assert.deepEqual(started, [0, 1]);
    settle[1]?.(10);
    await turn();
    assert.deepEqual(started, [0, 1, 2]);
    settle[0]?.(0);
    await turn();
    assert.deepEqual(started, [0, 1, 2, 3]);
    settle[3]?.(30);
    settle[2]?.(20);
    await turn();
    settle[4]?.(40);
    await turn();

    assert.deepEqual(started, [0, 1, 2, 3, 4]);
    assert.deepEqual(await pool, [0, 10, 20, 30, 40]);
  });

  it('starts no more items once a result stops the run, and returns the results of those it started', async () => {
    const { started, settle, pool, turn } = setup(5, 2, (result) => result === 1);

    await turn();
    settle[1]?.(1);
    await turn();
    settle[0]?.(0);
    await turn();

    assert.deepEqual(started, [0, 1]);
    assert.deepEqual(await pool, [0, 1]);
  });

  it('returns no results after the first item whose result stops the run, though a later one finished', async () => {
    const { started, settle, pool, turn } = setup(5, 2, (result) => result === 0);

    await turn();
    settle[0]?.(0);
    await turn();
    settle[1]?.(1);
    await turn();

    assert.deepEqual(started, [0, 1]);
    assert.deepEqual(await pool, [0]);
  });

  it('starts no more items once an item fails, and rejects with its error once the started items settle', async () => {
    const { started, settle, fail, pool, turn } = setup(5, 2);
    const error = new Error('spawn EAGAIN');
    let settled = false;
    const rejected = assert.rejects(
      pool.finally(() => (settled = true)),
      error,
    );

    await turn();
    fail[1]?.(error);
    await turn();
    assert.equal(settled, false);
    settle[0]?.(0);
    await turn();

    assert.deepEqual(started, [0, 1]);
    await rejected;
  });

  it('runs every item when the limit exceeds their number, and nothing for no items', async () => {
    const { started, settle, pool, turn } = setup(2, 4);

    await turn();
    assert.deepEqual(started, [0, 1]);
    settle[0]?.(0);
    settle[1]?.(1);

    assert.deepEqual(await pool, [0, 1]);
    assert.deepEqual(
      await lzRunInPool(
        [],
        4,
        () => Promise.reject(new Error('no work')),
        () => false,
      ),
      [],
    );
  });
});

describe('lzTestRunnerConcurrency', () => {
  lzTestEach([
    [undefined, false, 8, 7],
    [undefined, false, 4, 4],
    [3, false, 8, 3],
    ['50%', false, 3, 2],
    ['0%', false, 8, 1],
    ['100%', false, 8, 8],
    ['50', false, 8, 7],
    ['150%', false, 8, 7],
    ['x50%', false, 8, 7],
    ['50%x', false, 8, 7],
    [1, true, 8, 2],
    ['0%', true, 8, 2],
    [3, true, 8, 3],
    [4, true, 8, 4],
  ])(
    'gives concurrency %j, with checkers %j, on %d cores %d test runners, as Stryker does',
    (concurrency, checkers, cores, runners) => {
      assert.equal(lzTestRunnerConcurrency(concurrency, checkers, cores), runners);
    },
  );

  lzTestEach([
    [[], undefined],
    [[], 3],
    [[], '50%'],
    [[], '150%'],
    [[], '0%'],
    [['typescript'], undefined],
    [['typescript'], 1],
    [['typescript'], '0%'],
    [['typescript'], 3],
  ])(
    "matches Stryker core's test runner count once checking is done, for checkers %j and concurrency %j",
    async (checkers, concurrency) => {
      // The computation is private to @stryker-mutator/core; this fails when a release of it changes the count.
      const providerUrl = new URL(
        './concurrent/concurrency-token-provider.js',
        import.meta.resolve('@stryker-mutator/core'),
      );
      const providerModule: unknown = await import(providerUrl.href);
      const provider = construct(member(providerModule, 'ConcurrencyTokenProvider'), [
        { checkers: [...checkers], concurrency },
        logger(),
      ]);
      const tokens: unknown[] = [];
      callMember(member(provider, 'testRunnerToken$'), 'subscribe', (token: unknown) => tokens.push(token));
      callMember(provider, 'freeCheckers');
      callMember(provider, 'dispose');

      assert.equal(lzTestRunnerConcurrency(concurrency, checkers.length > 0, availableParallelism()), tokens.length);
    },
  );
});

describe('lzRunEnv', () => {
  const out = join('/tmp', 'out');
  const tmp = join('/tmp', 'tmp');
  const envOf = (input: Partial<LzRunEnvInput>) =>
    lzRunEnv({
      base: {},
      file,
      outDir: out,
      tmpDir: tmp,
      run: { dryRun: false, disableBail: true },
      cacheDir: undefined,
      nodeOptions: [],
      ...input,
    });

  it("names Stryker's active mutant variable as the hook does", () => {
    assert.equal(activeMutantEnv, activeMutant);
  });

  it("loads the hook before the consumer's options and drops the outer run state", () => {
    const base = {
      PATH: 'path',
      NODE_OPTIONS: '--outer',
      [envNames.out]: 'outer out',
      NODE_TEST_CONTEXT: 'child-v8',
      TEMP: 'outer temp',
      [envNames.current]: 'outer test',
      [envNames.hitLimit]: '5',
      [envNames.memoryLimit]: '500',
      [envNames.filter]: JSON.stringify(['outer']),
      [envNames.bail]: 'true',
      [envNames.activeMutant]: '8',
      [activeMutant]: '9',
    };
    const before = { ...base };

    assert.deepEqual(envOf({ base, nodeOptions: ['--max-old-space-size=100'] }), {
      PATH: 'path',
      NODE_OPTIONS: `--import ${JSON.stringify(hookUrl)} --max-old-space-size=100`,
      [envNames.out]: out,
      [envNames.file]: file,
      [envNames.dryRun]: 'false',
      TMPDIR: tmp,
      TEMP: tmp,
      TMP: tmp,
    });
    assert.deepEqual(base, before);
  });

  it("leaves the test file the hook's own held-open time whatever the parent's environment sets", () => {
    assert.equal(envOf({ base: { [envNames.heldOpen]: '200' } })[envNames.heldOpen], undefined);
  });

  it("passes Stryker's timeoutMS on as the stall time of a mutant run only, whatever the parent's environment sets", () => {
    const base = { [envNames.stall]: '100' };

    assert.equal(envOf({ base, stallMs: 300 })[envNames.stall], '300');
    const dryRunOptions = { dryRun: true, disableBail: true, coverageAnalysis: 'perTest' } satisfies LzRunOptions;

    assert.equal(envOf({ base, stallMs: 300, run: dryRunOptions })[envNames.stall], undefined);
    assert.equal(envOf({ base })[envNames.stall], undefined);
  });

  it("uses the runner's compile cache directory unless the environment names one", () => {
    const inherited = { NODE_COMPILE_CACHE: 'inherited' };

    assert.equal(envOf({ cacheDir: 'own' })['NODE_COMPILE_CACHE'], 'own');
    assert.equal(envOf({ base: inherited, cacheDir: 'own' })['NODE_COMPILE_CACHE'], 'inherited');
    assert.equal(envOf({ base: inherited })['NODE_COMPILE_CACHE'], 'inherited');
  });

  it('passes the run state, the memory limit and a shortened held-open time on to the test file', () => {
    assert.deepEqual(
      envOf({
        run: {
          dryRun: false,
          disableBail: true,
          activeMutant: '12',
          hitLimit: 40,
          testFilter: [`${file} > test`],
        },
        memoryLimitMB: 1500,
        heldOpenMs: 200,
      }),
      {
        NODE_OPTIONS: `--import ${JSON.stringify(hookUrl)}`,
        [envNames.out]: out,
        [envNames.file]: file,
        [envNames.dryRun]: 'false',
        TMPDIR: tmp,
        TEMP: tmp,
        TMP: tmp,
        [activeMutant]: '12',
        [envNames.hitLimit]: '40',
        [envNames.memoryLimit]: '1500',
        [envNames.heldOpen]: '200',
        [envNames.filter]: JSON.stringify([`${file} > test`]),
      },
    );
  });

  it('activates the mutant from the start of the process, or for the hook to activate once the tests start', () => {
    const run = { dryRun: false, disableBail: false, activeMutant: '12' } satisfies LzRunOptions;
    const active = (mutantActivation: 'runtime' | 'static') => {
      const env = envOf({ run: { ...run, mutantActivation } });

      return { atStart: env[activeMutant], onceTestsStart: env[envNames.activeMutant] };
    };

    assert.deepEqual(active('static'), { atStart: '12', onceTestsStart: undefined });
    assert.deepEqual(active('runtime'), { atStart: undefined, onceTestsStart: '12' });
  });

  it('asks the test file to bail only in a mutant run with bail enabled', () => {
    const bails = (
      [
        { dryRun: false, disableBail: false },
        { dryRun: false, disableBail: true },
        { dryRun: true, disableBail: false, coverageAnalysis: 'perTest' },
        { dryRun: true, disableBail: true, coverageAnalysis: 'perTest' },
      ] satisfies LzRunOptions[]
    ).map((run) => envOf({ run })[envNames.bail]);

    assert.deepEqual(bails, ['true', undefined, undefined, undefined]);
  });
});
