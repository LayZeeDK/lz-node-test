import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzMerge } from '../../src/oss/merge.ts';
import type { LzSide } from '../../src/oss/options.ts';

interface LzFakeMutant {
  readonly line: number;
  readonly status: string;
}

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'lz-oss-merge-'));

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  return {
    out: join(dir, 'merged'),
    /** Writes a run folder as the driver leaves it: result.json and a report per side that ran. */
    run: (name: string, project: string, mutantsBySide: Partial<Record<LzSide, readonly LzFakeMutant[]>>): string => {
      const runDir = join(dir, name);

      mkdirSync(runDir);
      Object.entries(mutantsBySide).forEach(([side, mutants]) => {
        const report = {
          files: {
            'index.js': {
              mutants: mutants.map(({ line, status }) => ({
                mutatorName: 'StringLiteral',
                replacement: '""',
                status,
                location: { start: { line, column: 3 }, end: { line, column: 9 } },
              })),
            },
          },
        };

        writeFileSync(join(runDir, `${side}.mutation.json`), JSON.stringify(report));
      });
      writeFileSync(
        join(runDir, 'result.json'),
        JSON.stringify({ project, sides: Object.fromEntries(Object.keys(mutantsBySide).map((side) => [side, {}])) }),
      );

      return join(runDir, 'result.json');
    },
  };
}

describe('lzMerge', () => {
  it('compares a run of the lz side with a run of the command side, and writes result.json', (t) => {
    const { run, out } = setup(t);
    const lz = run('lz', 'p', {
      lz: [
        { line: 1, status: 'Killed' },
        { line: 2, status: 'Survived' },
      ],
    });
    const command = run('command', 'p', {
      command: [
        { line: 1, status: 'Killed' },
        { line: 2, status: 'Killed' },
      ],
    });

    lzMerge([lz, command], out);

    const result: unknown = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));

    assert.deepEqual(result, {
      project: 'p',
      mergedFrom: [lz, command],
      scores: {
        lz: { counts: { Killed: 1, Survived: 1 }, score: 50, mutants: 2 },
        command: { counts: { Killed: 2 }, score: 100, mutants: 2 },
      },
      compared: true,
      disagreements: [{ mutant: 'index.js:2:3-2:9 StringLiteral ""', lz: 'Survived', command: 'Killed' }],
      verdicts: [
        { mutant: 'index.js:1:3-1:9 StringLiteral ""', lz: 'Killed', command: 'Killed' },
        { mutant: 'index.js:2:3-2:9 StringLiteral ""', lz: 'Survived', command: 'Killed' },
      ],
    });
  });

  it('compares nothing with only one side', (t) => {
    const { run, out } = setup(t);

    const lz = run('lz', 'p', { lz: [{ line: 1, status: 'Killed' }] });

    lzMerge([lz], out);

    const result: unknown = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));

    assert.deepEqual(result, {
      project: 'p',
      mergedFrom: [lz],
      scores: { lz: { counts: { Killed: 1 }, score: 100, mutants: 1 } },
      compared: false,
      reason: 'Only the lz side ran; merge its result.json with a command run with --merge.',
    });
  });

  it('refuses runs of two projects', (t) => {
    const { run, out } = setup(t);

    assert.throws(() => lzMerge([run('a', 'p', { lz: [] }), run('b', 'q', { command: [] })], out), {
      message: /^--merge takes runs of one project; found p and q\.$/,
    });
  });

  it('refuses two runs of one side', (t) => {
    const { run, out } = setup(t);

    assert.throws(() => lzMerge([run('a', 'p', { lz: [] }), run('b', 'p', { lz: [] })], out), {
      message: /^--merge takes one run of each side; 2 hold the lz side\.$/,
    });
  });

  it('refuses a result.json without a side, such as a prepared run', (t) => {
    const { run, out } = setup(t);
    const file = run('a', 'p', {});

    assert.throws(() => lzMerge([file], out), { message: `${file} holds no side's results.` });
  });

  it('refuses a run whose side wrote no report', (t) => {
    const { run, out } = setup(t);
    const file = run('a', 'p', { lz: [] });

    rmSync(join(file, '..', 'lz.mutation.json'));

    assert.throws(() => lzMerge([file], out), { message: /lz\.mutation\.json/ });
  });
});
