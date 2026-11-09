import { registerHooks } from 'node:module';
import { extname, resolve } from 'node:path';
import { getCallSites, inspect } from 'node:util';
import { isMainThread, threadId, Worker } from 'node:worker_threads';

import { install, writesAllowed, type HookDependencies } from './hook-core.ts';
import { envNames, lzRecordNonce, lzWriteRecord } from './record.ts';
import { workersAllowed } from './watchdog.ts';

// The memory watchdog's thread runs this script, where Stryker sees no coverage, so it only starts watchdog.ts's watch,
// whose code this process's tests reach.
const watchdog = `Promise.all([
  import('node:worker_threads'),
  import(${JSON.stringify(new URL(`./watchdog${extname(import.meta.filename)}`, import.meta.url).href)}),
]).then(([{ workerData }, { watch }]) => watch(workerData));`;

// Exported so the tests can call them in their own process: those of the test files they start report no coverage.
// process.exit(undefined) sets the exit code to undefined, so it would exit with 0.
// eslint-disable-next-line n/no-process-exit -- the hook ends a test file's process once its tests are done, though something may hold it open
export const exit: HookDependencies['exit'] = (code) => process.exit(code ?? process.exitCode);

export const activeResources: HookDependencies['activeResources'] = () => process.getActiveResourcesInfo();

export const later: HookDependencies['later'] = (callback, ms) => {
  setTimeout(callback, ms).unref();
};

export const lzEvery: HookDependencies['every'] = (callback, ms) => {
  setInterval(callback, ms).unref();
};

export function lzSignals(platform: NodeJS.Platform): HookDependencies['signals'] {
  return platform === 'win32'
    ? undefined
    : {
        on: (signal, listener) => process.on(signal, listener),
        off: (signal, listener) => process.off(signal, listener),
        listenerCount: (signal) => process.listenerCount(signal),
        signalExitEmitters: () => {
          const version4: unknown = Reflect.get(globalThis, Symbol.for('signal-exit emitter'));
          const version3: unknown = Reflect.get(process, '__signal_exit_emitter__');

          return [version4, version3];
        },
        raise: (signal) => process.kill(process.pid, signal),
      };
}

// Found once, so that a test that fakes process.hrtime, as fake timers do, leaves the clock of every span alone.
const hrtime = process.hrtime.bigint.bind(process.hrtime);

export const now: HookDependencies['now'] = () => Number(hrtime()) / 1e6;

install({
  env: process.env,
  execArgv: process.execArgv,
  mainFile: process.argv[1] ? resolve(process.argv[1]) : undefined,
  pid: process.pid,
  nonce: lzRecordNonce(),
  threadId,
  global: globalThis,
  nodeTest: () => process.getBuiltinModule('node:test'),
  registerHooks,
  onExit: (listener) => process.on('exit', listener),
  offExit: (listener) => process.off('exit', listener),
  onBeforeExit: (listener) => process.on('beforeExit', listener),
  writeRecord: lzWriteRecord,
  every: lzEvery,
  exit,
  activeResources,
  later,
  canWriteRecords: writesAllowed(process.permission, process.env[envNames.out]),
  maxRssKiB: () => process.resourceUsage().maxRSS,
  canWatchMemory: isMainThread && workersAllowed(process.permission),
  watchMemory: (options) => {
    // Stryker disable next-line ArrayDeclaration: equivalent, as hook-core always passes execArgv: []
    const worker = new Worker(watchdog, { eval: true, ...options, execArgv: [...options.execArgv] });
    // Listening keeps a watchdog error from ending the process; the line reaches the runner's stderr tail.
    worker.on('error', (error: unknown) => {
      const message = error instanceof Error ? error.message : inspect(error);
      process.stderr.write(
        `lz-node-test: the memory watchdog failed, so no memory limit guards this process: ${message}\n`,
      );
    });
    worker.unref();

    return worker;
  },
  callSites: getCallSites,
  now,
  signals: lzSignals(process.platform),
  platform: process.platform,
  parentPid: () => process.ppid,
  // Stryker disable next-line ArrowFunction: POSIX only, as Windows has no process groups to end; the Linux run kills it
  kill: (pid, signal) => process.kill(pid, signal),
});
