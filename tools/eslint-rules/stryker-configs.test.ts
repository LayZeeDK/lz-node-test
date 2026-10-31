import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe } from 'node:test';
import { pathToFileURL } from 'node:url';

import { lzTestEach } from '@layzee/lz-node-test';

const workspaceRoot = join(import.meta.dirname, '..', '..');

const configs: readonly (readonly [file: string, mutate: readonly string[]])[] = [
  ['packages/lz-node-test/stryker.config.mjs', ['packages/lz-node-test/src/**/*.ts']],
  [
    'packages/lz-node-test/stryker.test-code.config.mjs',
    ['packages/lz-node-test/test/**/*.test.ts', '!packages/lz-node-test/test/integration/register.test.ts'],
  ],
  [
    'packages/lz-stryker-node-test-mutators/stryker.config.mjs',
    [
      'packages/lz-stryker-node-test-mutators/src/**/*.ts',
      'packages/lz-stryker-node-test-mutators/test/synthetic/node-apis.ts',
    ],
  ],
  [
    'packages/lz-stryker-node-test-mutators/stryker.test-code.config.mjs',
    ['packages/lz-stryker-node-test-mutators/test/**/*.test.ts'],
  ],
  ['packages/lz-stryker-node-test-runner/stryker.config.mjs', ['packages/lz-stryker-node-test-runner/src/**/*.ts']],
  [
    'packages/lz-stryker-node-test-runner/stryker.test-code.config.mjs',
    ['packages/lz-stryker-node-test-runner/test/**/*.test.ts'],
  ],
  ['tools/eslint-rules/stryker.config.mjs', ['tools/eslint-rules/*.ts', '!tools/eslint-rules/*.test.ts']],
  ['tools/eslint-rules/stryker.test-code.config.mjs', ['tools/eslint-rules/*.test.ts']],
];

const ignorePatterns = ['/.claude', '/.nx', '/plans', '/e2e'];

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
  lzTestEach(configs.map(([file]) => file))('%s fails the run below a mutation score of 100', async (file) => {
    const config = await loadConfig(file);

    assert.deepEqual(config['thresholds'], { high: 100, low: 100, break: 100 });
  });

  lzTestEach(configs)('%s mutates only its listed files', async (file, mutate) => {
    const config = await loadConfig(file);

    assert.deepEqual(
      { mutate: config['mutate'], ignorePatterns: config['ignorePatterns'] },
      { mutate, ignorePatterns },
    );
  });
});
