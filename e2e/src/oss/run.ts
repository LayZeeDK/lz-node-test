import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import timers from 'node:timers/promises';

import { lzExec } from '../exec.ts';
import {
  lzInstall,
  lzPack,
  lzRemoveDeadRunDirs,
  lzRemoveOnExit,
  lzReportFile,
  lzStryker,
  type LzStrykerRun,
} from '../fixture.ts';
import {
  lzCheckpointArgs,
  lzCheckpointKey,
  lzCheckpointReporterName,
  lzEndCheckpoint,
  lzInstalledVersions,
  lzStartCheckpoint,
} from './checkpoint.ts';
import {
  lzOssPreparedPrefix,
  lzOssRunPrefix,
  lzSides,
  lzStrykerArgs,
  lzStrykerConfig,
  type LzOssOptions,
  type LzSide,
} from './options.ts';
import { lzApplyPatches, lzFileWriters } from './prepare.ts';
import { lzDescendants, lzLeftovers, lzNewEntries, lzPeaks } from './processes.ts';
import type { LzOssHeader, LzOssResult, LzSideResult, LzStrykerResult } from './result.ts';
import { lzSnapshot, lzStartSampler } from './sampler.ts';
import { lzBySide, lzComparison, lzMessageOf, lzReportScore, type LzSideReport } from './verdicts.ts';

type LzSettled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

interface LzSideRun {
  readonly side: LzSide;
  readonly report: LzSideReport;
  readonly result: LzSideResult;
}

const workspaceDir = resolve(import.meta.dirname, '..', '..', '..');
/** How long processes that a run left get to end by themselves before they count as left behind. */
const settleMs = 2_000;

/** What one side's run needs: the options, `out`, `dir` for the project's copy and `runTmp` for Stryker's TMP. */
interface LzRunContext {
  readonly options: LzOssOptions;
  readonly out: string;
  readonly dir: string;
  readonly runTmp: string;
}

export async function lzRunDriver(options: LzOssOptions): Promise<void> {
  const out = resolve(options.out);

  mkdirSync(out, { recursive: true });
  lzClearResult(out);
  lzRemoveDeadRunDirs(tmpdir(), lzOssRunPrefix);
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), `${options.prepareOnly ? lzOssPreparedPrefix : lzOssRunPrefix}${process.pid}-`)),
  );
  // Beside the copy, not in it, so that no folder of the project can collide with them.
  const context: LzRunContext = { options, out, dir: join(root, 'project'), runTmp: join(root, 'tmp') };
  const { dir, runTmp } = context;

  if (!options.prepareOnly) {
    lzRemoveOnExit(root);
  }

  const copied = new Set(['.git', 'node_modules']);

  // Verbatim, as a relative link rewritten to an absolute one would let a write in the copy reach the source.
  cpSync(options.source, dir, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (path) => !copied.has(relative(options.source, path)),
  });
  const { patches, testFiles } = options.project;

  lzApplyPatches(dir, patches);
  lzFileWriters(
    dir,
    testFiles,
    patches.map(({ file }) => file),
  ).forEach((calls, file) => {
    process.stdout.write(
      `${file} writes files (${calls.join(', ')}); a fixed path there would collide across Stryker workers.\n`,
    );
  });
  mkdirSync(runTmp);
  const tarballs = options.tarballs === undefined ? await lzPack(join(root, 'tarballs')) : given(options.tarballs);

  await lzInstall(dir, tarballs);
  lzSides.forEach((side) => {
    writeFileSync(join(dir, configFile(side)), lzStrykerConfig(side, options.project));
  });

  const header: LzOssHeader = {
    project: options.project.name,
    source: options.source,
    sourceCommit: await commitOf(options.source),
    workspaceCommit: await commitOf(workspaceDir),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    concurrency: options.concurrency,
    timeLimitMinutes: options.timeLimitMinutes,
    mutantTimeoutMs: options.mutantTimeoutMs ?? null,
    mutate: options.mutate,
    tarballs: tarballs.map((tarball) => basename(tarball)),
    startedAt: new Date().toISOString(),
  };

  if (options.prepareOnly) {
    writeResult(out, { ...header, preparedIn: dir });
    process.stdout.write(`Prepared ${dir}, with ${runTmp} for TMP; both stay for manual runs.\n`);

    return;
  }

  const tarballDigests = tarballs.map((tarball) => createHash('sha256').update(readFileSync(tarball)).digest('hex'));
  const installed = lzInstalledVersions(readFileSync(join(dir, 'node_modules', '.package-lock.json'), 'utf8'));
  const checkpointKey = (side: LzSide): string =>
    lzCheckpointKey({
      project: options.project,
      sourceCommit: header.sourceCommit,
      node: header.node,
      platform: header.platform,
      installed,
      mutate: header.mutate,
      mutantTimeoutMs: header.mutantTimeoutMs,
      config: lzStrykerConfig(side, options.project),
      tarballDigests,
    });
  // One side after the other, so that the two never share the machine.
  const runs = await options.sides.reduce<Promise<readonly LzSideRun[]>>(
    async (earlier, side) => [...(await earlier), await runSide(side, context, checkpointKey(side))],
    Promise.resolve([]),
  );

  writeResult(out, {
    ...header,
    sides: lzBySide(runs, ({ result }) => result),
    ...lzComparison(lzBySide(runs, ({ report }) => report)),
  });
}

/** A run that dies before it writes result.json must leave none, not the previous run's beside this run's side files. */
export function lzClearResult(out: string): void {
  rmSync(join(out, 'result.json'), { force: true });
}

