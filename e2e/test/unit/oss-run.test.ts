import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, it, type TestContext } from 'node:test';
import { setTimeout } from 'node:timers/promises';

import { lzExec } from '../../src/exec.ts';
import { lzInstall, lzPack, lzReportFile, lzStryker, type LzStrykerRun } from '../../src/fixture.ts';
import { lzCheckpointArgs, lzCheckpointReporterName } from '../../src/oss/checkpoint.ts';
import { lzStrykerConfig, type LzOssOptions, type LzOssProject } from '../../src/oss/options.ts';
import type { LzProcessRow } from '../../src/oss/processes.ts';
import { lzClearResult, lzClearSideFiles, lzRunDriver, lzRunSteps, type LzRunSteps } from '../../src/oss/run.ts';
import { lzSnapshot, lzStartSampler, type LzSamples } from '../../src/oss/sampler.ts';
import { lzReportScore } from '../../src/oss/verdicts.ts';
import { lzIsRecord } from '../../src/report.ts';

function setup(t: TestContext, names: readonly string[]): string {
  const out = mkdtempSync(join(tmpdir(), 'lz-oss-run-'));

  t.after(() => {
    rmSync(out, { recursive: true, force: true });
  });
  names.forEach((name) => {
    writeFileSync(join(out, name), '');
  });

  return out;
}

describe('lzClearResult', () => {
  it("removes an earlier run's result.json and keeps the side files", (t) => {
    const out = setup(t, ['result.json', 'lz.mutation.json']);

    lzClearResult(out);

    assert.deepEqual(readdirSync(out), ['lz.mutation.json']);
  });

  it('accepts a folder with no result.json', (t) => {
    const out = setup(t, []);

    lzClearResult(out);

    assert.deepEqual(readdirSync(out), []);
  });
});

describe('lzClearSideFiles', () => {
  it("removes an earlier run's report and log of the side, and keeps the other side's", (t) => {
    const out = setup(t, ['lz.mutation.json', 'lz.log', 'command.mutation.json', 'command.log', 'result.json']);

    lzClearSideFiles(out, 'lz');

    assert.deepEqual(readdirSync(out).sort(), ['command.log', 'command.mutation.json', 'result.json']);
  });

  it('accepts a folder that holds neither file', (t) => {
    const out = setup(t, []);

    lzClearSideFiles(out, 'command');

    assert.deepEqual(readdirSync(out), []);
  });
});

const project: LzOssProject = {
  name: 'demo',
  mutate: ['src/*.js'],
  testFiles: ['test/*.test.js'],
  nodeTestFlags: [],
  patches: [{ file: 'src/a.js', from: 'one', to: 'two' }],
};
/** No process has this id, on Windows or Linux. */
const deadPid = 2_147_483_644;

interface LzStrykerCall {
  readonly dir: string;
  readonly configFile: string;
  readonly concurrency: number;
  readonly options: unknown;
}

function row(pid: number, workingSetBytes: number, name: string): LzProcessRow {
  return { pid, ppid: process.pid, workingSetBytes, created: 1n, name };
}

function sampler(pid: number, stop: () => Promise<LzSamples>): LzRunSteps['startSampler'] {
  return () => Promise.resolve({ pid, stop });
}

function notReported(): Promise<LzStrykerRun> {
  return Promise.resolve({ reported: false, exitCode: 1, output: '', leftover: [], timedOut: false });
}

function readResult(out: string): Record<string, unknown> {
  const result: unknown = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));

  assert.ok(lzIsRecord(result));

  return result;
}

function sideOf(result: Record<string, unknown>): Record<string, unknown> {
  const sides = result['sides'];

  assert.ok(lzIsRecord(sides));
  assert.deepEqual(Object.keys(sides), ['lz']);
  const side = sides['lz'];

  assert.ok(lzIsRecord(side));

  return side;
}

