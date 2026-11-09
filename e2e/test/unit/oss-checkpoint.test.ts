import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';

import type { MutantResult } from '@stryker-mutator/api/core';
import { PluginKind } from '@stryker-mutator/api/plugin';
import { DryRunStatus, TestStatus, type TestResult } from '@stryker-mutator/api/test-runner';

import {
  lzCheckpointArgs,
  lzCheckpointKey,
  type LzCheckpointKeyInputs,
  lzCheckpointMutants,
  lzCheckpointReport,
  LzCheckpointReporter,
  lzCheckpointReporterName,
  lzEndCheckpoint,
  lzInstalledVersions,
  lzStartCheckpoint,
  strykerPlugins,
} from '../../src/oss/checkpoint.ts';

const root = join(tmpdir(), 'project');

function mutant(file: string, id: string, overrides: Partial<MutantResult> = {}): MutantResult {
  return {
    id,
    fileName: join(root, file),
    mutatorName: 'BooleanLiteral',
    replacement: 'false',
    location: { start: { line: 2, column: 5 }, end: { line: 2, column: 9 } },
    status: 'Killed',
    killedBy: ['t1'],
    coveredBy: ['t1'],
    ...overrides,
  };
}

function testResult(id: string, fileName: string | undefined): TestResult {
  return {
    id,
    name: `test ${id}`,
    timeSpentMs: 1,
    status: TestStatus.Success,
    ...(fileName === undefined ? {} : { fileName: join(root, fileName), startPosition: { line: 3, column: 0 } }),
  };
}

function sources(file: string): string {
  return `source of ${file.slice(root.length + 1).replaceAll('\\', '/')}`;
}

describe('lzCheckpointReport', () => {
  it('groups the tested mutants by their file relative to the root, with its source and no fileName', () => {
    const report = lzCheckpointReport(
      [mutant('lib/a.js', '1'), mutant('index.js', '2'), mutant('lib/a.js', '3', { status: 'Survived' })],
      [],
      root,
      sources,
    );

    const { 'lib/a.js': lib, 'index.js': index } = report.files;

    assert.ok(lib);
    assert.deepEqual(Object.keys(report.files), ['lib/a.js', 'index.js']);
    assert.equal(lib.source, 'source of lib/a.js');
    assert.equal(lib.language, 'javascript');
    assert.deepEqual(
      lib.mutants.map(({ id, status }) => `${id} ${status}`),
      ['1 Killed', '3 Survived'],
    );
    assert.equal('fileName' in (index?.mutants[0] ?? {}), false);
  });

  it("lists the dry run's tests by file with 1-based start positions, and tests without a file under ''", () => {
    const report = lzCheckpointReport(
      [],
      [testResult('t1', 'test/a.test.js'), testResult('t2', undefined)],
      root,
      sources,
    );

    assert.deepEqual(report.testFiles, {
      'test/a.test.js': {
        source: 'source of test/a.test.js',
        tests: [{ id: 't1', name: 'test t1', location: { start: { line: 4, column: 1 } } }],
      },
      '': { tests: [{ id: 't2', name: 'test t2' }] },
    });
  });

  it("leaves out a test file's source it cannot read, and gives a mutated file it cannot read an empty one, as Stryker does", () => {
    const report = lzCheckpointReport(
      [mutant('index.js', '1')],
      [testResult('t1', 'test/a.test.js')],
      root,
      () => undefined,
    );

    assert.equal(report.files['index.js']?.source, '');
    assert.deepEqual(report.testFiles?.['test/a.test.js'], {
      tests: [{ id: 't1', name: 'test t1', location: { start: { line: 4, column: 1 } } }],
    });
  });

  it('marks each TypeScript extension as typescript and any other file as javascript', () => {
    const files = ['a.ts', 'a.tsx', 'a.mts', 'a.cts', 'a.mjs'];
    const report = lzCheckpointReport(
      files.map((file, index) => mutant(file, String(index))),
      [],
      root,
      sources,
    );

    assert.deepEqual(
      files.map((file) => report.files[file]?.language),
      ['typescript', 'typescript', 'typescript', 'typescript', 'javascript'],
    );
  });

  it("is a report of schema version 1.0 with Stryker's default thresholds, which Stryker reads", () => {
    const { schemaVersion, thresholds } = lzCheckpointReport([], [], root, sources);

    assert.deepEqual({ schemaVersion, thresholds }, { schemaVersion: '1.0', thresholds: { high: 80, low: 60 } });
  });
});

describe('strykerPlugins', () => {
  it('declares the reporter under the name lz-checkpoint, which the driver passes in --reporters', () => {
    assert.deepEqual(
      strykerPlugins.map(({ kind, name, injectableClass }) => ({ kind, name, injectableClass })),
      [{ kind: PluginKind.Reporter, name: 'lz-checkpoint', injectableClass: LzCheckpointReporter }],
    );
    assert.equal(lzCheckpointReporterName, 'lz-checkpoint');
  });
});

