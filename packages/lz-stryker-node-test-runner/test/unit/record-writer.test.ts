import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type { MutantCoverage } from '@stryker-mutator/api/core';

import { lzTestFor } from '@layzee/lz-node-test';
import type { ProcessRecord } from '../../src/record.ts';
import {
  lzEndingSignals,
  lzHits,
  lzPersistRecord,
  type LzEndingSignal,
  type LzRecordDependencies,
} from '../../src/record-writer.ts';

interface Written {
  readonly path: string;
  readonly record: ProcessRecord;
}

const path = join('/tmp', 'out', '4321.0.json');

/** The process's events, record writes and timers, which a test drives as Node.js would. */
function fakeProcess(overrides: Partial<LzRecordDependencies>) {
  const exitListeners: (() => void)[] = [];
  const signalListeners: { readonly signal: LzEndingSignal; readonly listener: () => void }[] = [];
  let signalExitEmitters: readonly unknown[] = [];
  const raised: LzEndingSignal[] = [];
  const records: Written[] = [];
  const intervals: { readonly ms: number; readonly fire: () => void }[] = [];
  const deps: LzRecordDependencies = {
    onExit: (listener) => {
      exitListeners.push(listener);
    },
    offExit: (listener) => {
      exitListeners.splice(exitListeners.lastIndexOf(listener), 1);
    },
    onBeforeExit: () => {},
    writeRecord: (to, record) => {
      records.push({ path: to, record });
    },
    every: (fire, ms) => {
      intervals.push({ ms, fire });
    },
    signals: {
      on: (signal, listener) => {
        signalListeners.push({ signal, listener });
      },
      off: (signal, listener) => {
        const index = signalListeners.findIndex((entry) => entry.signal === signal && entry.listener === listener);
        signalListeners.splice(index, 1);
      },
      listenerCount: (signal) => signalListeners.filter((entry) => entry.signal === signal).length,
      signalExitEmitters: () => signalExitEmitters,
      raise: (signal) => {
        raised.push(signal);
      },
    },
    ...overrides,
  };

  return {
    deps,
    records,
    intervals,
    raised,
    exit: () => [...exitListeners].forEach((listener) => listener()),
    /** Sets what the hook finds as signal-exit's emitters; at first none. */
    useSignalExit: (emitters: readonly unknown[]) => {
      signalExitEmitters = emitters;
    },
    /** Adds a signal listener as the test file would, after the hook's. */
    listen: (signal: LzEndingSignal, listener: () => void) => {
      signalListeners.push({ signal, listener });
    },
    /** Runs the listeners of `signal` as Node.js does when the process gets it. */
    signal: (signal: LzEndingSignal) => {
      signalListeners.filter((entry) => entry.signal === signal).forEach((entry) => entry.listener());
    },
    listenerCounts: () =>
      Object.fromEntries(lzEndingSignals.map((signal) => [signal, deps.signals?.listenerCount(signal)])),
  };
}

/** A process whose record carries its coverage as it is at each write; `hit` counts a hit as instrumented code does. */
function persisted(
  options: { readonly main: boolean; readonly dryRun: boolean } = { main: false, dryRun: false },
  overrides: Partial<LzRecordDependencies> = {},
) {
  const fake = fakeProcess(overrides);
  const coverage: MutantCoverage = { static: {}, perTest: {} };
  lzPersistRecord(fake.deps, path, () => ({ tests: [], mutantCoverage: structuredClone(coverage) }), options);

  return {
    ...fake,
    hit: (mutantId: string) => {
      coverage.static[mutantId] = (coverage.static[mutantId] ?? 0) + 1;
    },
  };
}

const noListeners = { SIGTERM: 0, SIGINT: 0, SIGHUP: 0 };

