import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import {
  lzConcurrency,
  lzConsumerEnv,
  lzInstall,
  lzLeftover,
  lzMutant,
  lzMutants,
  lzNpmCli,
  lzPack,
  lzPackedFile,
  lzPinned,
  lzRemoveDeadRunDirs,
  lzStryker,
  lzStrykerCommand,
  lzStrykerTimeoutMs,
  type LzStrykerRun,
} from '../../src/fixture.ts';
import { lzIsRecord, type LzMutantDetail } from '../../src/report.ts';

const fixtureUrl = new URL('../../src/fixture.ts', import.meta.url).href;
const workspaceDir = join(import.meta.dirname, '..', '..', '..');
const packagesDir = join(workspaceDir, 'packages');
const srcDir = join(import.meta.dirname, '..', '..', 'src');
const strykerBinDir = join('node_modules', '@stryker-mutator', 'core', 'bin');

// Stands in for Stryker: leaves twelve entries of mixed case in its temporary folder, which neither NTFS (case-insensitive
// order) nor a Linux file system (hash order) lists in sort() order, writes an empty report when asked, and prints what
// it was started with.
const fakeStryker = `
const { mkdirSync, readdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
for (const name of ['a', 'B', 'c', 'D', 'e', 'F', 'g', 'H', 'i', 'J', 'k', 'L', '\\uFF61', '\\u{1F600}']) {
  writeFileSync(join(process.env.TMPDIR, name), '');
}
if (args.includes('--report')) {
  mkdirSync(join('reports', 'mutation'), { recursive: true });
  writeFileSync(join('reports', 'mutation', 'mutation.json'), '{"files":{}}');
}
process.stdout.write(JSON.stringify({ args, cwd: process.cwd(), tmp: process.env.TMPDIR, files: readdirSync('.').sort() }));
`;

// Stands in for npm: logs its arguments, fails on a "fail" argument, packs to "<package folder name>.tgz", and installs
// the fake Stryker.
const fakeNpm = `
const { appendFileSync, copyFileSync, mkdirSync } = require('node:fs');
const { basename, join } = require('node:path');
const args = process.argv.slice(2);
if (process.env.LZ_FAKE_NPM_LOG !== undefined) {
  appendFileSync(process.env.LZ_FAKE_NPM_LOG, JSON.stringify(args) + '\\n');
}
if (args.includes('fail')) {
  process.stdout.write('out\\n');
  process.stderr.write('err\\n');
  process.exit(3);
}
if (args[0] === 'pack') {
  process.stdout.write(JSON.stringify([{ filename: basename(args.at(-1)) + '.tgz' }]));
}
if (args[0] === 'install') {
  const bin = join(args[args.indexOf('--prefix') + 1], ${JSON.stringify(strykerBinDir)});
  mkdirSync(bin, { recursive: true });
  copyFileSync(join(__dirname, 'stryker.js'), join(bin, 'stryker.js'));
}
`;

function tempDir(t: TestContext, prefix: string): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  return dir;
}

function setEnv(t: TestContext, name: string, value: string): void {
  const old = process.env[name];

  process.env[name] = value;
  t.after(() => {
    if (old === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = old;
    }
  });
}

/** A folder holding the fake npm and Stryker, with `npm_execpath` pointing at it. */
function fakeNpmDir(t: TestContext): string {
  const dir = tempDir(t, 'lz-fake-npm-');

  writeFileSync(join(dir, 'npm-cli.js'), fakeNpm);
  writeFileSync(join(dir, 'stryker.js'), fakeStryker);

  return dir;
}

/** Points this process's npm at the fake one, and returns a reader of the argument lists it was run with. */
function useFakeNpm(t: TestContext): () => unknown[] {
  const dir = fakeNpmDir(t);
  const logFile = join(dir, 'log.jsonl');

  setEnv(t, 'npm_execpath', join(dir, 'npx-cli.js'));
  setEnv(t, 'LZ_FAKE_NPM_LOG', logFile);

  return () =>
    existsSync(logFile)
      ? readFileSync(logFile, 'utf8')
          .trim()
          .split('\n')
          .map((line): unknown => JSON.parse(line))
      : [];
}

function workspacePins(): string[] {
  return lzPinned(JSON.parse(readFileSync(join(workspaceDir, 'package.json'), 'utf8')));
}

