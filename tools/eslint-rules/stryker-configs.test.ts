import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { lzTestEach } from '@layzee/node-test-extensions';
import { parse } from 'yaml';
import { configs, expandGlobs, type StrykerConfigRow, workspaceRoot } from './stryker-configs.fixtures.ts';
import { lzIsRecord } from './stryker-report.ts';

function runKey({ project, config }: { readonly project: string; readonly config: string }): string {
  return `${project}:mutate-${config}`;
}

// The packages' runs never read e2e/; the e2e runs mutate it, and these tests load its Stryker configs.
const ignorePatterns = (file: string): string[] => [
  '/.claude',
  '/.nx',
  '/.scratch',
  '/reports',
  file.startsWith('packages/') ? '/e2e' : '/e2e/fixtures',
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

const matrixRows = readMatrix();
const matrixRuns = Map.groupBy(matrixRows, runKey);
const matrixCases = matrixRows.map((row): [string, MatrixRow] => [`${runKey(row)} ${row.shard ?? ''}`.trimEnd(), row]);

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

  lzTestEach(matrixCases)('%s sets mutate exactly when it sets shard', (_title, { shard, mutate }) => {
    assert.equal(mutate === undefined, shard === undefined, 'a row sets one of mutate and shard without the other');
  });

  lzTestEach(matrixCases)('%s excludes the files its config mutates from the cache key', (_title, row) => {
    const config = configs.find((candidate) => runKey(candidate) === runKey(row));
    assert.ok(config, `${runKey(row)} has no Stryker config`);

    assert.deepEqual(
      row.mutated,
      config.mutate.filter((pattern) => !pattern.startsWith('!')).map((pattern) => `!${pattern}`),
    );
  });

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