function text(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${String(value)} is not a string`);
  }

  return value;
}

function defined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new TypeError('The value is undefined');
  }

  return value;
}

function messages(side: Record<string, unknown>): string[] {
  const errors = side['errors'];

  assert.ok(Array.isArray(errors));

  return errors.map(String);
}

/** Each error's step, without the message, which differs between platforms for a file system error. */
function steps(side: Record<string, unknown>): string[] {
  return messages(side).map((message) => message.replace(/: [\s\S]*$/, ''));
}

const tmpVariables = ['TMP', 'TEMP', 'TMPDIR'];

/** Points `tmpdir()` at `path` on Windows and Linux. */
function pointTmpAt(path: string): void {
  tmpVariables.forEach((name) => {
    process.env[name] = path;
  });
}

/**
 * The driver's run folders and TMP listings go to a TMP of the test's own, so that neither the machine's TMP nor the
 * other test files' entries in it reach them.
 */
async function setupDriver(t: TestContext, overrides: Partial<LzOssOptions> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'lz-oss-run-'));
  const osTmp = join(base, 'os-tmp');
  const saved = tmpVariables.map((name) => ({ name, value: process.env[name] }));

  t.after(() => {
    saved.forEach(({ name, value }) => {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    });
    rmSync(base, { recursive: true, force: true });
  });
  mkdirSync(osTmp);
  pointTmpAt(osTmp);
  const source = join(base, 'source');
  const tarballs = join(base, 'tarballs');
  const { stdout: gitDir } = await lzExec('git', ['rev-parse', '--absolute-git-dir'], { cwd: import.meta.dirname });
  const { stdout: head } = await lzExec('git', ['rev-parse', 'HEAD'], { cwd: import.meta.dirname });

  [join(source, 'src'), join(source, 'test'), join(source, 'node_modules'), tarballs].forEach((dir) => {
    mkdirSync(dir, { recursive: true });
  });
  // A Git file, so that the copy of the source sits in this workspace's work tree without a clone.
  writeFileSync(join(source, '.git'), `gitdir: ${gitDir.trim()}\n`);
  writeFileSync(join(source, 'src', 'a.js'), "export const value = 'one';\n");
  symlinkSync('a.js', join(source, 'src', 'link'));
  writeFileSync(join(source, 'test', 'a.test.js'), "writeFileSync('x', '');\nmkdirSync('y');\n");
  writeFileSync(join(source, 'node_modules', 'stale.txt'), '');
  writeFileSync(join(tarballs, 'a.tgz'), 'tarball a');
  writeFileSync(join(tarballs, 'notes.txt'), '');
  const write = t.mock.method(process.stdout, 'write');
  const options: LzOssOptions = {
    project,
    source,
    out: join(base, 'out', 'nested'),
    concurrency: 2,
    sides: ['lz'],
    mutate: ['src/a.js'],
    tarballs,
    prepareOnly: false,
    timeLimitMinutes: 3,
    mutantTimeoutMs: 5_000,
    npmBefore: '2026-01-01',
    ...overrides,
  };
  const installs: unknown[] = [];
  const strykerCalls: LzStrykerCall[] = [];
  const fakeSteps: LzRunSteps = {
    pack: (into) => Promise.reject(new Error(`No pack into ${into}`)),
    install: (dir, installed, before) => {
      installs.push({ dir, tarballs: installed, before });
      mkdirSync(join(dir, 'node_modules'));
      writeFileSync(
        join(dir, 'node_modules', '.package-lock.json'),
        JSON.stringify({ packages: { '': { version: '1.0.0' }, 'node_modules/x': { version: '2.0.0' } } }),
      );

      return Promise.resolve();
    },
    stryker: (dir, configFile, concurrency, strykerOptions) => {
      strykerCalls.push({ dir, configFile, concurrency, options: strykerOptions });

      return notReported();
    },
    startSampler: sampler(deadPid, () => Promise.resolve({ samples: [], error: null })),
    snapshot: () => Promise.resolve([]),
  };

  return {
    base,
    osTmp,
    options,
    out: options.out,
    source,
    tarballs,
    head: head.trim(),
    steps: fakeSteps,
    installs,
    strykerCalls,
    printed: (): string[] =>
      write.mock.calls.flatMap(({ arguments: [text] }) => (typeof text === 'string' ? [text] : [])),
  };
}

describe('lzRunDriver', () => {
  it('prepares a patched copy of the project, installs into it and writes the header, for manual runs', async (t) => {
    const {
      options,
      out,
      source,
      tarballs,
      head,
      steps: fakeSteps,
      installs,
      printed,
    } = await setupDriver(t, {
      prepareOnly: true,
    });
    const deadRun = join(tmpdir(), `lz-oss-driver-${deadPid}-x`);

    mkdirSync(deadRun);
    // Its digest sorts before a.tgz's.
    writeFileSync(join(tarballs, 'b.tgz'), 'tarball e');
    // In the order the folder lists them, which differs between platforms.
    const tarballNames = readdirSync(tarballs).filter((name) => name !== 'notes.txt');
    const exitListeners = process.listenerCount('exit');

    await lzRunDriver(options, fakeSteps);

    const result = readResult(out);
    const dir = text(result['preparedIn']);
    const root = dirname(dir);

    assert.deepEqual(
      { ...result, startedAt: typeof result['startedAt'] },
      {
        project: 'demo',
        source,
        sourceCommit: head,
        workspaceCommit: head,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        concurrency: 2,
        timeLimitMinutes: 3,
        mutantTimeoutMs: 5_000,
        installedVersions: ['@1.0.0', 'node_modules/x@2.0.0'],
        tarballDigests: ['tarball e', 'tarball a'].map((data) => createHash('sha256').update(data).digest('hex')),
        projectSetup: { mutate: project.mutate, testFiles: project.testFiles, patches: project.patches },
        mutate: ['src/a.js'],
        tarballs: tarballNames,
        npmBefore: '2026-01-01',
        startedAt: 'string',
        preparedIn: dir,
      },
    );
    assert.match(readFileSync(join(out, 'result.json'), 'utf8'), /\n}\n$/);
    assert.deepEqual(
      {
        root: basename(root).startsWith(`lz-oss-prepared-${process.pid}-`),
        dir: basename(dir),
        runTmp: existsSync(join(root, 'tmp')),
        patched: readFileSync(join(dir, 'src', 'a.js'), 'utf8'),
        link: readlinkSync(join(dir, 'src', 'link')),
        git: existsSync(join(dir, '.git')),
        sourceModules: existsSync(join(dir, 'node_modules', 'stale.txt')),
        configs: ['lz', 'command'].map((side) => readFileSync(join(dir, `stryker.${side}.config.mjs`), 'utf8')),
        installs,
        exitListeners: process.listenerCount('exit'),
        deadRun: existsSync(deadRun),
      },
      {
        root: true,
        dir: 'project',
        runTmp: true,
        patched: "export const value = 'two';\n",
        link: 'a.js',
        git: false,
        sourceModules: false,
        configs: [lzStrykerConfig('lz', project), lzStrykerConfig('command', project)],
        installs: [{ dir, tarballs: tarballNames.map((name) => join(tarballs, name)), before: '2026-01-01' }],
        exitListeners,
        deadRun: false,
      },
    );
    assert.deepEqual(
      printed().filter((text) => /^(?:test\/a\.test\.js|Prepared|Wrote) /.test(text)),
      [
        'test/a.test.js writes files (mkdirSync, writeFileSync); a fixed path there would collide across Stryker workers.\n',
        `Wrote ${join(out, 'result.json')}\n`,
        `Prepared ${dir}, with ${join(root, 'tmp')} for TMP; both stay for manual runs.\n`,
      ],
    );
  });

  it('packs the workspace into the run folder when no tarball folder is given', async (t) => {
    const driver = await setupDriver(t, { prepareOnly: true, tarballs: undefined });
    const packs: string[] = [];

    await lzRunDriver(driver.options, {
      ...driver.steps,
      pack: (into) => {
        packs.push(into);
        mkdirSync(into);
        writeFileSync(join(into, 'packed.tgz'), 'packed');

        return Promise.resolve([join(into, 'packed.tgz')]);
      },
    });

    const result = readResult(driver.out);
    const dir = text(result['preparedIn']);

    assert.deepEqual(
      { packs, tarballs: result['tarballs'] },
      { packs: [join(dirname(dir), 'tarballs')], tarballs: ['packed.tgz'] },
    );
  });

  it("rejects a tarball folder that holds no .tgz file, and leaves no earlier run's result.json", async (t) => {
    const { options, out, tarballs, steps: fakeSteps } = await setupDriver(t);

    rmSync(join(tarballs, 'a.tgz'));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'result.json'), '{}');

    await assert.rejects(lzRunDriver(options, fakeSteps), { message: `${tarballs} holds no .tgz file.` });

    assert.equal(existsSync(join(out, 'result.json')), false);
  });

  it('rejects with the error of an install that fails', async (t) => {
    const { options, steps: fakeSteps } = await setupDriver(t);

    await assert.rejects(
      lzRunDriver(options, { ...fakeSteps, install: () => Promise.reject(new Error('no install')) }),
      { message: 'no install' },
    );
  });

  it('rejects a source that is not in a Git work tree', async (t) => {
    const { options, source, steps: fakeSteps } = await setupDriver(t);

    rmSync(join(source, '.git'));

    await assert.rejects(
      lzRunDriver(options, fakeSteps),
      (error) =>
        error instanceof Error &&
        error.message.startsWith(`git rev-parse HEAD in ${source} ended with exit code 128:\n`),
    );
  });

  it('runs Stryker on each side and records its report, the processes it left and what it left in TMP', async (t) => {
    const driver = await setupDriver(t);
    const { options, out, strykerCalls } = driver;
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const exited = once(child, 'exit');

    t.after(() => {
      child.kill();
    });
    const childPid = defined(child.pid);
    const leftover = row(childPid, 500, 'node');
    const newTmp = join(tmpdir(), 'stryker-left-this');

    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'lz.log'), 'an earlier run');
    const exitListeners = process.listenerCount('exit');
    let clockMs = 1_000;

    t.mock.method(performance, 'now', () => clockMs);
    await lzRunDriver(options, {
      ...driver.steps,
      stryker: (dir, configFile, concurrency, strykerOptions) => {
        strykerCalls.push({ dir, configFile, concurrency, options: strykerOptions });
        mkdirSync(join(dir, dirname(lzReportFile)), { recursive: true });
        writeFileSync(join(dir, lzReportFile), 'report');
        mkdirSync(newTmp);
        clockMs = 1_250;

        return Promise.resolve({
          reported: true,
          report: new Map(),
          exitCode: 0,
          output: '',
          leftover: ['worker-1'],
          timedOut: false,
        });
      },
      startSampler: sampler(deadPid, () =>
        Promise.resolve({
          samples: [[row(process.pid, 1, 'node'), row(deadPid, 1_000, 'pwsh'), leftover]],
          error: null,
        }),
      ),
      snapshot: () => {
        clockMs = 9_000;

        return Promise.resolve([leftover]);
      },
    });

    const side = sideOf(readResult(out));
    const root = dirname(defined(strykerCalls[0]).dir);
    const checkpoint = join(out, 'lz.checkpoint.json');

    assert.deepEqual(side, {
      stryker: {
        exitCode: 0,
        timedOut: false,
        reported: true,
        ...lzReportScore(new Map()),
        leftoverInRunTmp: ['worker-1'],
      },
      errors: [],
      wallMs: 250,
      resumedMutants: 0,
      strykerConfig: lzStrykerConfig('lz', project),
      processes: {
        samples: 1,
        peakCount: 1,
        peakWorkingSetBytes: 500,
        leftover: [{ pid: childPid, name: 'node', endedByDriver: true }],
      },
      newInOsTmp: [basename(newTmp)],
      leftoverStrykerTmp: [],
    });
    assert.deepEqual(
      {
        root: basename(root).startsWith(`lz-oss-driver-${process.pid}-`),
        strykerCalls,
        report: readFileSync(join(out, 'lz.mutation.json'), 'utf8'),
        log: existsSync(join(out, 'lz.log')),
        checkpointKey: existsSync(`${checkpoint}.key`),
        exitListeners: process.listenerCount('exit'),
      },
      {
        root: true,
        strykerCalls: [
          {
            dir: join(root, 'project'),
            configFile: 'stryker.lz.config.mjs',
            concurrency: 2,
            options: {
              tmp: join(root, 'tmp'),
              timeoutMs: 3 * 60_000,
              args: ['--mutate', 'src/a.js', '--timeoutMS', '5000', ...lzCheckpointArgs(checkpoint)],
              logFile: join(out, 'lz.log'),
              reporters: [lzCheckpointReporterName],
            },
          },
        ],
        report: 'report',
        log: false,
        checkpointKey: false,
        exitListeners: exitListeners + 1,
      },
    );
    await exited;
  });

  it('does not count a process that ends within the settle wait after Stryker as left behind', async (t) => {
    const driver = await setupDriver(t);
    const lingering = row(deadPid, 1, 'node');
    let ended = false;

    await lzRunDriver(driver.options, {
      ...driver.steps,
      stryker: () => {
        void setTimeout(1_000).then(() => {
          ended = true;
        });

        return notReported();
      },
      startSampler: sampler(deadPid - 4, () =>
        Promise.resolve({ samples: [[row(process.pid, 1, 'node'), lingering]], error: null }),
      ),
      snapshot: () => Promise.resolve(ended ? [] : [lingering]),
    });

    assert.deepEqual(sideOf(readResult(driver.out))['processes'], {
      samples: 1,
      peakCount: 1,
      peakWorkingSetBytes: 1,
      leftover: [],
    });
  });

  it('records each step that throws, goes on with the next and still writes the result', async (t) => {
    const driver = await setupDriver(t);
    const { options, out, source, strykerCalls } = driver;
    const checkpoint = join(out, 'lz.checkpoint.json');
    mkdirSync(join(out, 'lz.log'), { recursive: true });

    await lzRunDriver(options, {
      ...driver.steps,
      install: async (dir, tarballs, before) => {
        await driver.steps.install(dir, tarballs, before);
        pointTmpAt(join(driver.base, 'no-tmp'));
      },
      stryker: () => Promise.reject(new Error('no stryker')),
      startSampler: () => Promise.reject(new Error('no sampler')),
      snapshot: () => Promise.reject(new Error('no snapshot')),
    });
    pointTmpAt(driver.osTmp);

    const failedSide = sideOf(readResult(out));

    assert.deepEqual(
      {
        steps: steps(failedSide),
        thrown: messages(failedSide).filter((message) => / no \w+$/.test(message)),
        stryker: failedSide['stryker'],
        newInOsTmp: failedSide['newInOsTmp'],
        leftoverStrykerTmp: failedSide['leftoverStrykerTmp'],
      },
      {
        steps: [
          "Removing an earlier run's report and log",
          'TMP listing before the run',
          'Sampler start',
          'Stryker run',
          'Leftover snapshot',
          'TMP listing after the run',
        ],
        thrown: ['Sampler start: no sampler', 'Stryker run: no stryker', 'Leftover snapshot: no snapshot'],
        stryker: null,
        newInOsTmp: [],
        leftoverStrykerTmp: [],
      },
    );

    rmSync(join(out, 'lz.log'), { recursive: true });
    writeFileSync(checkpoint, '{');
    writeFileSync(join(source, '.stryker-tmp'), '');
    const gone = [row(1.5, 1, 'bad'), row(deadPid, 1, 'gone')];

    await lzRunDriver(options, {
      ...driver.steps,
      stryker: () =>
        Promise.resolve({ reported: true, report: new Map(), exitCode: 0, output: '', leftover: [], timedOut: false }),
      startSampler: sampler(deadPid - 4, () => Promise.resolve({ samples: [gone], error: 'pwsh failed' })),
      snapshot: () => Promise.resolve(gone),
    });

    const unreadSide = sideOf(readResult(out));

    assert.deepEqual(
      {
        steps: steps(unreadSide),
        sampler: messages(unreadSide)[1],
        resumedMutants: unreadSide['resumedMutants'],
        processes: unreadSide['processes'],
        leftoverStrykerTmp: unreadSide['leftoverStrykerTmp'],
        removed: driver.printed().filter((text) => text.startsWith('Removed ')),
      },
      {
        steps: ['Checkpoint', 'Sampler', 'Ending 1.5', 'Report copy', '.stryker-tmp listing'],
        sampler: 'Sampler: pwsh failed',
        resumedMutants: 0,
        processes: {
          samples: 1,
          peakCount: 2,
          peakWorkingSetBytes: 2,
          leftover: [
            { pid: 1.5, name: 'bad', endedByDriver: false },
            { pid: deadPid, name: 'gone', endedByDriver: false },
          ],
        },
        leftoverStrykerTmp: [],
        removed: [`Removed ${checkpoint}, which could not be read; lz starts afresh.\n`],
      },
    );

    rmSync(join(source, '.stryker-tmp'));
    rmSync(`${checkpoint}.key`);
    mkdirSync(`${checkpoint}.key`);
    strykerCalls.length = 0;

    await lzRunDriver(options, {
      ...driver.steps,
      startSampler: sampler(deadPid, () => Promise.reject(new Error('stop failed'))),
    });

    const unresumedSide = sideOf(readResult(out));
    const [call] = strykerCalls;

    assert.deepEqual(
      {
        steps: steps(unresumedSide),
        sampler: messages(unresumedSide)[2],
        options: lzIsRecord(call?.options)
          ? { args: call.options['args'], reporters: call.options['reporters'] }
          : null,
      },
      {
        steps: ['Checkpoint', 'Checkpoint after removing the unreadable one', 'Sampler'],
        sampler: 'Sampler: stop failed',
        options: { args: ['--mutate', 'src/a.js', '--timeoutMS', '5000'], reporters: [] },
      },
    );
  });

  it('runs the real pack, install, Stryker and process sampler by default', () => {
    assert.equal(lzRunSteps.pack, lzPack);
    assert.equal(lzRunSteps.install, lzInstall);
    assert.equal(lzRunSteps.stryker, lzStryker);
    assert.equal(lzRunSteps.startSampler, lzStartSampler);
    assert.equal(lzRunSteps.snapshot, lzSnapshot);
  });
});
