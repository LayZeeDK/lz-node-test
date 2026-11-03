import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { lzRemoveDeadRunDirs } from '../../src/fixture.ts';
import {
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
      },
    );
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
      command:
        'node --test --test-concurrency=1 "lib/**/*.test.js" "test/basic.test.js" "test/boolean-options.test.js" ' +
        '"test/cli.test.js" ' +
        '"test/crlf.test.js" "test/error-objects.test.js"',
    });
  });

  it("mutates restartable's two source files and runs its two test files", () => {
    const { project } = lzParseOptions(required.with(1, 'restartable'));

    assert.deepEqual(project, {
      name: 'restartable',
      mutate: ['index.js', 'lib/server.js'],
      testFiles: ['test/*.test.js'],
      command: 'node --test',
    });
  });

  it("mutates fast-json-stringify's sources, and runs its test files one at a time", () => {
    const { project } = lzParseOptions(required.with(1, 'fast-json-stringify'));

    assert.deepEqual(project, {
      name: 'fast-json-stringify',
      mutate: ['index.js', 'lib/**/*.js', '!lib/schema-validator.js'],
      testFiles: ['test/*.test.js'],
      command: 'node --test --test-concurrency=1',
    });
  });

  it("mutates sonic-boom's index.js and runs its test files one at a time with their own 240 s test timeout", () => {
    const { project } = lzParseOptions(required.with(1, 'sonic-boom'));

    assert.deepEqual(project, {
      name: 'sonic-boom',
      mutate: ['index.js'],
      testFiles: ['test/*.test.js'],
      command: 'node --test --test-concurrency=1 --test-timeout=240000 "test/*.test.js"',
    });
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
    assert.match(lzOssUsage, /--merge <result\.json>\.\.\. --out <folder>/);
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

  it('says in the usage which header fields the runs of a merge must share', () => {
    assert.match(lzOssUsage, /project, workspaceCommit, node and\s+tarballs/);
  });

  it('says in the usage that a result.json given twice is refused', () => {
    assert.match(lzOssUsage, /A result\.json given\s+twice is refused/);
  });

  it('refuses an option it does not know', () => {
    assert.throws(() => lzParseOptions([...required, '--sides', 'lz']), { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' });
  });
});

describe('lzStrykerArgs', () => {
  it('passes nothing without --mutate, as the configuration selects the files', () => {
    assert.deepEqual(lzStrykerArgs([]), []);
  });

  it('passes the patterns to stryker run as one comma-separated --mutate', () => {
    assert.deepEqual(lzStrykerArgs(['index.js:3:1-3:9', 'lib/a.js']), ['--mutate', 'index.js:3:1-3:9,lib/a.js']);
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
  command: 'node --test',
};

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
      commandRunner: { command: 'node --test' },
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
