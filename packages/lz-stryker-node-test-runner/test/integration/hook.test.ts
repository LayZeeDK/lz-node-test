import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import { lzTestFor } from '@layzee/lz-node-test';
import {
  installed,
  reporting,
  type GlobalSlots,
  type HookDependencies,
  type TestEvent,
  watchdog,
} from '../../src/hook-core.ts';
import { fixture, grows, hookUrl, reporterArg, shareCompileCache } from '../runner.fixtures.ts';
import { envNames, lzParseRecord, lzParseRecordName, type LzRecordName, type ProcessRecord } from '../../src/record.ts';
import { lzEndingSignals } from '../../src/record-writer.ts';
import reporter from '../../src/reporter.ts';

// Loaded here, outside any test, the hook stays inactive (the runner did not start this process, or its own hook is
// installed), and Stryker counts the hook's mutants as covered by every test, including those that run it in a child.
const { activeResources, exit, later, now } = await import('../../src/hook.ts');

shareCompileCache();

/** Loads the hook as in a process the runner started; it leaves no listener behind, and counts the signal listeners. */
async function loadRunnerStartedHook(
  outDir: string,
  env: Record<string, string> = {},
): Promise<Record<'exit' | 'beforeExit', ((code: number) => void)[]> & { signals: Record<string, number> }> {
  const global: HookDependencies['global'] = globalThis;
  const previousMark = global[installed];
  const previousEnv = Object.values(envNames)
    .filter((key) => key !== envNames.current)
    .map((key): readonly [string, string | undefined] => [key, process.env[key]]);
  const listeners = { exit: process.listeners('exit'), beforeExit: process.listeners('beforeExit') };
  const signalListeners = lzEndingSignals.map((signal) => ({ signal, before: process.listeners(signal) }));

  for (const [key] of previousEnv) {
    delete process.env[key];
  }

  Object.assign(process.env, { [envNames.out]: outDir, ...env });
  delete global[installed];

  try {
    // A query of its own makes each load run the hook's module again.
    await import(`${hookUrl}?runner-started-${randomUUID()}`);
  } finally {
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    if (previousMark) {
      global[installed] = previousMark;
    } else {
      delete global[installed];
    }
  }

  return {
    exit: takeAddedListeners('exit', listeners.exit),
    beforeExit: takeAddedListeners('beforeExit', listeners.beforeExit),
    signals: Object.fromEntries(
      signalListeners.map(({ signal, before }) => {
        const added = process.listeners(signal).filter((listener) => !before.includes(listener));
        added.forEach((listener) => process.removeListener(signal, listener));

        return [signal, added.length];
      }),
    ),
  };
}

function takeAddedListeners(
  event: 'exit' | 'beforeExit',
  before: readonly ((code: number) => void)[],
): ((code: number) => void)[] {
  const current = event === 'exit' ? process.listeners('exit') : process.listeners('beforeExit');
  const added = current.filter((listener) => !before.includes(listener));

  for (const listener of added) {
    process.removeListener(event, listener);
  }

  return added;
}

function tempDir(t: TestContext): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'hook-test-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  return dir;
}

/** It keeps Stryker's active mutant, so a mutant in hook.ts reaches the process that loads it. */
function hookedEnv(env: Record<string, string>): NodeJS.ProcessEnv {
  const dropped: string[] = ['NODE_OPTIONS', 'NODE_TEST_CONTEXT', ...Object.values(envNames)];
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !dropped.includes(key)));

  return { ...base, ...env };
}

async function runWithHook(args: string[], env: Record<string, string>): Promise<{ code: number | null; pid: number }> {
  const child = spawn(process.execPath, ['--import', hookUrl, reporterArg, ...args], {
    env: hookedEnv(env),
    stdio: 'ignore',
  });

  await once(child, 'close');

  if (child.pid === undefined) {
    throw new Error('The child process started without a pid.');
  }

  return { code: child.exitCode, pid: child.pid };
}

function readRecords(outDir: string): Record<string, ProcessRecord> {
  return Object.fromEntries(
    readdirSync(outDir).map((name) => [name, lzParseRecord(readFileSync(join(outDir, name), 'utf8'))]),
  );
}

