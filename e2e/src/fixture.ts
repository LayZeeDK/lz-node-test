import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { lzExec } from './exec.ts';
import { lzIsRecord, lzMutantLine, lzParseReport, type LzMutantDetail, type LzReport } from './report.ts';

const workspaceDir = join(import.meta.dirname, '..', '..');
const packagesDir = join(workspaceDir, 'packages');
const fixturesDir = join(import.meta.dirname, '..', 'fixtures');
/** What a consumer installs beside the packed packages, at the versions the workspace root pins. */
const pinnedNames: readonly string[] = [
  '@stryker-mutator/core',
  '@stryker-mutator/typescript-checker',
  'typescript',
  '@types/node',
];
const strykerBin = join('node_modules', '@stryker-mutator', 'core', 'bin', 'stryker.js');
const reportFile = join('reports', 'mutation', 'mutation.json');
const strykerTimeoutMs = 15 * 60_000;
const dirPrefix = 'lz-node-test-e2e-';
const concurrencyVariable = 'LZ_E2E_CONCURRENCY';

interface LzStrykerOutcome {
  readonly exitCode: number;
  /** stdout, then stderr. */
  readonly output: string;
  /** Names the run left in the fixture's temporary directory; empty when it cleaned up. */
  readonly leftover: readonly string[];
  /** Whether the harness ended the run after 15 minutes. */
  readonly timedOut: boolean;
}

export type LzStrykerRun =
  | (LzStrykerOutcome & { reported: true; report: LzReport })
  | (LzStrykerOutcome & { reported: false });

export interface LzFixture {
  /** The installed copy of the fixture: a real path under `os.tmpdir()`, outside the workspace. */
  readonly dir: string;
  /** `stryker run <configFile>` in `dir` with the JSON reporter and `LZ_E2E_CONCURRENCY` workers. */
  stryker(configFile?: string): Promise<LzStrykerRun>;
}

/**
 * Copies `e2e/fixtures/<name>` to a fresh directory under `os.tmpdir()`, packs every package under `packages/` into
 * it, installs the tarballs with the Stryker and TypeScript versions the workspace root pins, and removes the
 * directory when this process exits. Throws before any of that when `LZ_E2E_CONCURRENCY` is not a positive integer,
 * and with npm's output when a pack or the install fails.
 */
export async function lzFixture(name: string): Promise<LzFixture> {
  const concurrency = lzConcurrency(process.env);

  removeDeadRunDirs(tmpdir());
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), `${dirPrefix}${process.pid}-`)));

  removeOnExit(dir);
  cpSync(join(fixturesDir, name), dir, { recursive: true });
  mkdirSync(join(dir, 'tmp'));
  const tarballs = await pack(join(dir, 'tarballs'));

  // npx and npm exec hand npm_config_prefix and npm_config_local_prefix (the workspace) on to this process.
  await npm(dir, [
    'install',
    '--save-dev',
    '--save-exact',
    '--prefix',
    dir,
    '--no-audit',
    '--no-fund',
    ...tarballs,
    ...pinned(),
  ]);

  return { dir, stryker: (configFile = 'stryker.config.mjs') => stryker(dir, configFile, concurrency) };
}

/**
 * Stryker's worker count from `LZ_E2E_CONCURRENCY`. Required, so that no run falls back to Stryker's default of all
 * cores but one on a machine that other work shares.
 */
export function lzConcurrency(env: NodeJS.ProcessEnv): number {
  const value = env[concurrencyVariable];

  if (value === undefined || !/^[1-9]\d*$/.test(value)) {
    throw new Error(
      `Set ${concurrencyVariable} to a positive integer, the Stryker workers each e2e run may start; size it to the ` +
        `machine's current load. It is ${value === undefined ? 'unset' : `"${value}"`}.`,
    );
  }

  return Number(value);
}

/**
 * The mutants of `file` in a reported run as `<line>:<column> <mutator> <replacement> <status>`, sorted by position.
 * Throws with Stryker's output when the run never reported, and names the report's files when `file` is not one.
 */
export function lzMutants(run: LzStrykerRun, file: string): string[] {
  const report = reportOf(run);
  const mutants = report.get(file);

  if (mutants === undefined) {
    throw new Error(`The report has no file "${file}"; it has ${[...report.keys()].join(', ')}.`);
  }

  return mutants.map(lzMutantLine);
}

/** The names a run left in its temporary directory, with the process id in each written as `<pid>`. */
export function lzLeftover(run: LzStrykerRun): string[] {
  return run.leftover.map((name) => name.replace(/-\d+-/, '-<pid>-'));
}

/** The one mutant at `<file>:<line>:<column>` with `replacement`; throws when none or more than one matches. */
export function lzMutant(run: LzStrykerRun, { at, replacement }: { at: string; replacement: string }): LzMutantDetail {
  const matches = [...reportOf(run)].flatMap(([file, mutants]) =>
    mutants.filter((mutant) => `${file}:${mutant.line}:${mutant.column}` === at && mutant.replacement === replacement),
  );
  const [mutant] = matches;

  if (mutant === undefined || matches.length > 1) {
    throw new Error(`Expected one mutant at ${at} with replacement "${replacement}", found ${matches.length}.`);
  }

  return mutant;
}