function setup(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'lz-oss-checkpoint-'));

  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  return dir;
}

function dryRun(reporter: LzCheckpointReporter): void {
  reporter.onDryRunCompleted({
    result: { status: DryRunStatus.Complete, tests: [testResult('t1', 'test/a.test.js')] },
    timing: { net: 0, overhead: 0 },
    capabilities: { reloadEnvironment: true },
  });
}

describe('LzCheckpointReporter', () => {
  it("writes the tested mutants to Stryker's incrementalFile once the interval has passed since its last write", (t) => {
    const file = join(setup(t), 'lz.checkpoint.json');
    let now = 0;
    const reporter = new LzCheckpointReporter(
      { incrementalFile: file },
      { cwd: root, now: () => now, readSource: sources },
      5_000,
    );

    dryRun(reporter);
    reporter.onMutantTested(mutant('index.js', '1'));
    assert.throws(() => readFileSync(file), { code: 'ENOENT' });

    now = 5_000;
    reporter.onMutantTested(mutant('index.js', '2'));
    assert.equal(lzCheckpointMutants(file), 2);

    now = 9_999;
    reporter.onMutantTested(mutant('index.js', '3'));
    assert.equal(lzCheckpointMutants(file), 2);

    now = 10_000;
    reporter.onMutantTested(mutant('index.js', '4'));
    assert.equal(lzCheckpointMutants(file), 4);
    assert.match(readFileSync(file, 'utf8'), /"test\/a\.test\.js"/);
  });

  it('replaces the file whole through a temporary file beside it, which it leaves no trace of', (t) => {
    const dir = setup(t);
    const file = join(dir, 'lz.checkpoint.json');

    writeFileSync(file, 'earlier');
    const reporter = new LzCheckpointReporter(
      { incrementalFile: file },
      { cwd: root, now: () => 0, readSource: sources },
      0,
    );

    reporter.onMutantTested(mutant('index.js', '1'));

    assert.equal(lzCheckpointMutants(file), 1);
    assert.deepEqual(readdirSync(dir), ['lz.checkpoint.json']);
  });

  it("by default reads each mutated file's source from disk, and writes an empty one for a file it cannot read", (t) => {
    const dir = setup(t);
    const file = join(dir, 'lz.checkpoint.json');
    const source = join(dir, 'index.js');

    writeFileSync(source, 'export const a = 1;\n');
    const reporter = new LzCheckpointReporter({ incrementalFile: file }, undefined, 0);

    reporter.onMutantTested(mutant('index.js', '1', { fileName: source }));
    reporter.onMutantTested(mutant('index.js', '2', { fileName: join(dir, 'gone.js') }));

    const written = readFileSync(file, 'utf8');

    assert.match(written, /\/index\.js":\{"language":"javascript","source":"export const a = 1;\\n"/);
    assert.match(written, /\/gone\.js":\{"language":"javascript","source":""/);
  });
});

describe('lzStartCheckpoint', () => {
  function checkpoint(dir: string): string {
    const file = join(dir, 'lz.checkpoint.json');

    writeFileSync(file, JSON.stringify(lzCheckpointReport([mutant('a.js', '1')], [], root, sources)));

    return file;
  }

  it('keeps a checkpoint written under the same key, and returns how many mutants it holds', (t) => {
    const file = checkpoint(setup(t));

    writeFileSync(`${file}.key`, 'key A');

    assert.equal(lzStartCheckpoint(file, 'key A'), 1);
    assert.equal(lzCheckpointMutants(file), 1);
  });

  it('removes a checkpoint written under another key, and records the new key', (t) => {
    const file = checkpoint(setup(t));

    writeFileSync(`${file}.key`, 'key A');

    assert.equal(lzStartCheckpoint(file, 'key B'), 0);
    assert.equal(existsSync(file), false);
    assert.equal(readFileSync(`${file}.key`, 'utf8'), 'key B');
  });

  it('removes a checkpoint that has no key beside it', (t) => {
    const file = checkpoint(setup(t));

    assert.equal(lzStartCheckpoint(file, 'key A'), 0);
    assert.equal(readFileSync(`${file}.key`, 'utf8'), 'key A');
  });

  it('says it discarded a checkpoint written under another key, and says nothing when there was none', (t) => {
    const dir = setup(t);
    const file = checkpoint(dir);
    const write = t.mock.method(process.stdout, 'write', () => true);

    lzStartCheckpoint(file, 'key A');
    lzStartCheckpoint(join(dir, 'none.json'), 'key A');
    write.mock.restore();

    assert.deepEqual(
      write.mock.calls.map(({ arguments: [text] }) => text),
      [`Discarded ${file}: it was written by a run with other options, tarballs or project.\n`],
    );
  });

  it('starts afresh when neither a checkpoint nor its key exists', (t) => {
    const file = join(setup(t), 'lz.checkpoint.json');

    assert.equal(lzStartCheckpoint(file, 'key A'), 0);
    assert.equal(readFileSync(`${file}.key`, 'utf8'), 'key A');
  });
});

describe('lzEndCheckpoint', () => {
  it('removes the checkpoint, its key and a write cut short, so a later run of the part starts afresh', (t) => {
    const dir = setup(t);
    const file = join(dir, 'lz.checkpoint.json');

    writeFileSync(file, '{}');
    writeFileSync(`${file}.key`, 'key A');
    writeFileSync(`${file}.tmp`, '{"fi');
    writeFileSync(join(dir, 'lz.mutation.json'), '{}');

    lzEndCheckpoint(file);

    assert.deepEqual(readdirSync(dir), ['lz.mutation.json']);
  });

  it('does nothing when there is nothing to remove', (t) => {
    const dir = setup(t);

    lzEndCheckpoint(join(dir, 'lz.checkpoint.json'));

    assert.deepEqual(readdirSync(dir), []);
  });
});

describe('lzCheckpointArgs', () => {
  it("has Stryker read and write the checkpoint as its incremental file, and load this module's reporter", () => {
    const [incremental, fileFlag, file, pluginsFlag, plugin] = lzCheckpointArgs('out/lz.checkpoint.json');

    assert.deepEqual(
      [incremental, fileFlag, file, pluginsFlag],
      ['--incremental', '--incrementalFile', 'out/lz.checkpoint.json', '--appendPlugins'],
    );
    assert.match(plugin ?? '', /checkpoint\.ts$/);
  });
});

describe('lzCheckpointMutants', () => {
  it('counts the mutants of every file', (t) => {
    const file = join(setup(t), 'lz.checkpoint.json');

    writeFileSync(
      file,
      JSON.stringify(lzCheckpointReport([mutant('a.js', '1'), mutant('b.js', '2')], [], root, sources)),
    );
    assert.equal(lzCheckpointMutants(file), 2);
  });

  it('throws for a file that holds no report', (t) => {
    const file = join(setup(t), 'lz.checkpoint.json');

    writeFileSync(file, '{"files": 3}');

    assert.throws(() => lzCheckpointMutants(file), /not a mutation report/);
  });
});

describe('lzInstalledVersions', () => {
  it("lists each installed package's path and version, sorted, whatever the order npm wrote them in", () => {
    const lockfile = JSON.stringify({
      name: 'p',
      packages: { 'node_modules/b': { version: '2.0.0' }, 'node_modules/a': { version: '1.0.0', dev: true } },
    });

    assert.deepEqual(lzInstalledVersions(lockfile), ['node_modules/a@1.0.0', 'node_modules/b@2.0.0']);
  });

  it('lists a package with no version, such as the root, with an empty one', () => {
    const lockfile = JSON.stringify({ packages: { '': { name: 'p' }, 'node_modules/a': true } });

    assert.deepEqual(lzInstalledVersions(lockfile), ['@', 'node_modules/a@']);
  });

  it('refuses a file that lists no packages', () => {
    assert.throws(() => lzInstalledVersions('{"name": "p"}'), /lists no "packages"/);
  });
});

describe('lzCheckpointKey', () => {
  const inputs: LzCheckpointKeyInputs = {
    project: 'p',
    sourceCommit: 'c1',
    node: 'v22.23.1',
    platform: 'win32-arm64',
    mutantTimeoutMs: 30_000,
    installedVersions: ['node_modules/a@1.0.0'],
    tarballDigests: ['a', 'b'],
    projectSetup: { mutate: ['index.js'], testFiles: ['test/*.js'], patches: [] },
    mutate: ['index.js:1-10'],
    strykerConfig: 'export default {};\n',
  };

  it('differs when any input differs', () => {
    const changed: readonly LzCheckpointKeyInputs[] = [
      { ...inputs, project: 'q' },
      { ...inputs, sourceCommit: 'c2' },
      { ...inputs, node: 'v24.18.1' },
      { ...inputs, platform: 'linux-arm64' },
      { ...inputs, mutantTimeoutMs: null },
      { ...inputs, installedVersions: ['node_modules/a@1.1.0'] },
      { ...inputs, tarballDigests: ['a', 'c'] },
      { ...inputs, projectSetup: { ...inputs.projectSetup, patches: [{ file: 'a.js', from: 'a', to: 'b' }] } },
      { ...inputs, mutate: ['index.js:1-11'] },
      { ...inputs, strykerConfig: 'export default { a: 1 };\n' },
    ];

    assert.deepEqual(
      changed.map((other) => lzCheckpointKey(other) === lzCheckpointKey(inputs)),
      changed.map(() => false),
    );
  });
});
