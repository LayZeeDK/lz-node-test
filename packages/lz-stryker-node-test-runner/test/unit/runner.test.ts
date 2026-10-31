import assert from 'node:assert/strict';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { TestStatus } from '@stryker-mutator/api/test-runner';

import { lzTestEach } from '@layzee/lz-node-test';
import { lzTestFor } from '@layzee/lz-node-test';
import { activeMutantEnv, envNames } from '../../src/record.ts';
import { callMember, construct, member } from '../reflect.fixtures.ts';
import { activeMutant, hookUrl, logger, strykerOptions } from '../runner.fixtures.ts';
import {
  LzStrykerNodeTestRunner,
  lzFileError,
  lzFilesFor,
  lzMergeCoverage,
  lzRunEnv,
  lzRunInPool,
  type LzRunOptions,
  lzTestRunnerConcurrency,
  lzToTestResults,
  lzOverlapCoverage,
} from '../../src/runner.ts';

const file = join('/repo', 'a.test.mjs');

describe('lzMergeCoverage', () => {
  it('adds up the hits of every process and skips processes without coverage', () => {
    assert.deepEqual(
      lzMergeCoverage(
        [
          { static: { 1: 1 }, perTest: { first: { 2: 1 } } },
          undefined,
          { static: { 1: 2, 3: 1 }, perTest: { first: { 2: 3 }, second: { 4: 1 } } },
        ],
        true,
      ),
      { static: { 1: 3, 3: 1 }, perTest: { first: { 2: 4 }, second: { 4: 1 } } },
    );
  });

  it('is empty without coverage', () => {
    assert.deepEqual(lzMergeCoverage([], true), { static: {}, perTest: {} });
  });

  it('counts the hits inside tests as static when asked to drop the tests', () => {
    assert.deepEqual(
      lzMergeCoverage(
        [
          { static: { 1: 1 }, perTest: { first: { 1: 1, 2: 1 } } },
          { static: {}, perTest: { first: { 2: 3 }, second: { 4: 1 } } },
        ],
        false,
      ),
      { static: { 1: 2, 2: 4, 4: 1 }, perTest: {} },
    );
  });
});

describe('lzOverlapCoverage', () => {
  const hits = { 1: 2, 2: 1 };
  const own = { 9: 1 };
  /** `a`, then no test, then `b`, `c`; later `p`, its subtest `p > x`, and `p` again. */
  const testSpans = {
    a: [{ start: 0, end: 10 }],
    b: [{ start: 12, end: 20 }],
    c: [{ start: 22, end: 30 }],
    p: [
      { start: 40, end: 50 },
      { start: 60, end: 70 },
    ],
    'p > x': [{ start: 50, end: 60 }],
  };
  const descendant = (test: string, lifetime?: { start: number; end: number }) => ({
    tests: [],
    mutantCoverage: { static: own, perTest: { [test]: hits } },
    ...(lifetime && { lifetime }),
  });
  const attributed = (perTest: readonly string[], outside = false) => ({
    static: outside ? { 1: 2, 2: 1, 9: 1 } : own,
    perTest: Object.fromEntries(perTest.map((test) => [test, hits])),
  });

  lzTestFor<readonly [string, string, { start: number; end: number }, readonly string[]]>([
    ['one span of its test', 'a', { start: 3, end: 8 }, ['a']],
    ["its subtest's span", 'p > x', { start: 52, end: 58 }, ['p > x']],
  ])("keeps a descendant's hits per test when it lives inside %s", ([, test, lifetime, tests]) => {
    assert.deepEqual(lzOverlapCoverage(descendant(test, lifetime), testSpans), attributed(tests));
  });

  lzTestFor<readonly [string, { start: number; end: number }]>([
    ['ends during the subtest', { start: 52, end: 58 }],
    ['ends after the subtest', { start: 52, end: 65 }],
  ])('gives the hits of a descendant that a test starts and its subtest uses to both, when it %s', ([, lifetime]) => {
    assert.deepEqual(lzOverlapCoverage(descendant('p', lifetime), testSpans), attributed(['p', 'p > x']));
  });

  lzTestFor<readonly [string, { start: number; end: number }]>([
    ['starts during that test', { start: 5, end: 15 }],
    ['starts only after that test', { start: 11, end: 15 }],
  ])(
    'gives the hits of a descendant that outlives the test that started it to that test, every later test it overlapped and static, when it %s',
    ([, lifetime]) => {
      assert.deepEqual(lzOverlapCoverage(descendant('a', lifetime), testSpans), attributed(['a', 'b'], true));
    },
  );

  it('gives the hits of a descendant that outlives every test to the tests it overlapped and to static', () => {
    assert.deepEqual(lzOverlapCoverage(descendant('c', { start: 25, end: 35 }), testSpans), attributed(['c'], true));
  });

  it('gives the hits a descendant puts under a test without spans to the tests it overlapped', () => {
    assert.deepEqual(
      lzOverlapCoverage(descendant('gone', { start: 3, end: 15 }), testSpans),
      attributed(['a', 'b'], true),
    );
  });

  it("counts a descendant's hits as static without its lifetime or the file's spans", () => {
    assert.deepEqual(lzOverlapCoverage(descendant('a'), testSpans), attributed([], true));
    assert.deepEqual(lzOverlapCoverage(descendant('a', { start: 3, end: 8 }), undefined), attributed([], true));
  });

  it("leaves the test file's own coverage per test, and a record without coverage without it", () => {
    const coverage = { static: own, perTest: { a: hits } };

    assert.deepEqual(lzOverlapCoverage({ main: true, tests: [], mutantCoverage: coverage }, {}), coverage);
    assert.equal(lzOverlapCoverage({ tests: [], lifetime: { start: 3, end: 8 } }, testSpans), undefined);
  });
});

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
    `To reproduce it, run \`node "--no-deprecation" "${file}"\` in ${process.cwd()} ` +
    'with NODE_OPTIONS set to `--import "hook" --stack-size=900`.';

  lzTestFor<
    readonly [
      string,
      number | null,
      string,
      readonly { readonly diagnostics?: readonly string[]; readonly heldOpen?: readonly string[] }[],
      readonly string[],
    ]
  >([
    ['trimmed stderr', 1, '  \nline 1\nline 2 \n', [], ['Stderr:', 'line 1', 'line 2']],
    ['no stderr', 3, ' \n', [], []],
    ['the missing exit code of a killed process', null, '', [], []],
    [
      'the diagnostics of every process',
      1,
      'out',
      [{ diagnostics: ['late 1'] }, {}, { diagnostics: ['late 2'] }],
      ['Diagnostics:', 'late 1', 'late 2', 'Stderr:', 'out'],
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
      args: ['--no-deprecation', file],
      nodeOptions: '--import "hook" --stack-size=900',
    };

    assert.equal(
      lzFileError(file, run),
      [`Error running file "${file}": node exited with code ${exitCode} outside any test.`, command, ...end].join('\n'),
    );
  });
});

