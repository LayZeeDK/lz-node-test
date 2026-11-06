import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { lzTestEach } from '@layzee/node-test-extensions';
import parser from '@typescript-eslint/parser';
import { ESLint, Linter } from 'eslint';
import { parse } from 'yaml';
import strykerDisableComment from './stryker-disable-comment.ts';
import { lzIsRecord } from './stryker-report.ts';

const workspaceRoot = join(import.meta.dirname, '..', '..');

// Each config's report name is the one the mutate-src and mutate-test-code targets read.
const configs: readonly (readonly [file: string, reportName: string, mutate: readonly string[]])[] = [
  [
    'packages/node-test-extensions/stryker.config.mjs',
    '@layzee/node-test-extensions.src',
    ['packages/node-test-extensions/src/**/*.ts'],
  ],
  [
    'packages/node-test-extensions/stryker.test-code.config.mjs',
    '@layzee/node-test-extensions.test-code',
    ['packages/node-test-extensions/test/**/*.test.ts'],
  ],
  [
    'packages/stryker-mutator-core/stryker.config.mjs',
    '@layzee/stryker-mutator-core.src',
    ['packages/stryker-mutator-core/src/**/*.ts'],
  ],
  [
    'packages/stryker-mutator-core/stryker.test-code.config.mjs',
    '@layzee/stryker-mutator-core.test-code',
    ['packages/stryker-mutator-core/test/**/*.test.ts'],
  ],
  [
    'packages/stryker-node-mutators/stryker.config.mjs',
    '@layzee/stryker-node-mutators.src',
    ['packages/stryker-node-mutators/src/**/*.ts', 'packages/stryker-node-mutators/test/synthetic/node-apis.ts'],
  ],
  [
    'packages/stryker-node-mutators/stryker.test-code.config.mjs',
    '@layzee/stryker-node-mutators.test-code',
    ['packages/stryker-node-mutators/test/**/*.test.ts'],
  ],
  [
    'packages/stryker-node-test-mutators/stryker.config.mjs',
    '@layzee/stryker-node-test-mutators.src',
    ['packages/stryker-node-test-mutators/src/**/*.ts'],
  ],
  [
    'packages/stryker-node-test-mutators/stryker.test-code.config.mjs',
    '@layzee/stryker-node-test-mutators.test-code',
    ['packages/stryker-node-test-mutators/test/**/*.test.ts'],
  ],
  [
    'packages/stryker-node-test-runner/stryker.config.mjs',
    '@layzee/stryker-node-test-runner.src',
    ['packages/stryker-node-test-runner/src/**/*.ts'],
  ],
  [
    'packages/stryker-node-test-runner/stryker.test-code.config.mjs',
    '@layzee/stryker-node-test-runner.test-code',
    ['packages/stryker-node-test-runner/test/**/*.test.ts'],
  ],
  [
    'tools/eslint-rules/stryker.config.mjs',
    '@layzee/eslint-rules.src',
    ['tools/eslint-rules/*.ts', '!tools/eslint-rules/*.test.ts'],
  ],
  [
    'tools/eslint-rules/stryker.test-code.config.mjs',
    '@layzee/eslint-rules.test-code',
    ['tools/eslint-rules/*.test.ts'],
  ],
];

const ignorePatterns = ['/.claude', '/.nx', '/.scratch', '/e2e', '/reports'];

const notWorkspaceConfigs = new Set(['node_modules', 'e2e/fixtures', '.scratch', '.claude', '.nx', 'dist', 'reports']);

interface MatrixRow {
  readonly project: string;
  readonly config: string;
  readonly shard: string | undefined;
  readonly mutate: readonly string[] | undefined;
  readonly mutated: readonly string[];
}

function readMatrix(): readonly MatrixRow[] {
  const workflow: unknown = parse(readFileSync(join(workspaceRoot, '.github/workflows/ci.yml'), 'utf8'));
  const jobs = lzIsRecord(workflow) ? workflow['jobs'] : undefined;
  const job = lzIsRecord(jobs) ? jobs['mutation'] : undefined;
  const strategy = lzIsRecord(job) ? job['strategy'] : undefined;
  const matrix = lzIsRecord(strategy) ? strategy['matrix'] : undefined;
  const include = lzIsRecord(matrix) ? matrix['include'] : undefined;
  assert.ok(Array.isArray(include), 'ci.yml has no mutation matrix include list');
  const rows = include.filter(isRawMatrixRow);
  assert.equal(rows.length, include.length, 'a mutation matrix row lacks a project, config or mutated string');

  return rows.map(({ project, config, shard, mutate, mutated }) => ({
    project,
    config,
    shard,
    mutate: mutate?.split(','),
    mutated: mutated.split('\n'),
  }));
}

function isRawMatrixRow(
  row: unknown,
): row is { project: string; config: string; shard?: string; mutate?: string; mutated: string } {
  return (
    lzIsRecord(row) &&
    typeof row['project'] === 'string' &&
    typeof row['config'] === 'string' &&
    typeof row['mutated'] === 'string' &&
    (row['shard'] === undefined || typeof row['shard'] === 'string') &&
    (row['mutate'] === undefined || typeof row['mutate'] === 'string')
  );
}

