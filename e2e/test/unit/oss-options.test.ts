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
  lzParseOptions,
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
        'node --test "lib/**/*.test.js" "test/basic.test.js" "test/boolean-options.test.js" "test/cli.test.js" ' +
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

  it("mutates sonic-boom's index.js and runs its test files with their own 240 s test timeout", () => {
    const { project } = lzParseOptions(required.with(1, 'sonic-boom'));

    assert.deepEqual(project, {
      name: 'sonic-boom',
      mutate: ['index.js'],
      testFiles: ['test/*.test.js'],
      command: 'node --test --test-timeout=240000 "test/*.test.js"',
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

  it('refuses an option it does not know', () => {
    assert.throws(() => lzParseOptions([...required, '--sides', 'lz']), { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' });
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
      plugins: ['@stryker-mutator/*', '@layzee/lz-stryker-node-test-runner'],
      testRunner: 'lz-stryker-node-test',
      lzStrykerNodeTest: { testFiles: ['test/*.test.js'] },
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

    assert.match(config, /^import '@layzee\/lz-stryker-node-test-mutators';\n\nexport default \{\n/);
    assert.match(config, /"testRunner": "command"/);
  });
});
