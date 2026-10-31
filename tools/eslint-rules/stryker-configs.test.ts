import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe } from 'node:test';
import { pathToFileURL } from 'node:url';

import { lzTestEach } from '@layzee/lz-node-test';

const workspaceRoot = join(import.meta.dirname, '..', '..');

const configFiles = [
  'packages/lz-node-test/stryker.config.mjs',
  'packages/lz-node-test/stryker.test-code.config.mjs',
  'packages/lz-stryker-node-test-mutators/stryker.config.mjs',
  'packages/lz-stryker-node-test-mutators/stryker.test-code.config.mjs',
  'packages/lz-stryker-node-test-runner/stryker.config.mjs',
  'packages/lz-stryker-node-test-runner/stryker.test-code.config.mjs',
  'tools/eslint-rules/stryker.config.mjs',
  'tools/eslint-rules/stryker.test-code.config.mjs',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadConfig(file: string): Promise<Record<string, unknown>> {
  const module: unknown = await import(pathToFileURL(join(workspaceRoot, file)).href);
  const config = isRecord(module) ? module['default'] : undefined;
  assert.ok(isRecord(config), `${file} has no default export object`);

  return config;
}

describe('Stryker configs', () => {
  lzTestEach(configFiles)('%s fails the run below a mutation score of 100', async (file) => {
    const config = await loadConfig(file);

    assert.deepEqual(config['thresholds'], { high: 100, low: 100, break: 100 });
  });
});
