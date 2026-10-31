import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import timers from 'node:timers/promises';

import { lzExec } from '../exec.ts';
import { lzInstall, lzPack, lzRemoveOnExit, lzReportFile, lzStryker, type LzStrykerRun } from '../fixture.ts';
import { lzParseOptions, lzStrykerConfig, type LzSide } from './options.ts';
import {
  lzDescendants,
  lzLeftovers,
  lzNewEntries,
  lzPeaks,
  type LzProcessPeaks,
  type LzProcessRow,
} from './processes.ts';
import { lzSnapshot, lzStartSampler } from './sampler.ts';
import { lzCompare, lzScore, type LzScore, type LzVerdict } from './verdicts.ts';

interface LzOssHeader {
  readonly project: string;
  readonly source: string;
  readonly sourceCommit: string;
  readonly workspaceCommit: string;
  readonly node: string;
  readonly platform: string;
  readonly concurrency: number;
  readonly tarballs: readonly string[];
  readonly startedAt: string;
}

interface LzLeftover {
  readonly pid: number;
  readonly name: string;
  readonly endedByDriver: boolean;
}

interface LzSideResult extends LzScore {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly reported: boolean;
  readonly wallMs: number;
  readonly mutants: number;
  readonly processes: LzProcessPeaks & { readonly leftover: readonly LzLeftover[] };
  readonly leftoverInRunTmp: readonly string[];
  readonly newInOsTmp: readonly string[];
  readonly leftoverStrykerTmp: readonly string[];
}

/** Without a report on both sides there is nothing to compare, which an empty disagreement list would hide. */
type LzComparison =
  | { readonly compared: false }
  | { readonly compared: true; readonly disagreements: readonly LzVerdict[]; readonly verdicts: readonly LzVerdict[] };

/** The shape of result.json. */
type LzOssResult = LzOssHeader &
  (
    | { readonly preparedIn: string }
    | ({ readonly sides: { readonly lz: LzSideResult; readonly command: LzSideResult } } & LzComparison)
  );

interface LzSideRun {
  readonly run: LzStrykerRun;
  readonly result: LzSideResult;
}

const sides: readonly LzSide[] = ['lz', 'command'];
const workspaceDir = resolve(import.meta.dirname, '..', '..', '..');
/** How long processes that a run left get to end by themselves before they count as left behind. */
const settleMs = 2_000;

const options = lzParseOptions(process.argv.slice(2));
const out = resolve(options.out);

mkdirSync(out, { recursive: true });
const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `lz-oss-driver-${process.pid}-`)));

if (!options.prepareOnly) {
  lzRemoveOnExit(dir);
}

const copied = new Set(['.git', 'node_modules']);

cpSync(options.source, dir, { recursive: true, filter: (path) => !copied.has(relative(options.source, path)) });
mkdirSync(join(dir, 'tmp'));
const tarballs = options.tarballs === undefined ? await lzPack(join(dir, 'tarballs')) : given(options.tarballs);

await lzInstall(dir, tarballs);
sides.forEach((side) => {
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
  tarballs: tarballs.map((tarball) => basename(tarball)),
  startedAt: new Date().toISOString(),
};

if (options.prepareOnly) {
  writeResult({ ...header, preparedIn: dir });
  process.stdout.write(`Prepared ${dir}; it stays for manual runs.\n`);
} else {
  const lz = await runSide('lz');
  const command = await runSide('command');

  writeResult({ ...header, sides: { lz: lz.result, command: command.result }, ...comparison(lz.run, command.run) });
}

async function runSide(side: LzSide): Promise<LzSideRun> {
  const osTmpBefore = readdirSync(tmpdir());
  const sampler = lzStartSampler();
  const excluded = new Set([sampler.pid]);
  const started = performance.now();
  const run = await lzStryker(dir, configFile(side), options.concurrency);
  const wallMs = Math.round(performance.now() - started);
  const samples = (await sampler.stop()).map((sample) => lzDescendants(sample, process.pid, excluded));

  await timers.setTimeout(settleMs);
  // Ended once recorded, so that one side's leftovers cannot load the next side's run.
  const leftovers = await Promise.all(
    lzLeftovers(samples.flat(), await lzSnapshot()).map(async (leftover) => ({
      pid: leftover.pid,
      name: leftover.name,
      endedByDriver: await end(leftover),
    })),
  );

  writeFileSync(join(out, `${side}.log`), run.output);

  if (run.reported) {
    copyFileSync(join(dir, lzReportFile), join(out, `${side}.mutation.json`));
  }

  const strykerTmp = join(dir, '.stryker-tmp');
  const mutants = run.reported ? [...run.report.values()].flat() : [];

  return {
    run,
    result: {
      exitCode: run.exitCode,
      timedOut: run.timedOut,
      reported: run.reported,
      wallMs,
      ...lzScore(mutants),
      mutants: mutants.length,
      processes: { ...lzPeaks(samples), leftover: leftovers },
      leftoverInRunTmp: run.leftover,
      newInOsTmp: lzNewEntries(osTmpBefore, readdirSync(tmpdir())),
      leftoverStrykerTmp: existsSync(strykerTmp) ? readdirSync(strykerTmp) : [],
    },
  };
}

/** False when the process ended, or its id went to another process, before the driver could end it. */
async function end(leftover: LzProcessRow): Promise<boolean> {
  if (lzLeftovers([leftover], await lzSnapshot()).length === 0) {
    return false;
  }

  try {
    process.kill(leftover.pid);

    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false;
    }

    throw error;
  }
}

function comparison(lz: LzStrykerRun, command: LzStrykerRun): LzComparison {
  if (!lz.reported || !command.reported) {
    return { compared: false };
  }

  const verdicts = lzCompare(lz.report, command.report);

  return { compared: true, disagreements: verdicts.filter((verdict) => verdict.lz !== verdict.command), verdicts };
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

function writeResult(result: LzOssResult): void {
  const file = join(out, 'result.json');

  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Wrote ${file}\n`);
}
