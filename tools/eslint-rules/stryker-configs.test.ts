import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { lzTestEach } from '@layzee/node-test-extensions';
import parser from '@typescript-eslint/parser';
import { ESLint, Linter } from 'eslint';
import { parse } from 'yaml';
import strykerDisableComment from './stryker-disable-comment.ts';
import { lzIsRecord } from './stryker-report.ts';

const workspaceRoot = join(import.meta.dirname, '..', '..');

interface StrykerConfigRow {
  readonly file: string;
  readonly project: string;
  readonly config: 'src' | 'test-code';
  readonly mutate: readonly string[];
}

const configs: readonly StrykerConfigRow[] = [
  {
    file: 'packages/node-test-extensions/stryker.config.mjs',
    project: '@layzee/node-test-extensions',
    config: 'src',
    mutate: ['packages/node-test-extensions/src/**/*.ts'],
  },
  {
    file: 'packages/node-test-extensions/stryker.test-code.config.mjs',
    project: '@layzee/node-test-extensions',
    config: 'test-code',
    mutate: ['packages/node-test-extensions/test/**/*.test.ts'],
  },
  {
    file: 'packages/stryker-mutator-core/stryker.config.mjs',
    project: '@layzee/stryker-mutator-core',
    config: 'src',
    mutate: ['packages/stryker-mutator-core/src/**/*.ts'],
  },
  {
    file: 'packages/stryker-mutator-core/stryker.test-code.config.mjs',
    project: '@layzee/stryker-mutator-core',
    config: 'test-code',
    mutate: ['packages/stryker-mutator-core/test/**/*.test.ts'],
  },
  {
    file: 'packages/stryker-node-mutators/stryker.config.mjs',
    project: '@layzee/stryker-node-mutators',
    config: 'src',
    mutate: [
      'packages/stryker-node-mutators/src/**/*.ts',
      'packages/stryker-node-mutators/test/synthetic/node-apis.ts',
    ],
  },
  {
    file: 'packages/stryker-node-mutators/stryker.test-code.config.mjs',
    project: '@layzee/stryker-node-mutators',
    config: 'test-code',
    mutate: ['packages/stryker-node-mutators/test/**/*.test.ts'],
  },
  {
    file: 'packages/stryker-node-test-mutators/stryker.config.mjs',
    project: '@layzee/stryker-node-test-mutators',
    config: 'src',
    mutate: ['packages/stryker-node-test-mutators/src/**/*.ts'],
  },
  {
    file: 'packages/stryker-node-test-mutators/stryker.test-code.config.mjs',
    project: '@layzee/stryker-node-test-mutators',
    config: 'test-code',
    mutate: ['packages/stryker-node-test-mutators/test/**/*.test.ts'],
  },
  {
    file: 'packages/stryker-node-test-runner/stryker.config.mjs',
    project: '@layzee/stryker-node-test-runner',
    config: 'src',
    mutate: ['packages/stryker-node-test-runner/src/**/*.ts'],
  },
  {
    file: 'packages/stryker-node-test-runner/stryker.test-code.config.mjs',
    project: '@layzee/stryker-node-test-runner',
    config: 'test-code',
    mutate: ['packages/stryker-node-test-runner/test/**/*.test.ts'],
  },
  { file: 'e2e/stryker.config.mjs', project: 'e2e', config: 'src', mutate: ['e2e/src/**/*.ts'] },
  {
    file: 'e2e/stryker.test-code.config.mjs',
    project: 'e2e',
    config: 'test-code',
    mutate: ['e2e/test/unit/*.test.ts'],
  },
  {
    file: 'tools/eslint-rules/stryker.config.mjs',
    project: '@layzee/eslint-rules',
    config: 'src',
    mutate: ['tools/eslint-rules/*.ts', '!tools/eslint-rules/*.test.ts'],
  },
  {
    file: 'tools/eslint-rules/stryker.test-code.config.mjs',
    project: '@layzee/eslint-rules',
    config: 'test-code',
    mutate: ['tools/eslint-rules/*.test.ts'],
  },
];

function runKey({ project, config }: { readonly project: string; readonly config: string }): string {
  return `${project}:mutate-${config}`;
}