describe('lzConsumerEnv', () => {
  it("drops the test runner's variables, puts this Node.js first on the PATH as Windows spells it, and sets the temporary folder", () => {
    const env = lzConsumerEnv('t', { KEEP: 'z', Path: 'a', NODE_OPTIONS: 'x', NODE_TEST_CONTEXT: 'y' });

    assert.deepEqual(env, {
      KEEP: 'z',
      Path: `${dirname(process.execPath)}${delimiter}a`,
      TMPDIR: 't',
      TEMP: 't',
      TMP: 't',
    });
  });

  it('starts a PATH when there is none', () => {
    assert.deepEqual(lzConsumerEnv('t', {}), {
      PATH: `${dirname(process.execPath)}${delimiter}`,
      TMPDIR: 't',
      TEMP: 't',
      TMP: 't',
    });
  });
});

describe('lzConcurrency', () => {
  it('reads a positive integer', () => {
    assert.equal(lzConcurrency({ LZ_E2E_CONCURRENCY: '2' }), 2);
  });

  it('reads a positive integer of more than one digit', () => {
    assert.equal(lzConcurrency({ LZ_E2E_CONCURRENCY: '10' }), 10);
  });

  it('refuses an unset value and names the variable', () => {
    assert.throws(() => lzConcurrency({}), {
      message: /^Set LZ_E2E_CONCURRENCY to a positive integer.*It is unset\.$/,
    });
  });

  ['0', '01', '2x'].forEach((value) => {
    it(`refuses "${value}"`, () => {
      assert.throws(() => lzConcurrency({ LZ_E2E_CONCURRENCY: value }), {
        message: new RegExp(`It is "${value}"\\.$`),
      });
    });
  });
});

describe('lzStrykerCommand', () => {
  it("runs the consumer's installed Stryker, reports in clear text and JSON, with the extra arguments last", () => {
    assert.deepEqual(lzStrykerCommand('s.mjs', 3, ['--mutate', 'a.js'], []), [
      join(strykerBinDir, 'stryker.js'),
      'run',
      's.mjs',
      '--concurrency',
      '3',
      '--reporters',
      'clear-text,json',
      '--mutate',
      'a.js',
    ]);
  });

  it('adds further reporters to the one --reporters, as a second one would replace the first', () => {
    assert.equal(
      lzStrykerCommand('s.mjs', 3, [], ['progress-append-only', 'lz-checkpoint'])[6],
      'clear-text,json,progress-append-only,lz-checkpoint',
    );
  });
});

/** A consumer folder with the fake Stryker installed and an empty `tmp`. */
function consumerDir(t: TestContext): string {
  const dir = tempDir(t, 'lz-stryker-');

  mkdirSync(join(dir, strykerBinDir), { recursive: true });
  writeFileSync(join(dir, strykerBinDir, 'stryker.js'), fakeStryker);
  mkdirSync(join(dir, 'tmp'));

  return dir;
}

describe('lzStryker', () => {
  it('runs Stryker in the folder with its own temporary folder, and lists only the new entries of it, sorted', async (t) => {
    const dir = consumerDir(t);

    writeFileSync(join(dir, 'tmp', 'old'), '');

    const run = await lzStryker(dir, 's.mjs', 2);
    const output: unknown = JSON.parse(run.output);

    assert.deepEqual(
      { ...run, output },
      {
        exitCode: 0,
        output: {
          args: ['run', 's.mjs', '--concurrency', '2', '--reporters', 'clear-text,json'],
          cwd: dir,
          tmp: join(dir, 'tmp'),
          files: ['node_modules', 'tmp'],
        },
        leftover: ['B', 'D', 'F', 'H', 'J', 'L', 'a', 'c', 'e', 'g', 'i', 'k', '\u{1F600}', '｡'],
        timedOut: false,
        reported: false,
      },
    );
  });

  it('reads the report the run writes', async (t) => {
    const run = await lzStryker(consumerDir(t), 's.mjs', 2, { args: ['--report'] });

    assert.deepEqual(run.reported ? run.report : 'no report', new Map());
  });

  it('adds the progress reporter to a run followed through a log file, before further reporters', async (t) => {
    const dir = consumerDir(t);
    const logFile = join(dir, 'run.log');

    const run = await lzStryker(dir, 's.mjs', 2, { logFile, reporters: ['r'] });

    assert.equal(readFileSync(logFile, 'utf8'), run.output);
    assert.match(run.output, /"--reporters","clear-text,json,progress-append-only,r"\]/);
  });
});

