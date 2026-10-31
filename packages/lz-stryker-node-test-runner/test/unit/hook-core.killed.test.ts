import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { lzTestFor } from '@layzee/lz-node-test';
import { lzEndingSignals, lzHits, type LzEndingSignal } from '../../src/hook-core.ts';
import { envNames } from '../../src/record.ts';
import { fileEnv, installedHarness, out, testFile, type Harness } from '../hook-core.fixtures.ts';

const noListeners = { SIGTERM: 0, SIGINT: 0, SIGHUP: 0 };

describe('install, for a process that a signal ends', () => {
  it('listens for SIGTERM, SIGINT and SIGHUP', () => {
    const { listenerCounts } = installedHarness({ [envNames.out]: out });

    assert.deepEqual(listenerCounts(), { SIGTERM: 1, SIGINT: 1, SIGHUP: 1 });
  });

  it('listens for no signal where the platform has none to catch or the process cannot write its record', () => {
    const windows = installedHarness(fileEnv, { signals: undefined });
    const readOnly = installedHarness(fileEnv, { canWriteRecords: false });

    windows.exit();

    assert.equal(windows.records.length, 1);
    assert.deepEqual(readOnly.listenerCounts(), noListeners);
  });

  lzTestFor<readonly [LzEndingSignal]>(lzEndingSignals.map((signal) => [signal]))(
    'writes the record on %s, stops listening and raises the signal again, as no other listener decides how the process ends',
    ([signal]) => {
      const { records, raised, signal: send, listenerCounts } = installedHarness(fileEnv);

      send(signal);

      assert.equal(records.length, 1);
      assert.deepEqual(listenerCounts(), noListeners);
      assert.deepEqual(raised, [signal]);
    },
  );

  it("only writes the record when the process listens for the signal itself, so that the process's listener decides", () => {
    const { records, raised, signal, listen, listenerCounts } = installedHarness(fileEnv);
    const own: string[] = [];
    listen('SIGTERM', () => own.push('SIGTERM'));

    signal('SIGTERM');

    assert.equal(records.length, 1);
    assert.deepEqual(raised, []);
    assert.deepEqual(own, ['SIGTERM']);
    assert.deepEqual(listenerCounts(), { SIGTERM: 2, SIGINT: 1, SIGHUP: 1 });
  });

  lzTestFor<readonly [string, readonly unknown[], readonly LzEndingSignal[]]>([
    ["raises the signal when every other listener is signal-exit's", [{ count: 1 }, { count: 1 }], ['SIGTERM']],
    ['leaves the signal to the other listeners when no signal-exit counts them', [undefined, { count: '2' }], []],
  ])('%s, which leaves how the process ends to any other listener', ([, emitters, expected]) => {
    const { raised, signal, listen, useSignalExit } = installedHarness(fileEnv);
    useSignalExit(emitters);
    listen('SIGTERM', () => {});
    listen('SIGTERM', () => {});

    signal('SIGTERM');

    assert.deepEqual(raised, expected);
  });
});

describe('lzHits', () => {
  it('counts no hits without coverage', () => {
    assert.equal(lzHits(undefined), 0);
  });

  it('counts the hits of every mutant, static and per test', () => {
    assert.equal(lzHits({ static: { 1: 2, 2: 1 }, perTest: { a: { 1: 3 }, b: { 3: 1, 4: 5 } } }), 12);
  });
});

describe('install, in the dry run, for a process that ends without running its exit listeners', () => {
  const descendantEnv = { [envNames.out]: out, [envNames.dryRun]: 'true' };

  /** A hit as instrumented code counts it, on the namespace the hook set up. */
  function hit(h: Harness, mutantId: string): void {
    const ns = h.deps.global.__stryker__;
    assert.ok(ns, 'install set no __stryker__ namespace');
    const coverage = (ns.mutantCoverage ??= { static: {}, perTest: {} });
    coverage.static[mutantId] = (coverage.static[mutantId] ?? 0) + 1;
  }

  it('replaces the record of a process the tests started every 250 ms, once its coverage has grown', () => {
    const h = installedHarness(descendantEnv, { mainFile: '/repo/child.mjs' });
    const tick = () => h.intervals.forEach(({ fire }) => fire());

    assert.deepEqual(
      h.intervals.map(({ ms }) => ms),
      [250],
    );

    tick();
    hit(h, '1');
    tick();
    tick();
    hit(h, '1');
    tick();

    assert.deepEqual(
      h.replaced.map(({ path, record }) => [path, record.mutantCoverage]),
      [
        [join(out, '4321.0.json'), { static: { 1: 1 }, perTest: {} }],
        [join(out, '4321.0.json'), { static: { 1: 2 }, perTest: {} }],
      ],
    );
  });

  lzTestFor<readonly [string, Record<string, string>, string]>([
    ['outside the dry run', { [envNames.out]: out }, '/repo/child.mjs'],
    [
      "in the test file's own process, whose record the runner ends it to write",
      { ...fileEnv, ...descendantEnv },
      testFile,
    ],
  ])('replaces no record %s', ([, env, mainFile]) => {
    const { intervals } = installedHarness(env, { mainFile });

    assert.deepEqual(intervals, []);
  });

  it('replaces no record without write access', () => {
    const { intervals } = installedHarness(descendantEnv, { mainFile: '/repo/child.mjs', canWriteRecords: false });

    assert.deepEqual(intervals, []);
  });

  it('keeps the process running when its record can no longer be replaced, as when the run is over', () => {
    const h = installedHarness(descendantEnv, {
      mainFile: '/repo/child.mjs',
      replaceRecord: () => {
        throw new Error('ENOENT: no such file or directory');
      },
    });
    hit(h, '1');

    h.intervals.forEach(({ fire }) => fire());

    assert.equal(h.intervals.length, 1);
  });
});