/** The record that the process `pid` wrote from `thread`, by its name. */
function recordOf(
  records: Record<string, ProcessRecord>,
  pid: number,
  thread: LzRecordName['thread'],
): ProcessRecord | undefined {
  return Object.entries(records).find(([name]) => {
    const parsed = lzParseRecordName(name);

    return parsed?.pid === pid && parsed.thread === thread;
  })?.[1];
}

/** The record without its lifetime, once that runs from when the hook ran up to now on the clock this process reads. */
function untimed(record: ProcessRecord | undefined): Omit<ProcessRecord, 'lifetime'> | undefined {
  if (record === undefined) {
    return undefined;
  }

  const { lifetime, ...rest } = record;
  const now = Number(process.hrtime.bigint()) / 1e6;
  assert.ok(lifetime, 'The record has no lifetime.');
  assert.ok(lifetime.start <= lifetime.end, JSON.stringify(lifetime));
  assert.ok(lifetime.end <= now, JSON.stringify({ lifetime, now }));
  assert.ok(now - lifetime.start < 60_000, JSON.stringify({ lifetime, now }));

  return rest;
}

async function runTestFile(
  t: TestContext,
  source: string,
  {
    name = 'fixture.test.mjs',
    dir = tempDir(t),
    env = {},
    args = [],
  }: { name?: string; dir?: string; env?: Record<string, string>; args?: string[] } = {},
) {
  const outDir = tempDir(t);
  const testFile = join(dir, name);
  writeFileSync(testFile, source);

  const { code, pid } = await runWithHook([...args, testFile], {
    [envNames.out]: outDir,
    [envNames.file]: testFile,
    ...env,
  });
  const records = readRecords(outDir);

  return { code, pid, testFile, records, record: recordOf(records, pid, 0) };
}

