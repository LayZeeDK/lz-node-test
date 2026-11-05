import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import { lzMerge } from '../../src/oss/merge.ts';
import { lzSides, type LzSide } from '../../src/oss/options.ts';

interface LzFakeMutant {
  readonly line: number;
  readonly status: string;
}

/** The header fields a merge requires to match across its runs, and two it does not. */
const header = {
  workspaceCommit: 'abc123',
  sourceCommit: 'f00d',
  node: 'v24.18.1',
  platform: 'win32-arm64',
  mutantTimeoutMs: 30000,
  installedVersions: ['node_modules/a@1.0.0', 'node_modules/b@2.0.0'],
  tarballDigests: ['d1', 'd2'],
  projectSetup: { mutate: ['index.js'], testFiles: ['test/*.test.js'], patches: [] },
  tarballs: ['a-1.0.0.tgz', 'b-1.0.0.tgz'],
};

function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'lz-oss-merge-'));

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  return {
    out: join(dir, 'merged'),
    /** Writes a run folder as the driver leaves it: result.json and a report per side that ran. */
    run: (
      name: string,
      project: string,
      mutantsBySide: Partial<Record<LzSide, readonly LzFakeMutant[]>>,
      headerOverrides: Partial<Record<keyof typeof header, unknown>> = {},
      configs: Partial<Record<LzSide, string>> = {},
    ): string => {
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
          ...header,
          ...headerOverrides,
          sides: Object.fromEntries(
            lzSides
              .filter((side) => side in mutantsBySide)
              .map((side) => [side, { stryker: { reported: true }, strykerConfig: configs[side] ?? `${side} config` }]),
          ),
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

  it('merges runs of two workspace commits whose sides ran the same Stryker configuration', (t) => {
    const { run, out } = setup(t);
    const runs = [
      run('a', 'p', { lz: [{ line: 1, status: 'Killed' }] }),
      run('b', 'p', { lz: [{ line: 2, status: 'Killed' }] }, { workspaceCommit: 'def456' }),
    ];

    lzMerge(runs, out);

    const result: unknown = JSON.parse(readFileSync(join(out, 'result.json'), 'utf8'));

    assert.deepEqual(result, {
      project: 'p',
      mergedFrom: runs,
      scores: { lz: { counts: { Killed: 2 }, score: 100, mutants: 2 } },
      compared: false,
      reason: 'Only the lz side ran; merge its result.json with a command run with --merge.',
    });
  });

  it('refuses runs of one side with two Stryker configurations, and names both', (t) => {
    const { run, out } = setup(t);
    const first = run('a', 'p', { command: [] }, {}, { command: 'node --test --test-concurrency=1' });
    const second = run('b', 'p', { command: [] }, {}, { command: 'node --test --test-isolation=none' });

    assert.throws(() => lzMerge([first, second], out), {
      message: `--merge takes runs of one Stryker configuration per side; the command sides of ${first} and ${second} ran different ones.`,
    });
  });

  it('refuses a side that records no Stryker configuration', (t) => {
    const { run, out } = setup(t);
    const file = run('a', 'p', { lz: [] });

    writeFileSync(file, JSON.stringify({ project: 'p', ...header, sides: { lz: { stryker: { reported: true } } } }));

    assert.throws(() => lzMerge([file], out), {
      message: `The lz side of ${file} records no strykerConfig, so a merge cannot tell what it ran.`,
    });
  });

  it('refuses an lz run and a command run whose shared project setup differs, such as their patches', (t) => {
    const { run, out } = setup(t);
    const patched = { ...header.projectSetup, patches: [{ file: 'test/a.test.js', from: 'a', to: 'b' }] };
    const runs = [run('a', 'p', { lz: [] }), run('b', 'p', { command: [] }, { projectSetup: patched })];

    assert.throws(() => lzMerge(runs, out), {
      message: /^--merge takes runs of one projectSetup; found \{"mutate".+ and \{"mutate".+"from":"a".+\.$/,
    });
  });

  it('refuses runs whose tarballs differ in content under the same names', (t) => {
    const { run, out } = setup(t);
    const runs = [run('a', 'p', { lz: [] }), run('b', 'p', { command: [] }, { tarballDigests: ['d1', 'd3'] })];

    assert.throws(() => lzMerge(runs, out), {
      message: '--merge takes runs of one tarballDigests; some runs only have d2, d3.',
    });
  });

  it('refuses runs that installed different dependency versions, naming those not every run has', (t) => {
    const { run, out } = setup(t);
    const runs = [
      run('a', 'p', { lz: [] }),
      run(
        'b',
        'p',
        { command: [] },
        { installedVersions: ['node_modules/a@1.0.0', 'node_modules/b@2.1.0', 'node_modules/c@3.0.0'] },
      ),
    ];

    assert.throws(() => lzMerge(runs, out), {
      message:
        '--merge takes runs of one installedVersions; some runs only have ' +
        'node_modules/b@2.0.0, node_modules/b@2.1.0, node_modules/c@3.0.0.',
    });
  });

  it('refuses the result.json of an older driver, naming the field it lacks', (t) => {
    const { run, out } = setup(t);
    const file = run('a', 'p', { lz: [] });
    const older = Object.fromEntries(Object.entries(header).filter(([field]) => field !== 'installedVersions'));

    writeFileSync(file, JSON.stringify({ project: 'p', ...older, sides: { lz: { stryker: { reported: true } } } }));

    assert.throws(() => lzMerge([file], out), {
      message: `${file} is not the result.json of a driver run that a merge can read: it lacks installedVersions.`,
    });
  });

  it('refuses runs of two source commits', (t) => {
    const { run, out } = setup(t);
    const runs = [run('a', 'p', { lz: [] }), run('b', 'p', { command: [] }, { sourceCommit: 'beef' })];

    assert.throws(() => lzMerge(runs, out), {
      message: '--merge takes runs of one sourceCommit; found f00d and beef.',
    });
  });

  it('refuses runs of two platforms', (t) => {
    const { run, out } = setup(t);
    const runs = [run('a', 'p', { lz: [] }), run('b', 'p', { command: [] }, { platform: 'linux-arm64' })];

    assert.throws(() => lzMerge(runs, out), {
      message: '--merge takes runs of one platform; found win32-arm64 and linux-arm64.',
    });
  });

  it("refuses runs of two mutant timeouts, Stryker's default among them", (t) => {
    const { run, out } = setup(t);
    const runs = [run('a', 'p', { lz: [] }), run('b', 'p', { command: [] }, { mutantTimeoutMs: null })];

    assert.throws(() => lzMerge(runs, out), {
      message: '--merge takes runs of one mutantTimeoutMs; found 30000 and null.',
    });
  });

  it('refuses a field written as a string in one run and a number in another', (t) => {
    const { run, out } = setup(t);
    const runs = [run('a', 'p', { lz: [] }), run('b', 'p', { command: [] }, { mutantTimeoutMs: '30000' })];

    assert.throws(() => lzMerge(runs, out), { message: /^--merge takes runs of one mutantTimeoutMs; / });
  });

  it('refuses runs of two Node.js versions', (t) => {
    const { run, out } = setup(t);
    const runs = [run('a', 'p', { lz: [] }), run('b', 'p', { command: [] }, { node: 'v22.23.1' })];

    assert.throws(() => lzMerge(runs, out), {
      message: '--merge takes runs of one node; found v24.18.1 and v22.23.1.',
    });
  });

  it('refuses a result.json given twice, however its path is spelt', (t) => {
    const { run, out } = setup(t);
    const file = run('a', 'p', { lz: [{ line: 1, status: 'Killed' }] });
    const respelt = [dirname(file), '.', 'result.json'].join(sep);

    assert.throws(() => lzMerge([file, respelt], out), {
      message: `--merge got ${file} more than once; give each result.json once.`,
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

    writeFileSync(file, JSON.stringify({ project: 'p', ...header, sides: { lz: { stryker: { reported: false } } } }));

    assert.throws(() => lzMerge([file], out), {
      message: `The lz side of ${file} wrote no report, so its lz.mutation.json is not this run's.`,
    });
  });

  it('refuses a side whose report file is missing, naming the side and the file', (t) => {
    const { run, out } = setup(t);
    const file = run('a', 'p', { lz: [{ line: 1, status: 'Killed' }] });

    rmSync(join(dirname(file), 'lz.mutation.json'));

    assert.throws(() => lzMerge([file], out), {
      message: `The lz side of ${file} has no lz.mutation.json beside it.`,
    });
  });

  it('refuses a side whose Stryker run threw', (t) => {
    const { run, out } = setup(t);
    const file = run('a', 'p', { command: [] });

    writeFileSync(file, JSON.stringify({ project: 'p', ...header, sides: { command: { stryker: null } } }));

    assert.throws(() => lzMerge([file], out), {
      message: `The command side of ${file} wrote no report, so its command.mutation.json is not this run's.`,
    });
  });
});