function matrixKey(file: string): string {
  const folder = dirname(file);
  const packageJson: unknown = JSON.parse(readFileSync(join(workspaceRoot, folder, 'package.json'), 'utf8'));
  const project = lzIsRecord(packageJson) ? packageJson['name'] : undefined;

  if (typeof project !== 'string') {
    throw new TypeError(`${folder}/package.json has no name`);
  }

  return `${project} ${basename(file) === 'stryker.config.mjs' ? 'src' : 'test-code'}`;
}

function expandGlobs(patterns: readonly string[]): string[] {
  const glob = (globs: readonly string[]): string[] =>
    globSync(globs, { cwd: workspaceRoot }).map((file) => file.replaceAll('\\', '/'));
  const excluded = new Set(
    glob(patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1))),
  );

  return glob(patterns.filter((pattern) => !pattern.startsWith('!'))).filter((file) => !excluded.has(file));
}

const configsByKey = new Map(configs.map((config) => [matrixKey(config[0]), config]));

const matrixRows = readMatrix();

async function loadConfig(file: string): Promise<Record<string, unknown>> {
  const module: unknown = await import(pathToFileURL(join(workspaceRoot, file)).href);
  const config = lzIsRecord(module) ? module['default'] : undefined;
  assert.ok(lzIsRecord(config), `${file} has no default export object`);

  return config;
}

describe('Stryker configs', () => {
  it('lists every Stryker config in the workspace', () => {
    const onDisk = globSync('**/stryker*.config.mjs', {
      cwd: workspaceRoot,
      exclude: (name) => notWorkspaceConfigs.has(name.replaceAll('\\', '/')),
    }).map((file) => file.replaceAll('\\', '/'));

    assert.deepEqual(onDisk.toSorted(), configs.map(([file]) => file).toSorted());
  });

  lzTestEach(configs.map(([file]) => file))('%s fails the run below a mutation score of 100', async (file) => {
    const config = await loadConfig(file);

    assert.deepEqual(config['thresholds'], { high: 100, low: 100, break: 100 });
  });

  lzTestEach(configs)('%s mutates only its listed files', async (file, _name, mutate) => {
    const config = await loadConfig(file);

    assert.deepEqual(
      { mutate: config['mutate'], ignorePatterns: config['ignorePatterns'] },
      { mutate, ignorePatterns },
    );
  });

  lzTestEach(configs)('%s writes its HTML and JSON reports as reports/mutation/%s', async (file, name) => {
    const config = await loadConfig(file);

    assert.deepEqual(
      { html: config['htmlReporter'], json: config['jsonReporter'] },
      { html: { fileName: `reports/mutation/${name}.html` }, json: { fileName: `reports/mutation/${name}.json` } },
    );
  });
});

describe('CI mutation matrix', () => {
  it('runs each Stryker config once, counting the shards of a config as one', () => {
    const runs = new Set(matrixRows.map(({ project, config }) => `${project} ${config}`));

    assert.deepEqual([...runs].toSorted(), [...configsByKey.keys()].toSorted());
    assert.equal(
      matrixRows.length,
      matrixRows.filter(({ shard }) => shard !== undefined).length +
        new Set(
          matrixRows.filter(({ shard }) => shard === undefined).map(({ project, config }) => `${project} ${config}`),
        ).size,
      'a config without shards has more than one row',
    );
  });

  lzTestEach(
    matrixRows.map((row): [string, MatrixRow] => [
      `${row.project}:mutate-${row.config} ${row.shard ?? ''}`.trimEnd(),
      row,
    ]),
  )('%s excludes the files its config mutates from the cache key', (_title, { project, config, mutated }) => {
    const mutate = configsByKey.get(`${project} ${config}`)?.[2] ?? [];

    assert.deepEqual(
      mutated,
      mutate.filter((pattern) => !pattern.startsWith('!')).map((pattern) => `!${pattern}`),
    );
  });

  lzTestEach(
    [...configsByKey].filter(([key]) => matrixRows.some((row) => `${row.project} ${row.config}` === key && row.shard)),
  )('the shards of %s mutate each file of its config once', (key, [, , mutate]) => {
    const sharded = matrixRows
      .filter((row) => `${row.project} ${row.config}` === key)
      .flatMap((row) => expandGlobs(row.mutate ?? []));

    assert.deepEqual(sharded.toSorted(), expandGlobs(mutate).toSorted());
  });
});

const eslint = new ESLint({ cwd: workspaceRoot });
const mutatedFiles = [...new Set(configs.flatMap(([, , mutate]) => expandGlobs(mutate)))];
const unlinted: string[] = [];

for (const file of mutatedFiles) {
  if (await eslint.isPathIgnored(join(workspaceRoot, file))) {
    unlinted.push(file);
  }
}

describe('Stryker disable comments in mutated files that ESLint ignores', () => {
  lzTestEach(unlinted)('%s passes stryker-disable-comment', (file) => {
    const messages = new Linter().verify(
      readFileSync(join(workspaceRoot, file), 'utf8'),
      {
        files: ['**/*.ts'],
        languageOptions: { parser },
        plugins: { lz: { rules: { 'stryker-disable-comment': strykerDisableComment } } },
        rules: { 'lz/stryker-disable-comment': 'error' },
      },
      file,
    );

    assert.deepEqual(
      messages.map(({ line, message }) => `${file}:${String(line)} ${message}`),
      [],
    );
  });
});
