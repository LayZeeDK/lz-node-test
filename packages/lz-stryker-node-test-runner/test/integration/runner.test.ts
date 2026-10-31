import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { DryRunStatus } from '@stryker-mutator/api/test-runner';

import { lzTestFor } from '@layzee/lz-node-test';
import { envNames } from '../../src/record.ts';
import {
  complete,
  dryRun,
  failing,
  fixture,
  initRunner,
  logger,
  noProcess,
  ownCacheDirs,
  passed,
  passing,
  project,
  reporterArg,
  settle,
  shareCompileCache,
  summary,
  strykerOptions,
} from '../runner.fixtures.ts';
import { LzStrykerNodeTestRunner, type LzStrykerNodeTestOptions } from '../../src/index.ts';

const compileCache = shareCompileCache();

function writesOnLoad(file: string, expression: string): string {
  return fixture(
    "import { writeFileSync } from 'node:fs';",
    `writeFileSync('${file}', ${expression});`,
    "it('passes', () => {});",
  );
}

describe('LzStrykerNodeTestRunner', () => {
  it('can reload the environment', () => {
    assert.deepEqual(new LzStrykerNodeTestRunner(strykerOptions(), logger()).capabilities(), {
      reloadEnvironment: true,
    });
  });

  it('runs nothing before it is initialized', async () => {
    const runner = new LzStrykerNodeTestRunner(strykerOptions(), logger());

    assert.deepEqual(await settle(runner.dryRun(dryRun)), {
      status: DryRunStatus.Complete,
      tests: [],
      mutantCoverage: { static: {}, perTest: {} },
    });
  });

  it('rejects, instead of throwing, when the dry run fails before it runs a file', async () => {
    const runner = new LzStrykerNodeTestRunner(strykerOptions(), logger());

    // @ts-expect-error -- a test file that is no string, which makes the dry run fail before it runs a file
    await assert.rejects(runner.dryRun({ ...dryRun, testFiles: [42] }), TypeError);
  });

  it('can be disposed without being initialized', async () => {
    const debug: string[] = [];
    const warnings: string[] = [];

    await new LzStrykerNodeTestRunner(strykerOptions(), logger({ debug, warnings })).dispose();

    assert.deepEqual([debug, warnings], [[], []]);
  });

  it('fails to initialize without test files', async (t) => {
    project(t, { 'a.test.mjs': passing });
    const options = { lzStrykerNodeTest: { testFiles: ['none/*.test.mjs'] } };
    const runner = new LzStrykerNodeTestRunner(strykerOptions(options), logger());

    await assert.rejects(runner.init(), { message: 'No test files match ["none/*.test.mjs"]' });
    await runner.dispose();
  });

  lzTestFor<readonly [string, string, string | undefined]>([
    [
      'refuses',
      '21.20.0',
      'The lz-stryker-node-test test runner needs Node.js 22.18 or later, and this is Node.js 21.20.0.',
    ],
    [
      'refuses',
      '22.17.1',
      'The lz-stryker-node-test test runner needs Node.js 22.18 or later, and this is Node.js 22.17.1.',
    ],
    ['runs on', '22.18.0', undefined],
    ['runs on', '23.0.0', undefined],
  ])('%s Node.js %s', async ([, version, message], t) => {
    const value = process.versions.node;
    Object.defineProperty(process.versions, 'node', { value: version });
    t.after(() => Object.defineProperty(process.versions, 'node', { value }));
    project(t, { 'a.test.mjs': passing });
    const runner = new LzStrykerNodeTestRunner(
      strykerOptions({ lzStrykerNodeTest: { testFiles: ['a.test.mjs'] } }),
      logger(),
    );
    t.after(() => runner.dispose());

    if (message === undefined) {
      await runner.init();
    } else {
      await assert.rejects(runner.init(), { message });
    }
  });

  it("warns and runs nothing without test files when Stryker's allowEmpty is set", async (t) => {
    project(t, { 'a.test.mjs': failing });
    const warnings: string[] = [];
    const options = { allowEmpty: true, lzStrykerNodeTest: { testFiles: ['none/*.test.mjs'] } };
    const runner = new LzStrykerNodeTestRunner(strykerOptions(options), logger({ debugEnabled: false, warnings }));
    t.after(() => runner.dispose());

    await runner.init();

    assert.deepEqual(warnings, ['No test files match ["none/*.test.mjs"]; running none, as allowEmpty is set.']);
    assert.deepEqual(await settle(runner.dryRun(dryRun)), {
      status: DryRunStatus.Complete,
      tests: [],
      mutantCoverage: { static: {}, perTest: {} },
    });
  });

  it('keeps the compile cache of the processes a run starts in its own directory, until it is disposed', async (t) => {
    const dir = project(t, { 'a.test.mjs': writesOnLoad('cache-dir.txt', 'process.env.NODE_COMPILE_CACHE') });
    const before = ownCacheDirs();
    t.after(() => {
      process.env['NODE_COMPILE_CACHE'] = compileCache;
    });
    delete process.env['NODE_COMPILE_CACHE'];
    const runner = await initRunner(['a.test.mjs']);

    const { exitCode } = await settle(runner.runFile(join(dir, 'a.test.mjs'), { dryRun: false, disableBail: false }));

    assert.equal(exitCode, 0);
    const cacheDir = readFileSync(join(dir, 'cache-dir.txt'), 'utf8');
    assert.equal(dirname(cacheDir), resolve(tmpdir()));
    assert.deepEqual(ownCacheDirs(), [...before, basename(cacheDir)].sort());
    // Node keys the cache by its version, then by file: one entry per hook module, written when the process exits.
    const entries = readdirSync(cacheDir).flatMap((version) => readdirSync(join(cacheDir, version)));
    assert.ok(entries.length >= 2, `cache entries: ${entries.join(', ')}`);

    await runner.dispose();

    assert.deepEqual(ownCacheDirs(), before);
  });

  it('creates no compile cache directory when the environment names one', async (t) => {
    const dir = project(t, { 'a.test.mjs': writesOnLoad('cache-dir.txt', 'process.env.NODE_COMPILE_CACHE') });
    const before = ownCacheDirs();
    const runner = await initRunner(['a.test.mjs']);

    await settle(runner.runFile(join(dir, 'a.test.mjs'), { dryRun: false, disableBail: false }));

    assert.equal(readFileSync(join(dir, 'cache-dir.txt'), 'utf8'), compileCache);
    assert.deepEqual(ownCacheDirs(), before);
    await runner.dispose();
  });

  it('fails a run when node cannot start', async (t) => {
    const dir = project(t, { 'a.test.mjs': passing });
    const execPath = process.execPath;
    t.after(() => {
      process.execPath = execPath;
    });
    process.execPath = join(dir, 'missing-node');
    const runner = await initRunner(['a.test.mjs']);

    await assert.rejects(
      settle(
        runner.runFile(join(dir, 'a.test.mjs'), { dryRun: true, disableBail: false, coverageAnalysis: 'perTest' }),
        1_000,
      ),
      {
        code: 'ENOENT',
      },
    );

    // Node emits close after the error; letting it fire within this test keeps its coverage attributed to the test.
    await setTimeout(100);
  });

  it('removes the directories that runners of ended processes left behind when it is initialized', async (t) => {
    project(t, { 'a.test.mjs': passing });
    const left = join(tmpdir(), `lz-stryker-node-test-${noProcess}-left`);
    mkdirSync(join(left, 'out'), { recursive: true });
    t.after(() => rmSync(left, { recursive: true, force: true }));

    await initRunner(['a.test.mjs']);

    assert.ok(!existsSync(left), `left behind: ${left}`);
  });

  it('removes its output directory after a run', async (t) => {
    const dir = project(t, { 'a.test.mjs': writesOnLoad('out-dir.txt', `process.env.${envNames.out}`) });
    const runner = await initRunner(['a.test.mjs']);

    const { records, exitCode, stderr } = await settle(
      runner.runFile(join(dir, 'a.test.mjs'), { dryRun: false, disableBail: false }),
    );

    assert.deepEqual({ exitCode, stderr, count: records.length }, { exitCode: 0, stderr: '', count: 1 });
    const outDir = readFileSync(join(dir, 'out-dir.txt'), 'utf8');
    assert.equal(dirname(dirname(outDir)), resolve(tmpdir()));
    assert.ok(basename(dirname(outDir)).startsWith(`lz-stryker-node-test-${process.pid}-`), outDir);
    assert.ok(!existsSync(dirname(outDir)));
  });

  lzTestFor([
    "fork(import.meta.filename, ['child'])",
    "fork(process.argv[1], ['child'])",
    "spawn(process.execPath, [import.meta.filename, 'child'], { stdio: 'ignore', windowsHide: true })",
  ])("takes the test file's own record, not that of a process it starts with %s", async (start, t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { fork, spawn } from 'node:child_process';",
        "if (process.argv[2] === 'child') {",
        '  process.exit(0);',
        '} else {',
        "  it('starts itself', async () => {",
        `    const child = ${start};`,
        "    assert.equal(await new Promise((resolve) => child.on('exit', resolve)), 0);",
        '  });',
        '}',
      ),
    });
    const file = join(dir, 'a.test.mjs');
    const runner = await initRunner(['a.test.mjs']);

    const { records } = await settle(
      runner.runFile(file, { dryRun: true, disableBail: false, coverageAnalysis: 'off' }),
    );

    assert.deepEqual(
      records.filter((record) => record.main).map((record) => record.tests.map(({ id }) => id)),
      [[`${file} > starts itself`]],
    );
  });

  lzTestFor<readonly [string, string]>([
    ['exits', ''],
    ['exits through process.exit', 'process.exit(1);'],
    ['is killed', "process.kill(process.pid, 'SIGKILL');"],
    [
      'leaves a process working in it for a moment',
      "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], " +
        "{ cwd: left, detached: true, windowsHide: true, stdio: 'ignore' }).unref();",
    ],
  ])('removes what a test file leaves in the temporary directory when it %s', async ([, exit], t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { spawn } from 'node:child_process';",
        "import { mkdtempSync, writeFileSync } from 'node:fs';",
        "import { tmpdir } from 'node:os';",
        "import { join } from 'node:path';",
        "const left = mkdtempSync(join(tmpdir(), 'left-'));",
        "writeFileSync('left.txt', left);",
        exit,
      ),
    });
    const runner = await initRunner(['a.test.mjs']);

    await settle(runner.runFile(join(dir, 'a.test.mjs'), { dryRun: false, disableBail: false }));

    const left = readFileSync(join(dir, 'left.txt'), 'utf8');
    t.after(() => rmSync(left, { recursive: true, force: true }));
    assert.ok(!existsSync(left), `left behind: ${left}`);
  });

  it('keeps multi-byte characters intact in stderr that spans several reads', async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture("process.stderr.write('\\u20ac'.repeat(100_000));", 'process.exitCode = 5;'),
    });
    const runner = await initRunner(['a.test.mjs']);

    const { stderr } = await settle(
      runner.runFile(join(dir, 'a.test.mjs'), { dryRun: false, disableBail: false }),
      2_000,
    );

    assert.equal(stderr, String.fromCodePoint(0x20ac).repeat(100_000));
  });

  it('ends a run whose test file writes more to stdout than a pipe holds', async (t) => {
    const dir = project(t, { 'a.test.mjs': fixture("process.stdout.write('x'.repeat(1_000_000));") });
    const runner = await initRunner(['a.test.mjs']);

    const { exitCode } = await settle(
      runner.runFile(join(dir, 'a.test.mjs'), { dryRun: false, disableBail: false }),
      2_000,
    );

    assert.equal(exitCode, 0);
  });

  it('ends a run soon after its test file exits, while a process the tests started keeps stderr open', async (t) => {
    let dir = '';
    // Registered ahead of the project's cleanup, which removes the file the daemon's id is in.
    t.after(() => {
      if (existsSync(join(dir, 'daemon.pid'))) {
        process.kill(Number(readFileSync(join(dir, 'daemon.pid'), 'utf8')));
      }
    });
    dir = project(t, {
      'a.test.mjs': fixture(
        "import { spawn } from 'node:child_process';",
        "import { writeFileSync } from 'node:fs';",
        "it('starts a daemon', () => {",
        "  const daemon = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20_000)'], {",
        "    cwd: '/',",
        '    detached: true, windowsHide: true,',
        "    stdio: 'inherit',",
        '  });',
        '  daemon.unref();',
        "  writeFileSync('daemon.pid', String(daemon.pid));",
        '});',
        "process.on('exit', () => process.stderr.write('before exit'));",
      ),
    });
    const runner = await initRunner(['a.test.mjs']);
    const pipes = () => process.getActiveResourcesInfo().filter((resource) => resource === 'PipeWrap').length;
    const pipesBefore = pipes();
    const started = performance.now();

    const { exitCode, stderr, records } = await settle(
      runner.runFile(join(dir, 'a.test.mjs'), { dryRun: false, disableBail: false }),
      30_000,
    );

    assert.ok(performance.now() - started < 5_000, `took ${performance.now() - started} ms`);
    assert.deepEqual([exitCode, stderr, records.some((record) => record.main)], [0, 'before exit', true]);
    assert.equal(pipes(), pipesBefore);
  });

  it("reports a test file as an error when a file at another process's record name does not parse", async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        'it(\'passes\', () => { writeFileSync(join(process.env.LZ_STRYKER_NODE_TEST_OUT, `${process.pid}.1.json`), "{"); });',
      ),
    });
    const runner = await initRunner(['a.test.mjs']);

    const result = await settle(runner.dryRun(dryRun));

    assert.strictEqual(result.status, DryRunStatus.Error);
    const prefix = `Unreadable test results for "${join(dir, 'a.test.mjs')}": `;
    assert.ok(result.errorMessage.startsWith(prefix), result.errorMessage);
    assert.match(result.errorMessage.slice(prefix.length), /^\d+\.1\.json: /);
  });

  lzTestFor<readonly [string, string]>([
    ['does not parse', '{'],
    ['lists no tests', '{}'],
  ])('reports a test file whose own record %s as an error', async ([, content], t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { writeFileSync } from 'node:fs';",
        "import { join } from 'node:path';",
        "it('passes', () => {});",
        // The hook's beforeExit listener runs first and moves its exit listener last, so this exit listener comes after
        // it and replaces the record the hook has written.
        "process.on('beforeExit', () => process.on('exit', () => writeFileSync(" +
          'join(process.env.LZ_STRYKER_NODE_TEST_OUT, `${process.pid}.0.json`), ' +
          `${JSON.stringify(content)})));`,
      ),
    });
    const runner = await initRunner(['a.test.mjs']);

    const result = await settle(runner.dryRun(dryRun));

    assert.strictEqual(result.status, DryRunStatus.Error);
    const prefix = `Unreadable test results for "${join(dir, 'a.test.mjs')}": `;
    assert.ok(result.errorMessage.startsWith(prefix), result.errorMessage);
    assert.ok(result.errorMessage.length > prefix.length, result.errorMessage);
  });

  lzTestFor([{}, { lzStrykerNodeTest: {} }])(
    "runs the .spec and .test files that Nx's convention names, outside node_modules, by default, with the options %j",
    async (options, t) => {
      const dir = project(t, {
        'a.test.ts': passing,
        [join('sub', 'b.spec.js')]: passing,
        [join('node_modules', 'pkg', 'c.test.ts')]: failing,
        'd.test.mjs': failing,
        'e.ts': failing,
      });
      const runner = await initRunner(undefined, options.lzStrykerNodeTest);
      t.after(() => runner.dispose());

      const { tests } = complete(await settle(runner.dryRun({ ...dryRun, disableBail: true })));

      assert.deepEqual(summary(tests), [
        passed(`${join(dir, 'a.test.ts')} > passes`),
        passed(`${join(dir, 'sub', 'b.spec.js')} > passes`),
      ]);
    },
  );

  it('passes lzStrykerNodeTest.nodeArgs to the node process of each test file', async (t) => {
    const dir = project(t, { 'a.test.mjs': writesOnLoad('exec-argv.json', 'JSON.stringify(process.execArgv)') });
    const execArgv = async (lzStrykerNodeTest: LzStrykerNodeTestOptions) => {
      const runner = await initRunner(undefined, lzStrykerNodeTest);
      await settle(runner.runFile(join(dir, 'a.test.mjs'), { dryRun: false, disableBail: false }));

      const argv: unknown = JSON.parse(readFileSync(join(dir, 'exec-argv.json'), 'utf8'));
      assert.ok(Array.isArray(argv), String(argv));
      assert.ok(
        argv.every((arg) => typeof arg === 'string'),
        String(argv),
      );

      return argv;
    };
    const nodeArgs = ['--no-deprecation', '--stack-size=900'];
    const reporters = ['--test-reporter', 'spec', '--test-reporter-destination=stdout'];
    const withReporters = { testFiles: ['a.test.mjs'], nodeArgs: [...reporters, ...nodeArgs] };

    assert.deepEqual(await execArgv(withReporters), [reporterArg, ...nodeArgs]);
    assert.deepEqual(await execArgv({ testFiles: ['a.test.mjs'] }), [reporterArg]);
  });

  it('runs its own reporter only, whatever reporters NODE_OPTIONS and lzStrykerNodeTest.nodeArgs name', async (t) => {
    const dir = project(t, { 'a.test.mjs': passing });
    const nodeOptions = process.env['NODE_OPTIONS'];
    t.after(() => {
      if (nodeOptions === undefined) {
        delete process.env['NODE_OPTIONS'];
      } else {
        process.env['NODE_OPTIONS'] = nodeOptions;
      }
    });
    process.env['NODE_OPTIONS'] = `${nodeOptions ?? ''} --test-reporter=spec`;
    const runner = await initRunner(['a.test.mjs'], { nodeArgs: ['--test-reporter=dot'] });

    assert.deepEqual(summary(complete(await settle(runner.dryRun(dryRun))).tests), [
      passed(`${join(dir, 'a.test.mjs')} > passes`),
    ]);
  });

  it('runs a test file once when several patterns match it', async (t) => {
    const dir = project(t, { 'a.test.mjs': passing });
    const runner = await initRunner(['a.test.mjs', '*.test.mjs', './a.test.mjs', join(dir, 'a.test.mjs')]);

    const { tests } = complete(await settle(runner.dryRun(dryRun)));

    assert.deepEqual(summary(tests), [passed(`${join(dir, 'a.test.mjs')} > passes`)]);
  });

  it('logs the node command and directory of each test file, only when debug logging is on', async (t) => {
    const dir = project(t, { 'a.test.mjs': passing });
    const file = join(dir, 'a.test.mjs');
    const debugOf = async (debugEnabled: boolean) => {
      const debug: string[] = [];
      const runner = await initRunner(
        ['a.test.mjs'],
        { nodeArgs: ['--no-deprecation'] },
        { log: logger({ debug, debugEnabled }) },
      );
      await settle(runner.runFile(file, { dryRun: false, disableBail: false }));

      return debug;
    };

    assert.deepEqual(await debugOf(true), [
      `Running: \`node "${reporterArg}" "--no-deprecation" "${file}"\` in ${dir}`,
    ]);
    assert.deepEqual(await debugOf(false), []);
  });
});