describe('lzPersistRecord, for a process that a signal ends', () => {
  it('listens for SIGTERM, SIGINT and SIGHUP', () => {
    const { listenerCounts } = persisted();

    assert.deepEqual(listenerCounts(), { SIGTERM: 1, SIGINT: 1, SIGHUP: 1 });
  });

  it("listens for no signal in the test file's own process, which nothing signals while it runs", () => {
    const { listenerCounts } = persisted({ main: true, dryRun: false });

    assert.deepEqual(listenerCounts(), noListeners);
  });

  it('writes the record at exit where the platform has no signal to catch', () => {
    const windows = persisted(undefined, { signals: undefined });

    windows.exit();

    assert.equal(windows.records.length, 1);
  });

  lzTestFor<readonly [LzEndingSignal]>(lzEndingSignals.map((signal) => [signal]))(
    'writes the record on %s, stops listening and raises the signal again, as no other listener decides how the process ends',
    ([signal]) => {
      const { records, raised, signal: send, listenerCounts } = persisted();

      send(signal);

      assert.equal(records.length, 1);
      assert.deepEqual(listenerCounts(), noListeners);
      assert.deepEqual(raised, [signal]);
    },
  );

  it('stops listening and raises the signal again also when the record can no longer be written', () => {
    const { raised, signal, listenerCounts } = persisted(undefined, {
      writeRecord: () => {
        throw new Error('ENOENT: no such file or directory');
      },
    });

    signal('SIGTERM');

    assert.deepEqual(listenerCounts(), noListeners);
    assert.deepEqual(raised, ['SIGTERM']);
  });

  it("only writes the record when the process listens for the signal itself, so that the process's listener decides", () => {
    const { records, raised, signal, listen, listenerCounts } = persisted();
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
    const { raised, signal, listen, useSignalExit } = persisted();
    useSignalExit(emitters);
    listen('SIGTERM', () => {});
    listen('SIGTERM', () => {});

    signal('SIGTERM');

    assert.deepEqual(raised, expected);
  });
});

describe('lzPersistRecord, at exit', () => {
  /** A process whose record writes fail, counting them. */
  function failingWrites(options: { readonly main: boolean; readonly dryRun: boolean }) {
    let writes = 0;
    const { exit } = persisted(options, {
      writeRecord: () => {
        writes += 1;
        throw new Error('EPERM: operation not permitted, rename');
      },
    });

    return { exit, writes: () => writes };
  }

  it('exits without an error when the record of a process the tests started cannot be written', () => {
    const { exit, writes } = failingWrites({ main: false, dryRun: false });

    exit();

    assert.equal(writes(), 1);
  });

  it("lets the error through when the test file's own record cannot be written", () => {
    const { exit } = failingWrites({ main: true, dryRun: false });

    assert.throws(exit, /EPERM/);
  });

  it('lets the error through when the record of a process the tests started cannot be built', () => {
    const { deps, exit } = fakeProcess({});
    const unbuildable = (): ProcessRecord => {
      throw new Error('no peak memory');
    };
    lzPersistRecord(deps, path, unbuildable, { main: false, dryRun: false });

    assert.throws(exit, /no peak memory/);
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

describe('lzPersistRecord, in the dry run, for a process that ends without running its exit listeners', () => {
  const descendant = { main: false, dryRun: true };

  it('writes the record of a process the tests started every 250 ms, once its coverage has grown, as it writes every record', () => {
    const p = persisted(descendant);
    const tick = () => p.intervals.forEach(({ fire }) => fire());

    assert.deepEqual(
      p.intervals.map(({ ms }) => ms),
      [250],
    );

    tick();
    p.hit('1');
    tick();
    tick();
    p.hit('1');
    tick();

    assert.deepEqual(
      p.records.map(({ path: to, record }) => [to, record.mutantCoverage]),
      [
        [path, { static: { 1: 1 }, perTest: {} }],
        [path, { static: { 1: 2 }, perTest: {} }],
      ],
    );
  });

  lzTestFor<readonly [string, { readonly main: boolean; readonly dryRun: boolean }]>([
    ['outside the dry run', { main: false, dryRun: false }],
    ["in the test file's own process, whose record the runner ends it to write", { main: true, dryRun: true }],
  ])('writes no record while the process runs %s', ([, options]) => {
    const { intervals } = persisted(options);

    assert.deepEqual(intervals, []);
  });

  it('keeps the process running when its record can no longer be written, as when the run is over', () => {
    const p = persisted(descendant, {
      writeRecord: () => {
        throw new Error('ENOENT: no such file or directory');
      },
    });
    p.hit('1');

    p.intervals.forEach(({ fire }) => fire());

    assert.equal(p.intervals.length, 1);
  });
});