/** An earlier run's report or log left in `out` must not pass for this run's. */
export function lzClearSideFiles(out: string, side: LzSide): void {
  [`${side}.mutation.json`, `${side}.log`].forEach((name) => {
    rmSync(join(out, name), { force: true });
  });
}

/**
 * Each step is settled, so a throw in one still stops the sampler, ends leftovers, lets result.json be written and
 * lets the next side run.
 */
async function runSide(
  side: LzSide,
  { options, out, dir, runTmp }: LzRunContext,
  checkpointKey: string,
): Promise<LzSideRun> {
  const errors: string[] = [];
  const settled = settledInto(errors);
  const checkpoint = join(out, `${side}.checkpoint.json`);

  await settled("Removing an earlier run's report and log", () => {
    lzClearSideFiles(out, side);
  });
  // A checkpoint that cannot be read, such as one Stryker's own final write left cut short, would fail every rerun:
  // it goes, and the run starts a new one.
  const firstStart = await settled('Checkpoint', () => lzStartCheckpoint(checkpoint, checkpointKey));
  const resumed = firstStart.ok
    ? firstStart
    : await settled('Checkpoint after removing the unreadable one', () => {
        lzEndCheckpoint(checkpoint);
        process.stdout.write(`Removed ${checkpoint}, which could not be read; ${side} starts afresh.\n`);

        return lzStartCheckpoint(checkpoint, checkpointKey);
      });
  const osTmpBefore = await settled('TMP listing before the run', () => readdirSync(tmpdir()));
  const sampler = lzStartSampler();
  const excluded = new Set([sampler.pid]);
  const started = performance.now();
  const run = await settled('Stryker run', () =>
    lzStryker(dir, configFile(side), options.concurrency, {
      tmp: runTmp,
      timeoutMs: options.timeLimitMinutes * 60_000,
      args: [...lzStrykerArgs(options), ...(resumed.ok ? lzCheckpointArgs(checkpoint) : [])],
      logFile: join(out, `${side}.log`),
      reporters: resumed.ok ? [lzCheckpointReporterName] : [],
    }),
  );
  const wallMs = Math.round(performance.now() - started);
  const stopped = await settled('Sampler', () => sampler.stop());
  const samples = stopped.ok ? stopped.value.map((sample) => lzDescendants(sample, process.pid, excluded)) : [];

  await timers.setTimeout(settleMs);
  // One fresh snapshot just before the endings, so a pair that ended or whose id was reused meanwhile is skipped.
  // Ended once recorded, so that one side's leftovers cannot load the next side's run.
  const found = await settled('Leftover snapshot', async () => lzLeftovers(samples.flat(), await lzSnapshot()));
  const ended = await Promise.all(
    (found.ok ? found.value : []).map(async (leftover) => ({
      leftover,
      ending: await settled(`Ending ${leftover.pid}`, () => end(leftover.pid)),
    })),
  );
  await settled('Report copy', () => {
    if (run.ok && run.value.reported) {
      copyFileSync(join(dir, lzReportFile), join(out, `${side}.mutation.json`));
      lzEndCheckpoint(checkpoint);
    }
  });
  const osTmpAfter = await settled('TMP listing after the run', () => readdirSync(tmpdir()));
  const strykerTmp = join(dir, '.stryker-tmp');
  const strykerTmpEntries = await settled('.stryker-tmp listing', () =>
    existsSync(strykerTmp) ? readdirSync(strykerTmp) : [],
  );

  return {
    side,
    report: run.ok ? run.value : { reported: false },
    result: {
      stryker: run.ok ? strykerResult(run.value) : null,
      errors,
      wallMs,
      resumedMutants: resumed.ok ? resumed.value : 0,
      processes: {
        ...lzPeaks(samples),
        leftover: ended.map(({ leftover: { pid, name }, ending }) => ({
          pid,
          name,
          endedByDriver: ending.ok && ending.value,
        })),
      },
      newInOsTmp: osTmpBefore.ok && osTmpAfter.ok ? lzNewEntries(osTmpBefore.value, osTmpAfter.value) : [],
      leftoverStrykerTmp: strykerTmpEntries.ok ? strykerTmpEntries.value : [],
    },
  };
}

function strykerResult(run: LzStrykerRun): LzStrykerResult {
  return {
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    reported: run.reported,
    ...lzReportScore(run.reported ? run.report : new Map()),
    leftoverInRunTmp: run.leftover,
  };
}

/** Settles each step, recording a step that throws in `errors`, so no failed step goes unreported. */
function settledInto(errors: string[]) {
  return async <T>(step: string, run: () => T | Promise<T>): Promise<LzSettled<T>> => {
    try {
      return { ok: true, value: await run() };
    } catch (error) {
      errors.push(`${step}: ${lzMessageOf(error)}`);

      return { ok: false };
    }
  };
}

/** False when the process ended by itself before the driver could end it. */
function end(pid: number): boolean {
  try {
    process.kill(pid);

    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false;
    }

    throw error;
  }
}

function configFile(side: LzSide): string {
  return `stryker.${side}.config.mjs`;
}

function given(folder: string): string[] {
  const found = readdirSync(folder)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => resolve(folder, name));

  if (found.length === 0) {
    throw new Error(`${folder} holds no .tgz file.`);
  }

  return found;
}

async function commitOf(cwd: string): Promise<string> {
  const { exitCode, stdout, stderr } = await lzExec('git', ['rev-parse', 'HEAD'], { cwd });

  if (exitCode !== 0) {
    throw new Error(`git rev-parse HEAD in ${cwd} ended with exit code ${exitCode}:\n${stderr}`);
  }

  return stdout.trim();
}

function writeResult(out: string, result: LzOssResult): void {
  const file = join(out, 'result.json');

  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Wrote ${file}\n`);
}
