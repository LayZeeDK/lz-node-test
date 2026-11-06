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

  it('names the folders as earlier runs did, so the sweep still finds theirs', () => {
    assert.deepEqual([lzOssRunPrefix, lzOssPreparedPrefix], ['lz-oss-driver-', 'lz-oss-prepared-']);
  });
});

const required = [
  '--project',
  'env-schema',
  '--source',
  'D:/clone',
  '--out',
  'D:/out',
  '--concurrency',
  '5',
  '--npm-before',
  '2026-11-04',
];

describe('lzParseOptions', () => {
  it('refuses a run without --npm-before', () => {
    assert.throws(() => lzParseOptions(required.slice(0, -2)), {
      message:
        /--npm-before is required: npm installs the newest versions published before it, so runs that share it install one tree\.$/,
    });
  });

  for (const value of ['yesterday', '11/04', '2026-02-30', '2026-11-04T12:00']) {
    it(`refuses ${value} as --npm-before: no date, no day of its month, or a time without a zone`, () => {
      assert.throws(() => lzParseOptions([...required.slice(0, -2), '--npm-before', value]), {
        message: /--npm-before is a date such as 2026-11-04 or a UTC time such as 2026-11-04T12:00:00Z\.$/,
      });
    });
  }

  it('refuses an --npm-before in the future', () => {
    assert.throws(() => lzParseOptions([...required.slice(0, -2), '--npm-before', '2999-01-01']), {
      message: /--npm-before must be in the past: a later date installs whatever is newest when the run starts\.$/,
    });
  });

  it('refuses an --npm-before with anything before its year, such as the six-digit year -000001', () => {
    assert.throws(() => lzParseOptions([...required.slice(0, -2), '--npm-before=-000001-01-01']), {
      message: /--npm-before is a date such as 2026-11-04 or a UTC time such as 2026-11-04T12:00:00Z\.$/,
    });
  });

  it('accepts an --npm-before of exactly now', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-04T00:00:00Z') });

    assert.equal(lzParseOptions(required).npmBefore, '2026-11-04T00:00:00.000Z');
  });

  it('reads an --npm-before UTC time', () => {
    const { npmBefore } = lzParseOptions([...required.slice(0, -2), '--npm-before', '2026-11-04T12:30:00Z']);

    assert.equal(npmBefore, '2026-11-04T12:30:00.000Z');
  });

  it('reads an --npm-before UTC time with milliseconds', () => {
    const { npmBefore } = lzParseOptions([...required.slice(0, -2), '--npm-before', '2026-11-04T12:30:00.123Z']);

    assert.equal(npmBefore, '2026-11-04T12:30:00.123Z');
  });

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
        npmBefore: '2026-11-04T00:00:00.000Z',
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
        /--project is one of env-schema, fastify-cookie, fast-json-stringify, fastify, restartable, sonic-boom, pino-pretty, borp, execa\.$/,
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

  for (const value of ['0', '05', '5x']) {
    it(`refuses a concurrency of ${value}`, () => {
      assert.throws(() => lzParseOptions(required.with(7, value)), { message: /--concurrency is a positive integer/ });
    });
  }

  it('refuses a positional argument', () => {
    assert.throws(() => lzParseOptions([...required, 'extra']), { code: 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL' });
  });

  const plainProjects: readonly (readonly [string, Omit<LzOssProject, 'name'>])[] = [
    ['env-schema', { mutate: ['index.js'], testFiles: ['test/**/*.test.js'], nodeTestFlags: [], patches: [] }],
    [
      'fastify-cookie',
      { mutate: ['index.js', 'signer.js'], testFiles: ['test/**/*.test.js'], nodeTestFlags: [], patches: [] },
    ],
    [
      'fastify',
      {
        mutate: ['fastify.js', 'lib/**/*.js', '!lib/error-serializer.js', '!lib/config-validator.js'],
        testFiles: ['test/**/*.test.js', 'test/**/*.test.mjs'],
        nodeTestFlags: [],
        patches: [],
      },
    ],
    ['borp', { mutate: ['borp.js', 'lib/**/*.js'], testFiles: ['test/*.test.js'], nodeTestFlags: [], patches: [] }],
  ];

  for (const [name, settings] of plainProjects) {
    it(`mutates ${name}'s sources and runs its test files with no flags or patches`, () => {
      assert.deepEqual(lzParseOptions(required.with(1, name)).project, { name, ...settings });
    });
  }

  it("mutates execa's sources, runs its test files but those that fail on Windows one at a time, with a 240 s test timeout", () => {
    const { project } = lzParseOptions(required.with(1, 'execa'));

    assert.deepEqual(project, {
      name: 'execa',
      mutate: ['index.js', 'lib/**/*.js'],
      testFiles: [
        'test/convert/*.js',
        'test/io/*.js',
        'test/ipc/*.js',
        'test/pipe/*.js',
        'test/resolve/*.js',
        'test/return/*.js',
        'test/stdio/*.js',
        'test/terminate/*.js',
        'test/transform/*.js',
        'test/arguments/command-resolution.js',
        'test/arguments/cwd.js',
        'test/arguments/env.js',
        'test/arguments/escape-no-icu.js',
        'test/arguments/escape.js',
        'test/arguments/fd-options.js',
        'test/arguments/local.js',
        'test/arguments/prototype-pollution.js',
        'test/arguments/shell.js',
        'test/arguments/specific.js',
        'test/methods/bind.js',
        'test/methods/command.js',
        'test/methods/create.js',
        'test/methods/main-async.js',
        'test/methods/override-promise.js',
        'test/methods/parameters-args.js',
        'test/methods/parameters-command.js',
        'test/methods/parameters-options.js',
        'test/methods/promise.js',
        'test/methods/script.js',
        'test/methods/template.js',
      ],
      nodeTestFlags: ['--test-concurrency=1', '--test-timeout=240000'],
      patches: [],
    });
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

  it('explains --npm-before, --side, --mutate, the checkpoint and --merge in the usage', () => {
    const lines = [
      '\n  --npm-before\n',
      'passed to npm install as --before: the copy gets the newest versions published before that past',
      'date or UTC time, which must come after the workspace pins of Stryker, TypeScript and @types/node',
      'were published. Give every part of one merge, and every Node.js version compared, the same one:',
      "otherwise npm 11 follows a project's own min-release-age as the clock moves, and npm 10 ignores it.",
      '--side    runs that side only and compares nothing; without it both sides run and are compared.',
      "--mutate  replaces the project's mutate set for this run; passed to stryker run as --mutate.",
      'file.js:12:4-12:20 for a mutant at 12:5-12:19.',
      'A side that ends before its report, such as at --time-limit-minutes, leaves <side>.checkpoint.json in --out',
      'with the mutants it tested, and <side>.checkpoint.json.key naming what it ran with.',
      "with the same fields a merge matches (below), --mutate and the side's Stryker configuration tests only the",
      'rest; any other rerun discards the checkpoint and says so. A clone with uncommitted changes is not told apart',
      '\n  from its commit.\n',
      "--merge   compares the sides of earlier runs from their result.json, each read with its sides' reports beside",
      'it. Batches of one side merge into one; a mutant in two batches is refused.',
      'installedVersions, tarballDigests and projectSetup are refused, naming the field and, for a list, the',
    ];

    assert.deepEqual(
      lines.filter((line) => !lzOssUsage.includes(line)),
      [],
    );
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

  it('reads no runs without --merge', () => {
    assert.deepEqual(lzParseMergeOptions(['--out', 'D:/out']), { merge: [], out: 'D:/out' });
  });

  it('refuses a missing --out', () => {
    assert.throws(() => lzParseMergeOptions(['--merge', 'a/result.json']), { message: /--out is required\.$/ });
  });

  it('refuses a positional argument', () => {
    assert.throws(() => lzParseMergeOptions(['a/result.json', '--out', 'o']), {
      code: 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL',
    });
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
  it('installs the operators and exports the options on either side', () => {
    const config = lzStrykerConfig('command', project);

    assert.match(
      config,
      /^import \{ lzNodeMutators \} from '@layzee\/stryker-node-mutators';\n\nawait lzNodeMutators\(\);\n\nexport default \{\n/,
    );
    assert.match(config, /"testRunner": "command"/);
  });
});
