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
import {
  lzInstall,
  lzPack,
  lzRemoveDeadRunDirs,
  lzRemoveOnExit,
  lzReportFile,
  lzStryker,
  type LzStrykerRun,
} from '../fixture.ts';
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

interface LzStrykerResult extends LzScore {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly reported: boolean;
  readonly mutants: number;
  readonly leftoverInRunTmp: readonly string[];
}

interface LzSideResult {
  /** Null when the Stryker run itself threw; `errors` says why. */
  readonly stryker: LzStrykerResult | null;
  /** Each step that threw, so a failed step leaves the result of the others. */
  readonly errors: readonly string[];
  readonly wallMs: number;
  readonly processes: LzProcessPeaks & { readonly leftover: readonly LzLeftover[] };
  readonly newInOsTmp: readonly string[];
  readonly leftoverStrykerTmp: readonly string[];
}

/** Without a report on both sides there is nothing to compare, which an empty disagreement list would hide. */
type LzComparison =
  | { readonly compared: false; readonly reason: string }
  | { readonly compared: true; readonly disagreements: readonly LzVerdict[]; readonly verdicts: readonly LzVerdict[] };

type LzSettled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** The shape of result.json. */
type LzOssResult = LzOssHeader &
  (
    | { readonly preparedIn: string }
    | ({ readonly sides: { readonly lz: LzSideResult; readonly command: LzSideResult } } & LzComparison)
  );

interface LzSideRun {
  readonly run: LzStrykerRun | null;
  readonly result: LzSideResult;
}

const sides: readonly LzSide[] = ['lz', 'command'];
const dirPrefix = 'lz-oss-driver-';
const workspaceDir = resolve(import.meta.dirname, '..', '..', '..');
/** How long processes that a run left get to end by themselves before they count as left behind. */
const settleMs = 2_000;

const options = lzParseOptions(process.argv.slice(2));
const out = resolve(options.out);

mkdirSync(out, { recursive: true });
lzRemoveDeadRunDirs(tmpdir(), dirPrefix);
const root = realpathSync.native(mkdtempSync(join(tmpdir(), `${dirPrefix}${process.pid}-`)));
// Beside the copy, not in it, so that no folder of the project can collide with them.
const dir = join(root, 'project');
const runTmp = join(root, 'tmp');

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
mkdirSync(runTmp);
const tarballs = options.tarballs === undefined ? await lzPack(join(root, 'tarballs')) : given(options.tarballs);

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
  process.stdout.write(`Prepared ${dir}, with ${runTmp} for TMP; both stay for manual runs.\n`);
} else {
  const lz = await runSide('lz');
  const command = await runSide('command');

  writeResult({ ...header, sides: { lz: lz.result, command: command.result }, ...comparison(lz.run, command.run) });
}

/** Each step is settled, so a throw in the run, the sampler or an ending still stops the sampler and ends leftovers. */
async function runSide(side: LzSide): Promise<LzSideRun> {
  const osTmpBefore = readdirSync(tmpdir());
  const sampler = lzStartSampler();
  const excluded = new Set([sampler.pid]);
  const started = performance.now();
  const run = await settled('Stryker run', lzStryker(dir, configFile(side), options.concurrency, runTmp));
  const wallMs = Math.round(performance.now() - started);
  const stopped = await settled('Sampler', sampler.stop());
  const samples = stopped.ok ? stopped.value.map((sample) => lzDescendants(sample, process.pid, excluded)) : [];

  await timers.setTimeout(settleMs);
  // Ended once recorded, so that one side's leftovers cannot load the next side's run.
  const found = await settled(
    'Leftover snapshot',
    lzSnapshot().then((now) => lzLeftovers(samples.flat(), now)),
  );
  const ended = await Promise.all(
    (found.ok ? found.value : []).map(async (leftover) => ({
      leftover,
      ending: await settled(`Ending ${leftover.pid}`, end(leftover)),
    })),
  );
  const strykerTmp = join(dir, '.stryker-tmp');

  if (run.ok) {
    writeFileSync(join(out, `${side}.log`), run.value.output);
  }

  if (run.ok && run.value.reported) {
    copyFileSync(join(dir, lzReportFile), join(out, `${side}.mutation.json`));
  }

  return {
    run: run.ok ? run.value : null,
    result: {
      stryker: run.ok ? strykerResult(run.value) : null,
      errors: [run, stopped, found, ...ended.map(({ ending }) => ending)].flatMap((step) =>
        step.ok ? [] : [step.error],
      ),
      wallMs,
      processes: {
        ...lzPeaks(samples),
        leftover: ended.map(({ leftover: { pid, name }, ending }) => ({
          pid,
          name,
          endedByDriver: ending.ok && ending.value,
        })),
      },
      newInOsTmp: lzNewEntries(osTmpBefore, readdirSync(tmpdir())),
      leftoverStrykerTmp: existsSync(strykerTmp) ? readdirSync(strykerTmp) : [],
    },
  };
}

function strykerResult(run: LzStrykerRun): LzStrykerResult {
  const mutants = run.reported ? [...run.report.values()].flat() : [];

  return {
    exitCode: run.exitCode,
    timedOut: run.timedOut,
    reported: run.reported,
    ...lzScore(mutants),
    mutants: mutants.length,
    leftoverInRunTmp: run.leftover,
  };
}

async function settled<T>(step: string, promise: Promise<T>): Promise<LzSettled<T>> {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error: `${step}: ${error instanceof Error ? error.message : String(error)}` };
  }
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

function comparison(lz: LzStrykerRun | null, command: LzStrykerRun | null): LzComparison {
  if (lz?.reported !== true || command?.reported !== true) {
    return { compared: false, reason: 'A side wrote no report.' };
  }

  try {
    const verdicts = lzCompare(lz.report, command.report);

    return { compared: true, disagreements: verdicts.filter((verdict) => verdict.lz !== verdict.command), verdicts };
  } catch (error) {
    return { compared: false, reason: error instanceof Error ? error.message : String(error) };
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

function writeResult(result: LzOssResult): void {
  const file = join(out, 'result.json');

  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`Wrote ${file}\n`);
}
