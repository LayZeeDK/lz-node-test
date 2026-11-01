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
        JSON.stringify({
          project,
          sides: Object.fromEntries(Object.keys(mutantsBySide).map((side) => [side, { stryker: { reported: true } }])),
        }),
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

  it('merges batches of one side into one before it compares', (t) => {
    const { run, out } = setup(t);
    const batches = [
      run('lz-1', 'p', { lz: [{ line: 1, status: 'Killed' }] }),
      run('lz-2', 'p', { lz: [{ line: 2, status: 'Survived' }] }),
      run('command', 'p', {
        command: [
          { line: 1, status: 'Killed' },
          { line: 2, status: 'Killed' },
        ],
      }),
    ];

    lzMerge(batches, out);

    const result: unknown = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));

    assert.deepEqual(result, {
      project: 'p',
      mergedFrom: batches,
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

  it('refuses a mutant that two batches of one side hold, and names both', (t) => {
    const { run, out } = setup(t);
    const first = run('a', 'p', { lz: [{ line: 1, status: 'Killed' }] });
    const second = run('b', 'p', { lz: [{ line: 1, status: 'Survived' }] });

    assert.throws(() => lzMerge([first, second], out), {
      message: `The lz side of ${first} and ${second} both hold index.js:1:3-1:9 StringLiteral ""; batches must not overlap.`,
    });
  });

  it('refuses a result.json without a side, such as a prepared run', (t) => {
    const { run, out } = setup(t);
    const file = run('a', 'p', {});

    assert.throws(() => lzMerge([file], out), { message: `${file} holds no side's results.` });
  });

  it('refuses a merged result.json, as merges do not compose', (t) => {
    const { run, out } = setup(t);

    lzMerge([run('a', 'p', { lz: [] })], out);
    const merged = join(out, 'result.json');

    assert.throws(() => lzMerge([merged], join(out, 'again')), {
      message: `${merged} is the result of a merge; merges do not compose, so merge the runs it lists in mergedFrom.`,
    });
  });

  it('refuses a side that wrote no report, even with an older report beside its result.json', (t) => {
    const { run, out } = setup(t);
    const file = run('a', 'p', { lz: [{ line: 1, status: 'Killed' }] });

    writeFileSync(file, JSON.stringify({ project: 'p', sides: { lz: { stryker: { reported: false } } } }));

    assert.throws(() => lzMerge([file], out), {
      message: `The lz side of ${file} wrote no report, so its lz.mutation.json is not this run's.`,
    });
  });

  it('refuses a side whose Stryker run threw', (t) => {
    const { run, out } = setup(t);
    const file = run('a', 'p', { command: [] });

    writeFileSync(file, JSON.stringify({ project: 'p', sides: { command: { stryker: null } } }));

    assert.throws(() => lzMerge([file], out), {
      message: `The command side of ${file} wrote no report, so its command.mutation.json is not this run's.`,
    });
  });
});
