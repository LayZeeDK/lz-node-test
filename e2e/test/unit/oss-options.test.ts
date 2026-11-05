import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { lzRemoveDeadRunDirs } from '../../src/fixture.ts';
import {
  lzNodeTestCommand,
  lzOssPreparedPrefix,
  lzOssRunPrefix,
  lzOssUsage,
  lzParseCommand,
  lzParseMergeOptions,
  lzParseOptions,
  lzStrykerArgs,
  lzStrykerConfig,
  lzStrykerOptions,
  type LzOssProject,
} from '../../src/oss/options.ts';
import { lzDecidingFields } from '../../src/oss/result.ts';

describe('run folder prefixes', () => {
  it("lets the dead-run sweep remove a dead run's folder and keep a dead prepared run's", (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'lz-oss-prefixes-'));
    const deadPid = spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;

    t.after(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    [lzOssRunPrefix, lzOssPreparedPrefix].forEach((prefix) => {
      mkdirSync(join(dir, `${prefix}${deadPid}-a`));
    });

    lzRemoveDeadRunDirs(dir, lzOssRunPrefix);

    assert.deepEqual(readdirSync(dir), [`${lzOssPreparedPrefix}${deadPid}-a`]);
  });
});

const required = ['--project', 'env-schema', '--source', 'D:/clone', '--out', 'D:/out', '--concurrency', '5'];

