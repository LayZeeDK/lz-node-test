import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

describe('corpusDiff', () => {
  it("runs from the command line over the files it is given, with Stryker's instrumenter", (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'corpus-diff-'));
    t.after(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    const file = join(dir, 'sample.ts');
    writeFileSync(file, "f('x');\n");

    const output = execFileSync(
      process.execPath,
      ['--conditions=@layzee/source', join(import.meta.dirname, '..', '..', 'src', 'corpus-diff.ts'), file],
      {
        encoding: 'utf8',
        windowsHide: true,
      },
    );

    assert.match(
      output,
      /^### [^\n]*sample\.ts\n\n1 mutants without the operators, 1 with them\.\n\n {4}\(no difference\)\n\n$/,
    );
  });
});