// The packages' runs never read e2e/; the e2e runs mutate it, and these tests load its Stryker configs.
const ignorePatterns = (file: string): string[] => [
  '/.claude',
  '/.nx',
  '/.scratch',
  file.startsWith('packages/') ? '/e2e' : '/e2e/fixtures',
  '/reports',
];

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

function expandGlobs(patterns: readonly string[]): string[] {
  const glob = (globs: readonly string[]): string[] =>
    globSync(globs, { cwd: workspaceRoot }).map((file) => file.replaceAll('\\', '/'));
  const excluded = new Set(
    glob(patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1))),
  );

  return glob(patterns.filter((pattern) => !pattern.startsWith('!'))).filter((file) => !excluded.has(file));
}

const matrixRows = readMatrix();
const matrixRuns = Map.groupBy(matrixRows, runKey);

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

    assert.deepEqual(onDisk.toSorted(), configs.map(({ file }) => file).toSorted());
  });

  lzTestEach(configs.map(({ file }) => file))('%s fails the run below a mutation score of 100', async (file) => {
    const config = await loadConfig(file);

    assert.deepEqual(config['thresholds'], { high: 100, low: 100, break: 100 });
  });

  lzTestEach(configs.map((row): [string, StrykerConfigRow] => [row.file, row]))(
    '%s mutates only its listed files',
    async (file, { mutate }) => {
      const config = await loadConfig(file);

      assert.deepEqual(
        { mutate: config['mutate'], ignorePatterns: config['ignorePatterns'] },
        { mutate, ignorePatterns: ignorePatterns(file) },
      );
    },
  );

  lzTestEach(configs.map(({ file, project, config }): [string, string] => [file, `${project}.${config}`]))(
    '%s writes its HTML and JSON reports as reports/mutation/%s',
    async (file, reportName) => {
      const config = await loadConfig(file);

      assert.deepEqual(
        { html: config['htmlReporter'], json: config['jsonReporter'] },
        {
          html: { fileName: `reports/mutation/${reportName}.html` },
          json: { fileName: `reports/mutation/${reportName}.json` },
        },
      );
    },
  );
});

describe('CI mutation matrix', () => {
  it('runs each Stryker config once, counting the shards of a config as one', () => {
    assert.deepEqual([...matrixRuns.keys()].toSorted(), configs.map(runKey).toSorted());
  });

  lzTestEach([...matrixRuns])('%s has one row without a shard, or one row per distinct shard', (key, rows) => {
    const shards = rows.map(({ shard }) => shard);

    assert.ok(
      (rows.length === 1 && shards[0] === undefined) ||
        (!shards.includes(undefined) && new Set(shards).size === shards.length),
      `${key} runs more than once: its rows have the shards ${shards.map(String).join(', ')}`,
    );
  });

  lzTestEach(matrixRows.map((row): [string, MatrixRow] => [`${runKey(row)} ${row.shard ?? ''}`.trimEnd(), row]))(
    '%s excludes the files its config mutates from the cache key',
    (_title, row) => {
      const config = configs.find((candidate) => runKey(candidate) === runKey(row));
      assert.ok(config, `${runKey(row)} has no Stryker config`);

      assert.deepEqual(
        row.mutated,
        config.mutate.filter((pattern) => !pattern.startsWith('!')).map((pattern) => `!${pattern}`),
      );
    },
  );

  lzTestEach(
    configs
      .filter((config) => matrixRuns.get(runKey(config))?.some(({ shard }) => shard !== undefined))
      .map((config): [string, StrykerConfigRow] => [runKey(config), config]),
  )('the shards of %s mutate each file of its config once', (key, { mutate }) => {
    const rows = matrixRuns.get(key);
    assert.ok(rows, `${key} has no CI matrix rows`);
    const shardMutates = rows.flatMap(({ mutate: patterns }) => (patterns === undefined ? [] : [patterns]));
    assert.equal(shardMutates.length, rows.length, `a shard row of ${key} has no mutate`);
    const sharded = shardMutates.flatMap((patterns) => expandGlobs(patterns));

    assert.deepEqual(sharded.toSorted(), expandGlobs(mutate).toSorted());
  });
});

const eslint = new ESLint({ cwd: workspaceRoot });
const mutatedFiles = [...new Set(configs.flatMap(({ mutate }) => expandGlobs(mutate)))];
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