describe('hook', () => {
  it('writes the record of a process the runner started when the process exits', async (t) => {
    const outDir = tempDir(t);
    const bail = process.env[envNames.bail];
    process.env[envNames.bail] = 'true';
    t.after(() => {
      if (bail === undefined) {
        delete process.env[envNames.bail];
      } else {
        process.env[envNames.bail] = bail;
      }
    });
    const hookEnv = () => Object.fromEntries(Object.values(envNames).map((key) => [key, process.env[key]]));
    const before = hookEnv();
    const added = await loadRunnerStartedHook(outDir);

    assert.deepEqual(hookEnv(), before);
    assert.deepEqual([added.exit.length, added.beforeExit.length], [1, 1]);
    // Windows has no signals to catch: every kill there is TerminateProcess.
    const signalListeners = process.platform === 'win32' ? 0 : 1;
    assert.deepEqual(added.signals, { SIGTERM: signalListeners, SIGINT: signalListeners, SIGHUP: signalListeners });

    added.exit[0]?.(0);

    const records = readRecords(outDir);
    const record = recordOf(records, process.pid, 0);
    assert.deepEqual(Object.values(records), [record]);
    assert.deepEqual(record?.tests, []);
  });

  it("moves its exit listener behind the process's others when the process ends by itself", async (t) => {
    const { exit, beforeExit } = await loadRunnerStartedHook(tempDir(t));
    const [write] = exit;
    const later = () => {};

    assert.ok(write, 'The hook added no exit listener.');

    process.on('exit', write);
    process.on('exit', later);
    t.after(() => {
      process.off('exit', write);
      process.off('exit', later);
    });

    beforeExit[0]?.(0);

    const listeners = process.listeners('exit');
    assert.deepEqual(listeners.slice(-2), [later, write]);
    assert.equal(listeners.filter((listener) => listener === write).length, 1);
  });

  it('starts the memory watchdog, survives its failure, and records the peak memory, when the runner asks', async (t) => {
    const outDir = tempDir(t);
    const global: GlobalSlots = globalThis;
    const unref = t.mock.method(Worker.prototype, 'unref');

    const added = await loadRunnerStartedHook(outDir, { [envNames.dryRun]: 'true', [envNames.memoryLimit]: '1000000' });

    const watching = global[watchdog];
    assert.ok(watching instanceof Worker, String(watching));
    t.after(() => watching.terminate());
    assert.deepEqual(
      unref.mock.calls.map((call) => call.this),
      [watching],
    );
    watching.emit('error', new Error('preload failed'));

    const rssMB = Math.floor(process.memoryUsage.rss() / 1048576);
    added.exit[0]?.(0);
    const peakMB = recordOf(readRecords(outDir), process.pid, 0)?.peakMemoryMB;
    assert.ok(peakMB, 'The record has no peak memory.');

    assert.ok(Number.isInteger(peakMB), String(peakMB));
    assert.ok(peakMB >= rssMB, `${peakMB} MB, below the ${rssMB} MB held`);
    assert.ok(peakMB < 100_000, String(peakMB));
  });

  it("keeps a worker thread's record apart from the test file's, as a worker started from a file loads the hook too", async (t) => {
    const dir = tempDir(t);
    writeFileSync(join(dir, 'worker.mjs'), 'globalThis.__stryker__.hitCount = 999;\n');

    const { code, pid, records, record } = await runTestFile(
      t,
      fixture(
        "import { Worker } from 'node:worker_threads';",
        "it('starts a worker', async () => {",
        "  const worker = new Worker(new URL('./worker.mjs', import.meta.url));",
        "  await new Promise((resolve) => worker.on('exit', resolve));",
        '});',
      ),
      { dir },
    );

    assert.equal(code, 0);
    const workers = Object.entries(records).filter(([, other]) => other !== record);
    assert.equal(record?.main, true);
    assert.deepEqual(
      workers.map(([name, worker]) => {
        const parsed = lzParseRecordName(name);

        return [parsed?.pid === pid && parsed.thread !== 0 && parsed.nonce !== undefined, worker.main, worker.hitCount];
      }),
      [[true, undefined, 999]],
    );
  });

  it('ends the process with the code it is given, or else with the exit code set before', (t) => {
    const codes: unknown[] = [];
    t.mock.method(process, 'exit', (code?: number) => {
      codes.push(code);
    });
    const previous = process.exitCode;
    t.after(() => {
      process.exitCode = previous;
    });
    process.exitCode = 3;

    exit(1);
    exit();

    assert.deepEqual(codes, [1, 3]);
  });

  it('calls back after the delay without keeping the process alive', (t) => {
    const timers: unknown[] = [];
    let unrefs = 0;
    t.mock.method(globalThis, 'setTimeout', (callback: () => void, ms: number) => {
      timers.push([callback, ms]);

      return { unref: () => unrefs++ };
    });
    const callback = () => {};

    later(callback, 250);

    assert.deepEqual([timers, unrefs], [[[callback, 250]], 1]);
  });

  it('keeps reading the clock when a test replaces process.hrtime, as fake timers do', () => {
    const real = process.hrtime;
    const before = Number(real.bigint()) / 1e6;
    let read: number;

    try {
      process.hrtime = Object.assign((): [number, number] => [0, 5], { bigint: () => 5n });
      read = now();
    } finally {
      process.hrtime = real;
    }

    assert.ok(read >= before, `${read} ms, before the ${before} ms read ahead of it`);
  });

  it("lists the process's active resources", () => {
    assert.deepEqual(activeResources(), process.getActiveResourcesInfo());
  });

  const leavesServer = (name: string, then = '') =>
    `it('${name}', async () => { await new Promise((resolve) => createServer().listen(0, resolve)); ${then} });`;

  lzTestFor<
    readonly [
      string,
      {
        name: string;
        then: string;
        heldOpenMs: string;
        exitCode: number;
        status: string;
        marks: Record<string, unknown>;
      },
    ]
  >([
    [
      'with exit code 1 at once, when a test failed',
      { name: 'fails', then: 'assert.fail();', heldOpenMs: '60000', exitCode: 1, status: 'failed', marks: {} },
    ],
    [
      "with node:test's exit code once the held-open time ends, naming the server, when its tests passed",
      {
        name: 'passes',
        then: '',
        heldOpenMs: '200',
        exitCode: 0,
        status: 'passed',
        marks: { heldOpen: ['TCPServerWrap'] },
      },
    ],
  ])(
    'ends a test file whose test leaves a server listening %s',
    { timeout: 30_000 },
    async ([, { name, then, heldOpenMs, exitCode, status, marks }], t) => {
      const { code, record } = await runTestFile(
        t,
        fixture("import { createServer } from 'node:http';", leavesServer(name, then)),
        { env: { [envNames.heldOpen]: heldOpenMs } },
      );

      assert.equal(code, exitCode);
      const { main, tests, unfinished, heldOpen } = record ?? {};
      assert.deepEqual(
        { main, statuses: tests?.map((test) => test.status), unfinished, heldOpen },
        { main: true, statuses: [status], unfinished: undefined, heldOpen: undefined, ...marks },
      );
    },
  );

  it(
    'lets a test file whose tests leave nothing open end by itself, long before the held-open time',
    { timeout: 20_000 },
    async (t) => {
      const { code, record } = await runTestFile(t, fixture("it('passes', () => {});"), {
        env: { [envNames.heldOpen]: '60000' },
      });

      assert.equal(code, 0);
      assert.equal(record?.heldOpen, undefined);
    },
  );

  it('records the tests and coverage of the test file it runs in, in a file named after the process', async (t) => {
    const { code, pid, testFile, records, record } = await runTestFile(
      t,
      fixture("it('covers', () => { cover('fixture-1'); });"),
      { env: { [envNames.dryRun]: 'true' } },
    );

    assert.equal(code, 0);
    assert.deepEqual(Object.keys(records), [`${pid}.0.json`]);
    assert.ok(record);
    const id = `${testFile} > covers`;
    assert.deepEqual(
      record.tests.map(({ id, status }) => ({ id, status })),
      [{ id, status: 'passed' }],
    );
    assert.equal(typeof record.tests[0]?.timeSpentMs, 'number');
    assert.ok((record.tests[0]?.timeSpentMs ?? -1) >= 0);
    assert.equal(record.mutantCoverage?.perTest[id]?.['fixture-1'], 1);
  });

  it("attributes tests declared through node:test's default export and through require", async (t) => {
    const { code, testFile, record } = await runTestFile(
      t,
      [
        "import test from 'node:test';",
        "import { createRequire } from 'node:module';",
        "const required = createRequire(import.meta.url)('node:test');",
        'const cover = () => {',
        '  const ns = globalThis.__stryker__;',
        '  ns.mutantCoverage ??= { static: {}, perTest: {} };',
        "  ns.mutantCoverage.perTest[ns.currentTestId] = { 'fixture-1': 1 };",
        '};',
        "test('default export', cover);",
        "test.describe('suite', () => { test.it('nested', cover); });",
        "required('required', cover);",
        "required.it('required it', cover);",
        '',
      ].join('\n'),
      { env: { [envNames.dryRun]: 'true' } },
    );

    assert.equal(code, 0);
    const ids = ['default export', 'suite > nested', 'required', 'required it'].map((name) => `${testFile} > ${name}`);
    assert.deepEqual(
      record?.tests.map(({ id, startPosition }) => ({ id, startPosition })),
      [
        { id: ids[0], startPosition: { line: 8, column: 0 } },
        { id: ids[1], startPosition: { line: 9, column: 36 } },
        { id: ids[2], startPosition: { line: 10, column: 0 } },
        { id: ids[3], startPosition: { line: 11, column: 9 } },
      ],
    );
    assert.deepEqual(Object.keys(record?.mutantCoverage?.perTest ?? {}), ids);
  });

  lzTestFor<readonly [string, string, Record<string, unknown>]>([
    ['ends by itself', '', {}],
    ['ends through process.exit()', 'process.exit(0);\n', { unfinished: true }],
  ])('marks the record of a test file that %s without tests as unfinished or not', async ([, exits, unfinished], t) => {
    const { code, record } = await runTestFile(t, `import 'node:test';\n${exits}`);

    assert.equal(code, 0);
    assert.deepEqual(untimed(record), { main: true, tests: [], testSpans: {}, ...unfinished });
  });

  it('records where a CommonJS test file declares its tests', async (t) => {
    const { code, record } = await runTestFile(
      t,
      "const { it } = require('node:test');\n\n  it('passes', () => {});\n",
      { name: 'fixture.test.cjs' },
    );

    assert.equal(code, 0);
    assert.deepEqual(record?.tests[0]?.startPosition, { line: 2, column: 2 });
  });

  /** A test file whose source map sends line 2, the `it` call, to line 41, column 3 of `source`. */
  const mapped = (source: string) => {
    const map = { version: 3, sources: [source], names: [], mappings: ';AAwCE' };

    return (
      "import { it } from 'node:test';\nit('mapped', () => {});\n" +
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n`
    );
  };

  lzTestFor<readonly [string, string, string, { line: number; column: number }]>([
    [
      'a loader transpiled, through its source map',
      'fixture.test.mjs',
      mapped('fixture.test.mjs'),
      { line: 40, column: 2 },
    ],
    [
      'was compiled from another file, in the test file itself',
      'fixture.test.mjs',
      mapped('../src/fixture.test.ts'),
      { line: 1, column: 0 },
    ],
    [
      'type stripping kept',
      'fixture.test.ts',
      "import { it } from 'node:test';\nconst typed: number = 1; it('stripped', () => {});\n",
      { line: 1, column: 25 },
    ],
  ])('records where the source declares a test that %s', async ([, name, source, position], t) => {
    const dir = tempDir(t);
    // A loader such as tsx turns source maps on this way, so stack traces are mapped and raw call sites are not.
    const maps = join(dir, 'maps.mjs');
    writeFileSync(maps, 'process.setSourceMapsEnabled(true);\n');

    const { code, record } = await runTestFile(t, source, {
      name,
      dir,
      args: ['--import', pathToFileURL(maps).href],
    });

    assert.equal(code, 0);
    assert.deepEqual(record?.tests[0]?.startPosition, position);
  });

  it('records where the test file declares a test through helpers many calls deep', async (t) => {
    const dir = tempDir(t);
    const levels = Array.from({ length: 12 }, (_, level) => `export const level${level} = () => level${level + 1}();`);
    writeFileSync(
      join(dir, 'helper.mjs'),
      ["import { it } from 'node:test';", ...levels, "export const level12 = () => it('deep', () => {});", ''].join(
        '\n',
      ),
    );

    const { code, record } = await runTestFile(t, "import { level0 } from './helper.mjs';\n\n  level0();\n", { dir });

    assert.equal(code, 0);
    assert.deepEqual(record?.tests[0]?.startPosition, { line: 2, column: 2 });
  });

  it('records the results node:test reports, also of hooks, runtime skips and todo tests', async (t) => {
    const { code, testFile, record } = await runTestFile(
      t,
      [
        "import { afterEach, describe, it } from 'node:test';",
        "describe('suite', () => {",
        "  afterEach(() => { throw new Error('afterEach failure'); });",
        "  it('passes, then its hook fails', () => {});",
        '});',
        "it('skips itself', (t) => { t.skip(); });",
        "it('is todo', (t) => { t.todo(); throw new Error('not done'); });",
        '',
      ].join('\n'),
    );

    assert.equal(code, 1);
    assert.deepEqual(
      record?.tests.map(({ id, status, failureMessage }) => ({
        id,
        status,
        failureMessage,
      })),
      [
        {
          id: `${testFile} > suite > passes, then its hook fails`,
          status: 'failed',
          failureMessage: 'afterEach failure',
        },
        { id: `${testFile} > skips itself`, status: 'skipped', failureMessage: undefined },
        { id: `${testFile} > is todo`, status: 'skipped', failureMessage: undefined },
      ],
    );
  });

  it('records a process without a main file, such as node -e', async (t) => {
    const outDir = tempDir(t);

    const { code, pid } = await runWithHook(['-e', 'process.exitCode = 0'], {
      [envNames.out]: outDir,
      [envNames.file]: join(outDir, 'some.test.mjs'),
    });
    const records = readRecords(outDir);
    const record = recordOf(records, pid, 0);

    assert.equal(code, 0);
    assert.deepEqual(Object.values(records), [record]);
    assert.deepEqual(untimed(record), { tests: [] });
  });

  lzTestFor<readonly [string, Record<string, string>]>([
    ['', {}],
    // The watchdog's thread gets none of the process's environment, so it stays CommonJS.
    [' run as an ES module', { NODE_OPTIONS: '--input-type=module' }],
  ])(
    "ends a process%s that holds more memory than the memory limit, leaving the watchdog's record with both numbers",
    async ([, env], t) => {
      const outDir = tempDir(t);

      const { code, pid } = await runWithHook(['-e', grows], {
        [envNames.out]: outDir,
        [envNames.memoryLimit]: '200',
        ...env,
      });

      assert.notEqual(code, 0);
      const records = readRecords(outDir);
      const record = recordOf(records, pid, 'memory');
      assert.deepEqual(Object.values(records), [record]);
      assert.ok(record);
      const { tests, memoryLimitReached } = record;
      assert.deepEqual(tests, []);
      assert.equal(memoryLimitReached?.limitMB, 200);
      assert.ok(memoryLimitReached.rssMB > 200, String(memoryLimitReached.rssMB));
      assert.ok(memoryLimitReached.rssMB < 400, String(memoryLimitReached.rssMB));
    },
  );

  it('records the most memory the process held in MB, in the dry run', async (t) => {
    const outDir = tempDir(t);

    const { pid } = await runWithHook(['-e', 'new Int32Array(25e6).fill(1);'], {
      [envNames.out]: outDir,
      [envNames.dryRun]: 'true',
    });

    const peakMB = recordOf(readRecords(outDir), pid, 0)?.peakMemoryMB;
    assert.ok(peakMB, 'The record has no peak memory.');

    assert.ok(Number.isInteger(peakMB), String(peakMB));
    assert.ok(peakMB >= 100, String(peakMB));
    assert.ok(peakMB < 1000, String(peakMB));
  });

  it("watches memory from the main thread only, not from a test's own worker threads", async (t) => {
    const dir = tempDir(t);
    const outDir = tempDir(t);
    const symbol = `Symbol.for(${JSON.stringify(watchdog.description)})`;
    writeFileSync(
      join(dir, 'worker.mjs'),
      `import { parentPort } from 'node:worker_threads';\nparentPort.postMessage(globalThis[${symbol}] !== undefined);\n`,
    );
    // A file, as a worker thread takes the process's options and refuses --input-type.
    writeFileSync(
      join(dir, 'main.mjs'),
      [
        "import { Worker } from 'node:worker_threads';",
        `const inMain = globalThis[${symbol}] !== undefined;`,
        "const worker = new Worker(new URL('./worker.mjs', import.meta.url));",
        "worker.on('message', (inWorker) => {",
        '  process.exitCode = inMain && !inWorker ? 0 : 1;',
        '  worker.terminate();',
        '});',
        '',
      ].join('\n'),
    );

    const { code } = await runWithHook([join(dir, 'main.mjs')], {
      [envNames.out]: outDir,
      [envNames.memoryLimit]: '1500',
    });

    assert.equal(code, 0);
  });

  lzTestFor([
    ['the arguments', true],
    ['NODE_OPTIONS', false],
  ])('loads a --require preload given in %s once, not again in the memory watchdog', async ([, inArgs], t) => {
    const dir = tempDir(t);
    const outDir = tempDir(t);
    const preload = join(dir, 'count.cjs');
    writeFileSync(preload, "require('node:fs').appendFileSync(__dirname + '/loads.txt', 'load\\n');\n");
    const script = ['-e', 'setTimeout(() => {}, 500);'];

    const { code } = await runWithHook(inArgs ? ['--require', preload, ...script] : script, {
      [envNames.out]: outDir,
      [envNames.memoryLimit]: '1500',
      ...(!inArgs && { NODE_OPTIONS: `--require ${JSON.stringify(preload)}` }),
    });

    assert.equal(code, 0);
    assert.equal(readFileSync(join(dir, 'loads.txt'), 'utf8'), 'load\n');
  });

  it('ends a process whose NODE_OPTIONS preload cannot run in a worker once it holds more than the memory limit', async (t) => {
    const dir = tempDir(t);
    const outDir = tempDir(t);
    // process.chdir throws in a worker thread; the watchdog's thread, which gets none of the process's environment,
    // does not load it.
    writeFileSync(join(dir, 'chdir.cjs'), 'process.chdir(__dirname);\n');

    const { code, pid } = await runWithHook(['-e', grows], {
      [envNames.out]: outDir,
      [envNames.memoryLimit]: '200',
      NODE_OPTIONS: `--require ${JSON.stringify(join(dir, 'chdir.cjs'))}`,
    });

    assert.notEqual(code, 0);
    assert.equal(recordOf(readRecords(outDir), pid, 'memory')?.memoryLimitReached?.limitMB, 200);
  });

  it('runs a process under the permission model without workers with a memory limit as it would without one', async (t) => {
    const outDir = tempDir(t);
    const args = ['--permission', '--allow-fs-read=*', '--allow-fs-write=*', '-e', 'setTimeout(() => {}, 500);'];

    const { code, pid } = await runWithHook(args, { [envNames.out]: outDir, [envNames.memoryLimit]: '1500' });
    const records = readRecords(outDir);

    assert.equal(code, 0);
    const record = recordOf(records, pid, 0);
    assert.deepEqual(Object.values(records), [record]);
    assert.deepEqual(untimed(record), { tests: [] });
  });

  it('runs a process under the permission model without write access as it would without the hook, with no record', async (t) => {
    const outDir = tempDir(t);
    // A script that sets process.exitCode would hide a throw from the exit listener: the process still exits 0.
    const args = ['--permission', '--allow-fs-read=*', '-e', 'void 0'];

    const { code } = await runWithHook(args, { [envNames.out]: outDir });

    assert.equal(code, 0);
    assert.deepEqual(readRecords(outDir), {});
  });
});

describe('hook, in a process that a signal ends', () => {
  const noSignals = process.platform === 'win32' && 'Windows has no signals to catch: every kill is TerminateProcess';

  /** Starts a process the runner's test file started, running `script` once it says it is ready, and sends `signal`. */
  async function signalled(t: TestContext, script: string, signal: NodeJS.Signals, outDir = tempDir(t)) {
    const child = spawn(process.execPath, ['--import', hookUrl, '-e', `${script} process.send('ready');`], {
      env: hookedEnv({ [envNames.out]: outDir }),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    t.after(() => child.kill('SIGKILL'));
    const exited = once(child, 'exit');
    await once(child, 'message');
    child.kill(signal);
    await exited;

    return {
      code: child.exitCode,
      signalCode: child.signalCode,
      records: existsSync(outDir) ? Object.keys(readRecords(outDir)) : [],
    };
  }

  it(
    "adds no signal listener to the test file's own process, which a test there could count",
    // eslint-disable-next-line node-test/no-skip-test -- POSIX only, with the reason as its value
    { skip: noSignals },
    async (t) => {
      const { code } = await runTestFile(
        t,
        fixture("it('counts', () => { assert.equal(process.listenerCount('SIGTERM'), 0); });"),
      );

      assert.equal(code, 0);
    },
  );

  lzTestFor<readonly [NodeJS.Signals]>([['SIGTERM'], ['SIGINT'], ['SIGHUP']])(
    'writes the record of a process that %s ends, which ends by that signal as it would without the hook',
    { skip: noSignals },
    async ([signal], t) => {
      const { code, signalCode, records } = await signalled(t, 'setInterval(() => {}, 1_000);', signal);

      assert.deepEqual([code, signalCode], [null, signal]);
      assert.equal(records.length, 1);
    },
  );

  it(
    'writes the record of a process with a SIGTERM listener of its own, which decides how the process ends',
    // eslint-disable-next-line node-test/no-skip-test -- POSIX only, with the reason as its value
    { skip: noSignals },
    async (t) => {
      const script = "process.on('SIGTERM', () => process.exit(7)); setInterval(() => {}, 1_000);";

      const { code, signalCode, records } = await signalled(t, script, 'SIGTERM');

      assert.deepEqual([code, signalCode], [7, null]);
      assert.equal(records.length, 1);
    },
  );

  it(
    'ends a process that swallows uncaught errors by the signal, also once its record can no longer be written',
    // eslint-disable-next-line node-test/no-skip-test -- POSIX only, with the reason as its value
    { skip: noSignals, timeout: 10_000 },
    async (t) => {
      const script = "process.on('uncaughtException', () => {}); setInterval(() => {}, 1_000);";

      const { code, signalCode } = await signalled(t, script, 'SIGTERM', join(tempDir(t), 'removed'));

      assert.deepEqual([code, signalCode], [null, 'SIGTERM']);
    },
  );
});

describe('reporter', () => {
  it('passes each event to the hook of the test file, and ignores the events of other processes', () => {
    const global: HookDependencies['global'] = globalThis;
    const previous = global[reporting];
    const events: TestEvent[] = [];
    const errors: unknown[] = [];
    const event = (name: string): TestEvent => ({ type: 'test:start', data: { name, nesting: 0 } });
    reporter.on('error', (error) => errors.push(error));

    try {
      global[reporting] = (received) => events.push(received);
      reporter.write(event('first'));
      reporter.write(event('second'));
      delete global[reporting];
      reporter.write(event('elsewhere'));
    } finally {
      if (previous === undefined) {
        delete global[reporting];
      } else {
        global[reporting] = previous;
      }
    }

    assert.deepEqual(events, [event('first'), event('second')]);
    assert.deepEqual(errors, []);
  });
});