describe('LzStrykerNodeTestRunner options', () => {
  const runner = (lzStrykerNodeTest: unknown) =>
    new LzStrykerNodeTestRunner({ ...strykerOptions(), lzStrykerNodeTest }, logger());

  lzTestEach([
    ['no options', undefined],
    ['empty options', {}],
    ['every option', { testFiles: ['a.test.ts'], nodeArgs: ['--enable-source-maps'], maxMemoryMB: 512 }],
  ])('takes %s', (_title, options) => {
    assert.ok(runner(options) instanceof LzStrykerNodeTestRunner);
  });

  lzTestFor([null, [], 'options'])('refuses %j, which is no options object', (options) => {
    assert.throws(() => runner(options), { message: 'not valid lzStrykerNodeTest options' });
  });

  lzTestEach([
    [{ testFiles: 'a.test.ts' }, 'testFiles'],
    [{ testFiles: [1] }, 'testFiles'],
    [{ nodeArgs: '--enable-source-maps' }, 'nodeArgs'],
    [{ nodeArgs: [null] }, 'nodeArgs'],
    [{ maxMemoryMB: '512' }, 'maxMemoryMB'],
  ])('refuses %j, naming %s', (options, field) => {
    assert.throws(() => runner(options), { message: `not valid lzStrykerNodeTest options: ${field}` });
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

  it("names Stryker's active mutant variable as the hook does", () => {
    assert.equal(activeMutantEnv, activeMutant);
  });

  it('loads the hook before inherited options and drops the outer run state', () => {
    const base = {
      PATH: 'path',
      NODE_OPTIONS: '--max-old-space-size=100',
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

    assert.deepEqual(lzRunEnv(base, file, out, tmp, { dryRun: false, disableBail: true }, undefined), {
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

  it('drops the node:test reporters and destinations of inherited options, also quoted ones', () => {
    const nodeOptions = [
      '--test-reporter=spec',
      '--max-old-space-size=100',
      '--test-reporter dot',
      '"--test-reporter-destination=a b"',
      '--test-reporter-destination  stdout',
      '--title="a \\" --test-reporter=b"',
      '--test-reporter-destinations=x',
    ].join(' ');
    const kept = ['--max-old-space-size=100', '--title="a \\" --test-reporter=b"', '--test-reporter-destinations=x'];

    assert.equal(
      lzRunEnv({ NODE_OPTIONS: nodeOptions }, file, out, tmp, { dryRun: false, disableBail: true }, undefined)
        .NODE_OPTIONS,
      [`--import ${JSON.stringify(hookUrl)}`, ...kept].join(' '),
    );
  });

  it("uses the runner's compile cache directory unless the environment names one", () => {
    const run = { dryRun: false, disableBail: false } satisfies LzRunOptions;

    const inherited = { NODE_COMPILE_CACHE: 'inherited' };

    assert.equal(lzRunEnv({}, file, out, tmp, run, 'own')['NODE_COMPILE_CACHE'], 'own');
    assert.equal(lzRunEnv(inherited, file, out, tmp, run, 'own')['NODE_COMPILE_CACHE'], 'inherited');
    assert.equal(lzRunEnv(inherited, file, out, tmp, run, undefined)['NODE_COMPILE_CACHE'], 'inherited');
  });

  it('passes the run state and the memory limit on to the test file', () => {
    assert.deepEqual(
      lzRunEnv(
        {},
        file,
        out,
        tmp,
        {
          dryRun: false,
          disableBail: true,
          activeMutant: '12',
          hitLimit: 40,
          testFilter: [`${file} > test`],
        },
        undefined,
        1500,
      ),
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
        [envNames.filter]: JSON.stringify([`${file} > test`]),
      },
    );
  });

  it('activates the mutant from the start of the process, or for the hook to activate once the tests start', () => {
    const run = { dryRun: false, disableBail: false, activeMutant: '12' } satisfies LzRunOptions;
    const active = (mutantActivation: 'runtime' | 'static') => {
      const env = lzRunEnv({}, file, out, tmp, { ...run, mutantActivation }, undefined);

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
    ).map((run) => lzRunEnv({}, file, out, tmp, run, undefined)[envNames.bail]);

    assert.deepEqual(bails, ['true', undefined, undefined, undefined]);
  });
});