function reportOf(run: LzStrykerRun): LzReport {
  if (!run.reported) {
    throw new Error(
      `Stryker wrote no report (exit code ${run.exitCode}${run.timedOut ? ', ended after 15 minutes' : ''}):\n` +
        run.output,
    );
  }

  return run.report;
}

async function stryker(dir: string, configFile: string, concurrency: number): Promise<LzStrykerRun> {
  const tmp = join(dir, 'tmp');
  const report = join(dir, reportFile);
  const before = new Set(readdirSync(tmp));
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp };

  // The suite's own node --test sets these; a consumer's Stryker runs without them.
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  // A second run on the same install must not read the first one's report.
  rmSync(report, { force: true });
  const { exitCode, stdout, stderr, timedOut } = await lzExec(
    process.execPath,
    [strykerBin, 'run', configFile, '--concurrency', String(concurrency), '--reporters', 'clear-text,json'],
    { cwd: dir, env, timeoutMs: strykerTimeoutMs },
  );
  const outcome: LzStrykerOutcome = {
    exitCode,
    output: stdout + stderr,
    leftover: readdirSync(tmp)
      .filter((entry) => !before.has(entry))
      .sort(),
    timedOut,
  };

  return existsSync(report)
    ? { ...outcome, reported: true, report: lzParseReport(readFileSync(report, 'utf8')) }
    : { ...outcome, reported: false };
}

/** `npm pack` of each package under `packages/` into `into`; the tarball paths, as npm's JSON names them. */
async function pack(into: string): Promise<string[]> {
  mkdirSync(into);
  const tarballs: string[] = [];

  for (const name of readdirSync(packagesDir)) {
    const stdout = await npm(workspaceDir, ['pack', '--json', '--pack-destination', into, join(packagesDir, name)]);

    tarballs.push(join(into, packedFile(stdout)));
  }

  return tarballs;
}

/** npm 11 prints an array of packed packages, npm 12 an object keyed by package name. */
function packedFile(stdout: string): string {
  const packed: unknown = JSON.parse(stdout);
  const [entry]: unknown[] = Array.isArray(packed) ? packed : lzIsRecord(packed) ? Object.values(packed) : [];

  if (!lzIsRecord(entry) || typeof entry.filename !== 'string') {
    throw new Error(`npm pack --json printed no filename:\n${stdout}`);
  }

  return entry.filename;
}

/** `<name>@<version>` for each pinned name, from the workspace root package.json's devDependencies. */
function pinned(): string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(workspaceDir, 'package.json'), 'utf8'));
  const devDependencies = lzIsRecord(manifest) ? manifest.devDependencies : undefined;

  return pinnedNames.map((name) => {
    const version = lzIsRecord(devDependencies) ? devDependencies[name] : undefined;

    if (typeof version !== 'string') {
      throw new Error(`The workspace package.json pins no ${name} in devDependencies.`);
    }

    return `${name}@${version}`;
  });
}

/** Runs npm as `node <npm-cli.js>`, so no shell and no `npm.cmd` on Windows; throws with its output when it fails. */
async function npm(cwd: string, args: readonly string[]): Promise<string> {
  const { exitCode, stdout, stderr } = await lzExec(process.execPath, [npmCli(), ...args], { cwd });

  if (exitCode !== 0) {
    throw new Error(`npm ${args.join(' ')} ended with exit code ${exitCode}:\n${stdout}${stderr}`);
  }

  return stdout;
}

/**
 * The npm that started this process (`npm_execpath`, which npm, npx and `npm exec` set to a file in npm's `bin`), else
 * the one installed beside the Node.js binary, in the Windows or the POSIX layout.
 */
function npmCli(): string {
  const started = process.env.npm_execpath;
  const nodeDir = dirname(process.execPath);
  const candidates = [
    ...(started === undefined ? [] : [join(dirname(started), 'npm-cli.js')]),
    join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));

  if (found === undefined) {
    throw new Error(`Found no npm-cli.js; looked at ${candidates.join(', ')}.`);
  }

  return found;
}

/** Removes the fixture directories of e2e runs whose process no longer runs, as a killed run cannot remove its own. */
function removeDeadRunDirs(dir: string): void {
  for (const name of readdirSync(dir)) {
    const pid = new RegExp(`^${dirPrefix}(\\d+)-`).exec(name)?.[1];

    if (pid !== undefined && !isRunning(Number(pid))) {
      try {
        rmSync(join(dir, name), { recursive: true, force: true });
      } catch {
        // A process the dead run started may still work in it; a later run tries again.
      }
    }
  }
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

/** Windows refuses to remove a directory that a lingering child process still works in, so removal retries. */
function removeOnExit(dir: string): void {
  process.on('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      process.stderr.write(`Left behind ${dir}: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  });
}
