import { lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import timers from 'node:timers/promises';

import type { Logger } from '@stryker-mutator/api/logging';

const removeWaitMs = 2_000;

/**
 * Creates `dir` for this user alone, or checks that the one that exists is this user's: in a temporary directory that
 * other users share, someone else could have made it first, with links in it, to read or plant what the dry run kept.
 */
export function ownDir(dir: string, owned: (path: string) => boolean = isOwn): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  if (!owned(dir)) {
    throw new Error(`"${dir}" belongs to another user; remove it, or run Stryker as that user.`);
  }
}

/**
 * A process that a test file started can outlive the file's process, and Windows refuses to remove a directory that a
 * running process works in. With retries, `rm` gives up after about a second when the process works in the directory
 * itself, but waits until the process ends when it works in a directory inside it, as in the run's temporary
 * directory.
 */
export async function removeDir(
  dir: string,
  log: Logger,
  {
    waitMs = removeWaitMs,
    remove = (path: string) => rm(path, { recursive: true, maxRetries: 10, retryDelay: 20 }),
  } = {},
): Promise<void> {
  const warning = await Promise.race([
    remove(dir).then(
      () => undefined,
      (error: unknown) =>
        `Left ${dir} for a later runner to remove: ${error instanceof Error ? error.message : String(error)}`,
    ),
    timers.setTimeout(
      waitMs,
      `Stopped waiting for ${dir} to be removed after ${waitMs} ms; a later runner removes what is left.`,
      { ref: false },
    ),
  ]);

  if (warning !== undefined) {
    log.warn(warning);
  }
}

/** Whether a process with this id runs; one that exists but may not be signalled runs too. */
export function isRunning(
  pid: number,
  kill: (pid: number, signal: 0) => void = (target, signal) => process.kill(target, signal),
): boolean {
  try {
    kill(pid, 0);

    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

/**
 * Whether this user owns the file or directory itself, not what a link points to. Windows has no user ids, so there
 * every one counts as owned.
 */
export function isOwn(
  path: string,
  user: { getuid?: () => number } = process,
  stat: (path: string) => { uid: number } = lstatSync,
): boolean {
  return user.getuid === undefined || stat(path).uid === user.getuid();
}

const lzDirBase = 'lz-stryker-node-test-';
const lzDirKinds = { run: '', cache: 'cache-', dryRun: 'dry-run-' };
const lzDirPattern = new RegExp(`^${lzDirBase}(?:${Object.values(lzDirKinds).join('|')})(\\d+)-`);

/** The start of the name of a directory that the runners of process `pid` make, which `removeLeftDirs` recognizes. */
export function lzDirPrefix(kind: keyof typeof lzDirKinds, pid: number): string {
  return `${lzDirBase}${lzDirKinds[kind]}${pid}-`;
}

/**
 * Removes the directories in `dir` that runners of this user's processes that no longer run left behind; a shared
 * temporary directory holds other users' directories too. Stryker kills a worker whose run takes too long, and a
 * killed worker cannot remove its run directory or its compile cache. Stryker's own process removes the dry-run store
 * as it exits, so only a killed one leaves it. A directory that cannot be removed yet is left for a later runner.
 */
export function removeLeftDirs(
  dir: string,
  {
    running = isRunning,
    owned = isOwn,
    remove = (path: string) => {
      rmSync(path, { recursive: true });
    },
  } = {},
): void {
  for (const name of readdirSync(dir)) {
    const pid = lzDirPattern.exec(name)?.[1];
    const path = join(dir, name);

    if (pid !== undefined && !running(Number(pid))) {
      try {
        if (owned(path)) {
          remove(path);
        }
      } catch {
        // A process that the killed worker started may still work in it, or another runner removed it first.
      }
    }
  }
}
