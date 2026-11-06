import { cpSync, lstatSync, mkdtempSync, readlinkSync, statSync, symlinkSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { lzDirPrefix } from './dirs.ts';
import type { ProcessRecord } from './record.ts';

export function lzRebase(path: string, from: string, to: string): string {
  if (!path.startsWith(from + sep)) {
    return path;
  }

  return to + path.slice(from.length);
}

export function lzCopySandbox(sandbox: string, pid: number): string {
  const copy = mkdtempSync(join(dirname(sandbox), lzDirPrefix('copy', pid)));

  cpSync(sandbox, copy, {
    recursive: true,
    filter: (source) => {
      if (!lstatSync(source).isSymbolicLink()) {
        return true;
      }

      // A junction, as Stryker links node_modules, needs no symlink privilege on Windows, so a link whose target is
      // missing becomes one too; POSIX ignores the type.
      const isDirectory = statSync(source, { throwIfNoEntry: false })?.isDirectory() ?? true;
      symlinkSync(readlinkSync(source), lzRebase(source, sandbox, copy), isDirectory ? 'junction' : 'file');

      return false;
    },
  });

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
