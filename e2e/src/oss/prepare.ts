import { globSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LzOssPatch } from './options.ts';

/** Makes each patch in the project's copy, refusing one whose `from` is not in its file exactly once. */
export function lzApplyPatches(dir: string, patches: readonly LzOssPatch[]): void {
  patches.forEach(({ file, from, to }) => {
    const path = join(dir, file);
    const text = readFileSync(path, 'utf8');
    const count = text.split(from).length - 1;

    if (count !== 1) {
      throw new Error(`The patch of ${file} expects ${JSON.stringify(from)} once and found it ${count} times.`);
    }

    writeFileSync(
      path,
      text.replace(from, () => to),
    );
  });
}

const fileWrite =
  /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|mkdir|mkdirSync|copyFile|copyFileSync|rename|renameSync|rm|rmSync|unlink|unlinkSync)\s*\(/g;

/**
 * The test files that call a file-writing `fs` function, each with the calls it makes. Stryker's workers share one
 * sandbox, so such a test can collide with itself in another worker when it writes a fixed path; this flags the file
 * for a look, it cannot tell a fixed path from a unique one. `patched` names the files a patch already deals with.
 */
export function lzFileWriters(
  dir: string,
  testFiles: readonly string[],
  patched: readonly string[],
): ReadonlyMap<string, readonly string[]> {
  const files = [...new Set(testFiles.flatMap((pattern) => globSync(pattern, { cwd: dir })))]
    .map((file) => file.replaceAll('\\', '/'))
    .filter((file) => !patched.includes(file))
    .sort();

  return new Map(
    files.flatMap((file): [string, string[]][] => {
      const calls = [...new Set(readFileSync(join(dir, file), 'utf8').match(fileWrite) ?? [])].map((call) =>
        call.replace(/\s*\($/, ''),
      );

      return calls.length === 0 ? [] : [[file, calls.sort()]];
    }),
  );
}