describe('lzParseOptions', () => {
  it('reads the options and looks the project up', () => {
    const options = lzParseOptions(required);

    assert.deepEqual(
      { ...options, project: options.project.name },
      {
        project: 'env-schema',
        source: 'D:/clone',
        out: 'D:/out',
        concurrency: 5,
        sides: ['lz', 'command'],
        mutate: [],
        tarballs: undefined,
        prepareOnly: false,
        timeLimitMinutes: 15,
        mutantTimeoutMs: undefined,
      },
    );
  });

  it("reads Stryker's extra time a mutant may take", () => {
    assert.equal(lzParseOptions([...required, '--mutant-timeout-ms', '60000']).mutantTimeoutMs, 60_000);
  });

  it('refuses an extra time of 0', () => {
    assert.throws(() => lzParseOptions([...required, '--mutant-timeout-ms', '0']), {
      message: /--mutant-timeout-ms is a positive integer\.$/,
    });
  });

  it('reads the tarball folder and --prepare-only', () => {
    const options = lzParseOptions([...required, '--tarballs', 'D:/tgz', '--prepare-only']);

    assert.deepEqual([options.tarballs, options.prepareOnly], ['D:/tgz', true]);
  });

  it('runs both sides without --side, and the named one with it', () => {
    assert.deepEqual(
      [lzParseOptions(required).sides, lzParseOptions([...required, '--side', 'command']).sides],
      [['lz', 'command'], ['command']],
    );
  });

  it('refuses a side it does not know', () => {
    assert.throws(() => lzParseOptions([...required, '--side', 'both']), {
      message: /--side is lz or command\.$/,
    });
  });

  it('reads each --mutate, and none without it', () => {
    assert.deepEqual(
      [
        lzParseOptions(required).mutate,
        lzParseOptions([...required, '--mutate', 'index.js:3:1-3:9', '--mutate', 'lib/a.js']).mutate,
      ],
      [[], ['index.js:3:1-3:9', 'lib/a.js']],
    );
  });

  it('refuses a --mutate pattern with a comma, which Stryker would split', () => {
    assert.throws(() => lzParseOptions([...required, '--mutate', 'lib/{a,b}.js']), {
      message: /--mutate takes one pattern without a comma; repeat it for more\.$/,
    });
  });

  it('reads the time limit of each side in minutes', () => {
    assert.equal(lzParseOptions([...required, '--time-limit-minutes', '40']).timeLimitMinutes, 40);
  });

  it('refuses a time limit of 0', () => {
    assert.throws(() => lzParseOptions([...required, '--time-limit-minutes', '0']), {
      message: /--time-limit-minutes is a positive integer\.$/,
    });
  });

  it('refuses a project it has no settings for, and names those it has', () => {
    assert.throws(() => lzParseOptions(required.with(1, 'pino')), {
      message:
        /--project is one of env-schema, fastify-cookie, fast-json-stringify, fastify, restartable, sonic-boom, pino-pretty\.$/,
    });
  });

  it("mutates pino-pretty's index.js and lib sources, and runs its test files but cli-rc, which fails on Windows", () => {
    const { project } = lzParseOptions(required.with(1, 'pino-pretty'));

    assert.deepEqual(project, {
      name: 'pino-pretty',
      mutate: ['index.js', 'lib/**/*.js', '!lib/**/*.test.js'],
      testFiles: [
        'lib/**/*.test.js',
        'test/basic.test.js',
        'test/boolean-options.test.js',
        'test/cli.test.js',
        'test/crlf.test.js',
        'test/error-objects.test.js',
      ],
      nodeTestFlags: ['--test-concurrency=1'],
      patches: [],
    });
    assert.equal(
      lzNodeTestCommand(project),
      'node --test --test-concurrency=1 "lib/**/*.test.js" "test/basic.test.js" "test/boolean-options.test.js" ' +
        '"test/cli.test.js" "test/crlf.test.js" "test/error-objects.test.js"',
    );
  });

  it("mutates restartable's two source files and runs its two test files", () => {
    const { project } = lzParseOptions(required.with(1, 'restartable'));

    assert.deepEqual(project, {
      name: 'restartable',
      mutate: ['index.js', 'lib/server.js'],
      testFiles: ['test/*.test.js'],
      nodeTestFlags: [],
      patches: [],
    });
  });

  it("mutates fast-json-stringify's sources, and runs its test files in one process with fixtures per process", () => {
    const { project } = lzParseOptions(required.with(1, 'fast-json-stringify'));

    assert.deepEqual(project, {
      name: 'fast-json-stringify',
      mutate: ['index.js', 'lib/**/*.js', '!lib/schema-validator.js'],
      testFiles: ['test/*.test.js'],
      nodeTestFlags: ['--experimental-test-isolation=none'],
      patches: [
        {
          file: 'test/standalone-mode.test.js',
          from: "const tmpDir = 'test/fixtures'",
          to:
            "const tmpDir = path.join('test/fixtures', `process-${process.pid}`); " +
            'fs.mkdirSync(tmpDir, { recursive: true })',
        },
      ],
    });
    assert.equal(lzNodeTestCommand(project), 'node --test --experimental-test-isolation=none "test/*.test.js"');
  });

  it("mutates sonic-boom's index.js, runs its test files one at a time with their own 240 s test timeout, and opens a path no mkdir can create", () => {
    const { project } = lzParseOptions(required.with(1, 'sonic-boom'));

    assert.deepEqual(project, {
      name: 'sonic-boom',
      mutate: ['index.js'],
      testFiles: ['test/*.test.js'],
      nodeTestFlags: ['--test-concurrency=1', '--test-timeout=240000'],
      patches: [{ file: 'test/sync.test.js', from: "dest: '/path/to/nowwhere'", to: 'dest: `${__filename}/nowwhere`' }],
    });
    assert.equal(lzNodeTestCommand(project), 'node --test --test-concurrency=1 --test-timeout=240000 "test/*.test.js"');
  });

  it('refuses a missing --out', () => {
    assert.throws(() => lzParseOptions(required.slice(0, 4).concat(required.slice(6))), {
      message: /--source and --out are required\.$/,
    });
  });

  it('refuses a concurrency of 0', () => {
    assert.throws(() => lzParseOptions(required.with(7, '0')), { message: /--concurrency is a positive integer/ });
  });

  it('prints the usage and exits 0 on --help', () => {
    const main = join(import.meta.dirname, '..', '..', 'src', 'oss', 'main.ts');
    const { status, stdout, stderr } = spawnSync(process.execPath, [main, '--help'], {
      encoding: 'utf8',
      windowsHide: true,
    });

    assert.deepEqual({ status, stderr }, { status: 0, stderr: '' });
    assert.match(stdout, /^Usage: node e2e\/src\/oss\/main\.ts --project <name> .*--help/);
  });

  it('names --side and --merge in the usage', () => {
    assert.match(lzOssUsage, /\[--side <lz\|command>\]/);
    assert.match(lzOssUsage, /--merge <result\.json> \[--merge <result\.json>\]\.\.\. --out <folder>/);
  });

  it('names --mutate in the usage, with the column to widen a range by on each side', () => {
    assert.match(lzOssUsage, /\[--mutate <pattern>\]\.\.\./);
    assert.match(lzOssUsage, /one column on each side/);
  });

  it('says in the usage that a merged result.json cannot be merged again', () => {
    assert.match(lzOssUsage, /merges do not compose/);
  });

  it('says in the usage that a merge refuses a side that wrote no report', () => {
    assert.match(lzOssUsage, /A side that wrote no\s+report is refused/);
  });

  it('names in the usage every header field the runs of a merge must share', () => {
    assert.deepEqual(
      lzDecidingFields.filter((field) => !lzOssUsage.includes(field)),
      [],
    );
  });

  it("says in the usage that a merge matches each side's Stryker configuration, not the workspace commit", () => {
    assert.match(lzOssUsage, /runs of one side whose strykerConfig differs[\s\S]+the workspace commit may\s+differ/);
  });

  it('says in the usage that a result.json given twice is refused', () => {
    assert.match(lzOssUsage, /A result\.json\s+given twice is refused/);
  });

  it('refuses an option it does not know', () => {
    assert.throws(() => lzParseOptions([...required, '--sides', 'lz']), { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' });
  });
});

describe('lzStrykerArgs', () => {
  it('passes nothing without --mutate, as the configuration selects the files', () => {
    assert.deepEqual(lzStrykerArgs({ mutate: [], mutantTimeoutMs: undefined }), []);
  });

  it('passes the patterns to stryker run as one comma-separated --mutate', () => {
    assert.deepEqual(lzStrykerArgs({ mutate: ['index.js:3:1-3:9', 'lib/a.js'], mutantTimeoutMs: undefined }), [
      '--mutate',
      'index.js:3:1-3:9,lib/a.js',
    ]);
  });

  it("passes the extra time to stryker run as --timeoutMS, which Stryker adds to each mutant's limit", () => {
    assert.deepEqual(lzStrykerArgs({ mutate: ['lib/a.js'], mutantTimeoutMs: 60_000 }), [
      '--mutate',
      'lib/a.js',
      '--timeoutMS',
      '60000',
    ]);
  });
});

describe('lzParseCommand', () => {
  it('asks for the usage on --help or -h, whatever else is given', () => {
    assert.deepEqual(
      [lzParseCommand(['--help']), lzParseCommand(['-h', '--merge', 'a']), lzParseCommand([...required, '--help'])],
      [{ kind: 'help' }, { kind: 'help' }, { kind: 'help' }],
    );
  });

  it('merges when --merge is given, in either form', () => {
    assert.deepEqual(
      [lzParseCommand(['--merge', 'a', '--out', 'o']), lzParseCommand(['--merge=a', '--out', 'o'])],
      [
        { kind: 'merge', options: { merge: ['a'], out: 'o' } },
        { kind: 'merge', options: { merge: ['a'], out: 'o' } },
      ],
    );
  });

  it('runs the driver otherwise', () => {
    const command = lzParseCommand(required);

    assert.equal(command.kind === 'run' ? command.options.project.name : command.kind, 'env-schema');
  });
});

describe('lzParseMergeOptions', () => {
  it('reads each --merge and --out', () => {
    assert.deepEqual(lzParseMergeOptions(['--merge', 'a/result.json', '--merge', 'b/result.json', '--out', 'D:/out']), {
      merge: ['a/result.json', 'b/result.json'],
      out: 'D:/out',
    });
  });

  it('refuses a missing --out', () => {
    assert.throws(() => lzParseMergeOptions(['--merge', 'a/result.json']), { message: /--out is required\.$/ });
  });

  it('refuses the options of a run, as a merge runs no Stryker', () => {
    assert.throws(() => lzParseMergeOptions(['--merge', 'a', '--out', 'o', '--side', 'lz']), {
      code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION',
    });
  });
});

const project: LzOssProject = {
  name: 'p',
  mutate: ['index.js'],
  testFiles: ['test/*.test.js'],
  nodeTestFlags: [],
  patches: [],
};

describe('lzNodeTestCommand', () => {
  it('names the test files after the flags, so node --test discovers nothing else', () => {
    assert.equal(
      lzNodeTestCommand({
        ...project,
        testFiles: ['a/*.test.js', 'b.test.mjs'],
        nodeTestFlags: ['--test-concurrency=1'],
      }),
      'node --test --test-concurrency=1 "a/*.test.js" "b.test.mjs"',
    );
  });
});

describe('lzStrykerOptions', () => {
  it('selects the runner of this workspace with the test files on the lz side', () => {
    assert.deepEqual(lzStrykerOptions('lz', project), {
      mutate: ['index.js'],
      plugins: ['@stryker-mutator/*', '@layzee/stryker-node-test-runner'],
      testRunner: 'lz-node-test',
      lzNodeTest: { testFiles: ['test/*.test.js'] },
    });
  });

  it("runs the project's command with coverage analysis off on the command side", () => {
    assert.deepEqual(lzStrykerOptions('command', project), {
      mutate: ['index.js'],
      testRunner: 'command',
      commandRunner: { command: 'node --test "test/*.test.js"' },
      coverageAnalysis: 'off',
    });
  });
});

describe('lzStrykerConfig', () => {
  it('imports the operators and exports the options on either side', () => {
    const config = lzStrykerConfig('command', project);

    assert.match(config, /^import '@layzee\/stryker-node-mutators';\n\nexport default \{\n/);
    assert.match(config, /"testRunner": "command"/);
  });
});
