import assert from 'node:assert/strict';
import { globSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { lzTestEach } from '@layzee/node-test-extensions';
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

const notWorkspaceConfigs = new Set(['node_modules', 'e2e', '.scratch', '.claude', '.nx', 'dist', 'reports']);

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
      exclude: (name) => notWorkspaceConfigs.has(name),
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