function mutant(line: number, replacement: string): LzMutantDetail {
  return {
    line,
    column: 1,
    endLine: line,
    endColumn: 5,
    mutator: 'StringLiteral',
    replacement,
    status: 'Killed',
    static: false,
    statusReason: '',
    killedBy: [],
    coveredBy: [],
  };
}

function reported(files: Readonly<Record<string, readonly LzMutantDetail[]>>): LzStrykerRun {
  return {
    exitCode: 0,
    output: '',
    leftover: [],
    timedOut: false,
    reported: true,
    report: new Map(Object.entries(files)),
  };
}

function unreported(timedOut: boolean): LzStrykerRun {
  return { exitCode: 1, output: 'Error during import', leftover: [], timedOut, reported: false };
}

describe('lzMutants', () => {
  it('lists the mutants of a file of the report', () => {
    const run = reported({ 'src/a.ts': [mutant(1, '""')] });

    assert.deepEqual(lzMutants(run, 'src/a.ts'), ['1:1 StringLiteral "" Killed']);
  });

  it('refuses a file the report does not have, and names the files it has', () => {
    const run = reported({ 'src/a.ts': [], 'src/b.ts': [] });

    assert.throws(() => lzMutants(run, 'src/c.ts'), {
      message: 'The report has no file "src/c.ts"; it has src/a.ts, src/b.ts.',
    });
  });

  it("refuses a run with no report, and shows Stryker's exit code and output", () => {
    assert.throws(() => lzMutants(unreported(false), 'src/a.ts'), {
      message: 'Stryker wrote no report (exit code 1):\nError during import',
    });
  });

  it('refuses a run that wrote its report and then failed, and shows the exit code and output', () => {
    const run = { ...reported({ 'src/a.ts': [mutant(1, '""')] }), exitCode: 1, output: 'dispose failed' };

    assert.throws(() => lzMutants(run, 'src/a.ts'), {
      message: 'Stryker wrote a report, then failed (exit code 1):\ndispose failed',
    });
  });

  it('refuses a run with no report, and says when it timed out after its 15 minutes', () => {
    assert.equal(lzStrykerTimeoutMs, 15 * 60_000);
    assert.throws(() => lzMutants(unreported(true), 'src/a.ts'), {
      message: 'Stryker wrote no report (exit code 1, ended after 15 minutes):\nError during import',
    });
  });
});

describe('lzLeftover', () => {
  it("replaces the pid in each leftover's name", () => {
    const run = { ...unreported(false), leftover: ['lz-node-test-e2e-1234-abc', 'x-56-y-7-'] };

    assert.deepEqual(lzLeftover(run), ['lz-node-test-e2e-<pid>-abc', 'x-<pid>-y-7-']);
  });
});

describe('lzMutant', () => {
  const run = reported({
    'src/a.ts': [mutant(1, '""'), mutant(2, '""'), mutant(2, '""')],
    'src/b.ts': [mutant(1, '"x"')],
  });

  it('finds the one mutant at a place with a replacement', () => {
    assert.deepEqual(lzMutant(run, { at: 'src/b.ts:1:1', replacement: '"x"' }), mutant(1, '"x"'));
  });

  it('refuses a place with no mutant of the replacement', () => {
    assert.throws(() => lzMutant(run, { at: 'src/b.ts:1:1', replacement: '""' }), {
      message: 'Expected one mutant at src/b.ts:1:1 with replacement """", found 0.',
    });
  });

  it('refuses a place with more than one mutant of the replacement', () => {
    assert.throws(() => lzMutant(run, { at: 'src/a.ts:2:1', replacement: '""' }), {
      message: 'Expected one mutant at src/a.ts:2:1 with replacement """", found 2.',
    });
  });

  it('refuses a run with no report', () => {
    assert.throws(() => lzMutant(unreported(false), { at: 'src/a.ts:1:1', replacement: '""' }), {
      message: 'Stryker wrote no report (exit code 1):\nError during import',
    });
  });
});

describe('lzPackedFile', () => {
  it('reads the file name from the array npm 11 prints', () => {
    assert.equal(lzPackedFile('[{"filename":"a-1.0.0.tgz"}]'), 'a-1.0.0.tgz');
  });

  it('reads the file name from the object npm 12 prints', () => {
    assert.equal(lzPackedFile('{"@x/a":{"filename":"x-a-1.0.0.tgz"}}'), 'x-a-1.0.0.tgz');
  });

  it("refuses output with no file name, and shows npm's output", () => {
    assert.throws(() => lzPackedFile('[{}]'), { message: 'npm pack --json printed no filename:\n[{}]' });
  });
});

