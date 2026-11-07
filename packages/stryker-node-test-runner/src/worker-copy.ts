import { cpSync, lstatSync, mkdtempSync, readlinkSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { lzDirPrefix } from './dirs.ts';
import type { ProcessRecord } from './record.ts';

/** Moves every path under `from` in `text` to `to`; a test's name can hold the folder its process works in. */
export function lzRebase(text: string, from: string, to: string): string {
  return text.split(from).reduce((rebased, rest) => rebased + (/^[\w.-]/.test(rest) ? from : to) + rest);
}

export function lzCopySandbox(sandbox: string, pid: number): string {
  const copy = mkdtempSync(join(dirname(sandbox), lzDirPrefix('copy', pid)));

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
        symlinkSync(readlinkSync(source), lzRebase(source, sandbox, copy), isDirectory ? 'junction' : 'file');

        return false;
      },
    });
  } catch (error) {
    rmSync(copy, { recursive: true });
    throw error;
  }

  return copy;
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
