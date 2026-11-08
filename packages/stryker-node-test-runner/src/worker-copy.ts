import { cpSync, lstatSync, mkdtempSync, readlinkSync, rmSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Logger } from '@stryker-mutator/api/logging';

import { lzDirPrefix, removeDir } from './dirs.ts';
import type { ProcessRecord } from './record.ts';

/** Moves every path under `from` in `text` to `to`; a test's name can hold the folder its process works in. */
export function lzRebase(text: string, from: string, to: string): string {
  return text.split(from).reduce((rebased, rest) => rebased + (/^[\w.-]/.test(rest) ? from : to) + rest);
}

/** The copy's folder and every link made in it, which a removal takes apart before the folder (see `lzRemoveCopy`). */
export interface LzSandboxCopy {
  readonly dir: string;
  readonly links: readonly string[];
}

export function lzCopySandbox(sandbox: string, pid: number): LzSandboxCopy {
  const copy = mkdtempSync(join(dirname(sandbox), lzDirPrefix('copy', pid)));
  const links: string[] = [];

  try {
    cpSync(sandbox, copy, {
      recursive: true,
      filter: (source) => {
        if (!lstatSync(source).isSymbolicLink()) {
          return true;
        }

        // A junction, as Stryker links node_modules, needs no symlink privilege on Windows, so a link whose target is
        // missing becomes one too; POSIX ignores the type.
        // Stryker disable next-line LogicalOperator,BooleanLiteral: Windows only, as POSIX ignores the link type; the Windows run kills it
        const isDirectory = statSync(source, { throwIfNoEntry: false })?.isDirectory() ?? true;
        const link = lzRebase(source, sandbox, copy);
        symlinkSync(readlinkSync(source), link, isDirectory ? 'junction' : 'file');
        links.push(link);

        return false;
      },
    });
  } catch (error) {
    rmSync(copy, { recursive: true });
    throw error;
  }

  return { dir: copy, links };
}

/**
 * Removes each link on its own first: the recursive removal of a folder can follow a junction when its own removal is
 * refused, and would then empty what the junction points at.
 */
export async function lzRemoveCopy(
  copy: LzSandboxCopy,
  log: Logger,
  {
    unlink = unlinkSync,
    remove = removeDir,
  }: { unlink?: (link: string) => void; remove?: (dir: string, log: Logger) => Promise<void> } = {},
): Promise<void> {
  try {
    copy.links.forEach((link) => {
      unlink(link);
    });
  } catch (error) {
    log.warn(
      `Left ${copy.dir} for a later runner to remove: ${error instanceof Error ? error.message : String(error)}`,
    );

    return;
  }

  await remove(copy.dir, log);
}

export function lzRebaseRecord(record: ProcessRecord, from: string, to: string): ProcessRecord {
  const rebaseKeys = <T>(byTest: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(byTest).map(([id, value]) => [lzRebase(id, from, to), value]));
  const { mutantCoverage, testSpans } = record;

  return {
    ...record,
    tests: record.tests.map((test) => ({ ...test, id: lzRebase(test.id, from, to) })),
    ...(mutantCoverage && { mutantCoverage: { ...mutantCoverage, perTest: rebaseKeys(mutantCoverage.perTest) } }),
    ...(testSpans && { testSpans: rebaseKeys(testSpans) }),
  };
}