describe('lzPinned', () => {
  it('pins Stryker, its TypeScript checker, TypeScript and the Node.js types at the versions the manifest names', () => {
    const devDependencies = {
      '@stryker-mutator/core': '1',
      '@stryker-mutator/typescript-checker': '2',
      typescript: '3',
      '@types/node': '4',
    };

    assert.deepEqual(lzPinned({ devDependencies }), [
      '@stryker-mutator/core@1',
      '@stryker-mutator/typescript-checker@2',
      'typescript@3',
      '@types/node@4',
    ]);
  });

  it('refuses a manifest that pins one of them nowhere, and names it', () => {
    assert.throws(() => lzPinned({ devDependencies: { '@stryker-mutator/core': '1' } }), {
      message: 'The workspace package.json pins no @stryker-mutator/typescript-checker in devDependencies.',
    });
  });
});

describe('lzNpmCli', () => {
  function withFile(dir: string, ...path: string[]): string {
    const file = join(dir, ...path);

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '');

    return file;
  }

  it('takes the npm that started this process', (t) => {
    const dir = tempDir(t, 'lz-npm-cli-');
    const file = withFile(dir, 'npm-cli.js');

    assert.equal(lzNpmCli({ npm_execpath: join(dir, 'npx-cli.js') }, join(dir, 'node')), file);
  });

  it('takes the npm beside Node.js in the Windows layout', (t) => {
    const dir = tempDir(t, 'lz-npm-cli-');
    const file = withFile(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');

    assert.equal(lzNpmCli({}, join(dir, 'node.exe')), file);
  });

  it('takes the npm beside Node.js in the POSIX layout', (t) => {
    const dir = tempDir(t, 'lz-npm-cli-');
    const file = withFile(dir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

    assert.equal(lzNpmCli({}, join(dir, 'bin', 'node')), file);
  });

  it('refuses when there is no npm, and names where it looked', (t) => {
    const dir = tempDir(t, 'lz-npm-cli-');
    const windows = join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const posix = join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

    assert.throws(() => lzNpmCli({}, join(dir, 'node')), {
      message: `Found no npm-cli.js; looked at ${windows}, ${posix}.`,
    });
  });
});

describe('lzPack', () => {
  it('packs each workspace package into the folder it creates, and returns the tarballs', async (t) => {
    const npmRuns = useFakeNpm(t);
    const into = join(tempDir(t, 'lz-pack-'), 'tarballs');
    const names = readdirSync(packagesDir);

    const tarballs = await lzPack(into);

    assert.deepEqual(
      tarballs,
      names.map((name) => join(into, `${name}.tgz`)),
    );
    assert.deepEqual(
      npmRuns(),
      names.map((name) => ['pack', '--json', '--pack-destination', into, join(packagesDir, name)]),
    );
    assert.ok(existsSync(into));
  });
});

describe('lzInstall', () => {
  it('installs the tarballs and the pinned packages exactly, as of a date', async (t) => {
    const npmRuns = useFakeNpm(t);
    const dir = tempDir(t, 'lz-install-');

    await lzInstall(dir, ['a.tgz'], '2026-01-01');

    assert.deepEqual(npmRuns(), [
      [
        'install',
        '--save-dev',
        '--save-exact',
        '--prefix',
        dir,
        '--no-audit',
        '--no-fund',
        '--before',
        '2026-01-01',
        'a.tgz',
        ...workspacePins(),
      ],
    ]);
  });

  it('installs as of now without a date', async (t) => {
    const npmRuns = useFakeNpm(t);
    const dir = tempDir(t, 'lz-install-');

    await lzInstall(dir, ['a.tgz']);

    assert.deepEqual(npmRuns(), [
      [
        'install',
        '--save-dev',
        '--save-exact',
        '--prefix',
        dir,
        '--no-audit',
        '--no-fund',
        'a.tgz',
        ...workspacePins(),
      ],
    ]);
  });

  it("refuses a failed npm run, and shows npm's command, exit code and output", async (t) => {
    useFakeNpm(t);
    const dir = tempDir(t, 'lz-install-');
    const command = ['install', '--save-dev', '--save-exact', '--prefix', dir, '--no-audit', '--no-fund', 'fail'];

    await assert.rejects(lzInstall(dir, ['fail']), {
      message: `npm ${[...command, ...workspacePins()].join(' ')} ended with exit code 3:\nout\nerr\n`,
    });
  });
});

describe('lzFixture', () => {
  it("copies the fixture into a run folder of this pid, installs into it, runs Stryker there, and removes dead runs' folders and its own at exit", (t) => {
    const tmp = tempDir(t, 'lz-fixture-');
    const deadPid = spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;
    const deadDir = join(tmp, `lz-node-test-e2e-${deadPid}-a`);

    mkdirSync(deadDir);

    // The fixtures stay out of the mutation sandbox, so the run copies this project's src folder instead.
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { lzFixture } = await import(${JSON.stringify(fixtureUrl)});
        const fixture = await lzFixture('../src');
        process.stdout.write((await fixture.stryker()).output);`,
      ],
      {
        encoding: 'utf8',
        windowsHide: true,
        env: {
          ...process.env,
          npm_execpath: join(fakeNpmDir(t), 'npx-cli.js'),
          LZ_E2E_CONCURRENCY: '2',
          TMPDIR: tmp,
          TEMP: tmp,
          TMP: tmp,
        },
      },
    );
    const saw: unknown = JSON.parse(child.stdout);

    assert.ok(lzIsRecord(saw), child.stdout + child.stderr);
    assert.equal(typeof saw['cwd'], 'string');
    const cwd = String(saw['cwd']);

    assert.deepEqual(saw, {
      args: ['run', 'stryker.config.mjs', '--concurrency', '2', '--reporters', 'clear-text,json'],
      cwd,
      tmp: join(cwd, 'tmp'),
      files: [...readdirSync(srcDir), 'node_modules', 'tarballs', 'tmp'].sort(),
    });
    assert.equal(dirname(cwd), tmp);
    assert.match(basename(cwd), new RegExp(`^lz-node-test-e2e-${child.pid}-`));
    assert.deepEqual(readdirSync(tmp), []);
  });
});

describe('lzRemoveOnExit', () => {
  // A process that ends by itself, rather than through process.exit(), runs the exit listener before the mutation test
  // runner records what the process covered.
  function exitAfterRemoveOnExit(dir: string, ending: 'process.exit(0);' | 'by itself' = 'by itself'): string {
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { lzRemoveOnExit } = await import(${JSON.stringify(fixtureUrl)});
        lzRemoveOnExit(${JSON.stringify(dir)});
        ${ending === 'by itself' ? '' : ending}`,
      ],
      { encoding: 'utf8', windowsHide: true },
    );

    return child.stderr;
  }

  it('removes the folder and its content when the process exits', (t) => {
    const dir = tempDir(t, 'lz-remove-on-exit-');

    writeFileSync(join(dir, 'a'), '');

    assert.deepEqual(
      { stderr: exitAfterRemoveOnExit(dir, 'process.exit(0);'), exists: existsSync(dir) },
      { stderr: '', exists: false },
    );
  });

  it('says nothing when the folder is already gone', (t) => {
    assert.equal(exitAfterRemoveOnExit(join(tempDir(t, 'lz-remove-on-exit-'), 'gone')), '');
  });

  it('reports a folder it cannot remove', () => {
    assert.match(exitAfterRemoveOnExit('a\0b'), /^Left behind a\0b: The argument 'path' .+\n$/);
  });
});

describe('lzRemoveDeadRunDirs', () => {
  it("removes the prefix's folders of a dead pid, and keeps a live pid's and another prefix's", (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'lz-remove-dead-'));
    const deadPid = spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;

    t.after(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    ['p-', 'q-'].forEach((prefix) => {
      mkdirSync(join(dir, `${prefix}${deadPid}-a`));
    });
    mkdirSync(join(dir, `p-${process.pid}-a`));

    lzRemoveDeadRunDirs(dir, 'p-');

    assert.deepEqual(readdirSync(dir).sort(), [`p-${process.pid}-a`, `q-${deadPid}-a`]);
  });

  it('keeps the folder of a pid it cannot ask about', (t) => {
    const dir = tempDir(t, 'lz-remove-dead-');
    const name = 'p-99999999999999999999-a';

    mkdirSync(join(dir, name));

    lzRemoveDeadRunDirs(dir, 'p-');

    assert.deepEqual(readdirSync(dir), [name]);
  });
});
