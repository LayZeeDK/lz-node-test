import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe } from 'node:test';
import { pathToFileURL } from 'node:url';

import { lzTestEach } from '@layzee/node-test-extensions';

const workspaceRoot = join(import.meta.dirname, '..', '..');

const configs: readonly (readonly [file: string, mutate: readonly string[]])[] = [
  ['packages/node-test-extensions/stryker.config.mjs', ['packages/node-test-extensions/src/**/*.ts']],
  ['packages/node-test-extensions/stryker.test-code.config.mjs', ['packages/node-test-extensions/test/**/*.test.ts']],
  [
    'packages/stryker-node-test-mutators/stryker.config.mjs',
    [
      'packages/stryker-node-test-mutators/src/**/*.ts',
      'packages/stryker-node-test-mutators/test/synthetic/node-apis.ts',
    ],
  ],
  [
    'packages/stryker-node-test-mutators/stryker.test-code.config.mjs',
    ['packages/stryker-node-test-mutators/test/**/*.test.ts'],
  ],
  ['packages/stryker-node-test-runner/stryker.config.mjs', ['packages/stryker-node-test-runner/src/**/*.ts']],
  [
    'packages/stryker-node-test-runner/stryker.test-code.config.mjs',
    ['packages/stryker-node-test-runner/test/**/*.test.ts'],
  ],
  ['tools/eslint-rules/stryker.config.mjs', ['tools/eslint-rules/*.ts', '!tools/eslint-rules/*.test.ts']],
  ['tools/eslint-rules/stryker.test-code.config.mjs', ['tools/eslint-rules/*.test.ts']],
];

const ignorePatterns = ['/.claude', '/.nx', '/plans', '/e2e', '/reports'];

// Each config's reports, named as the mutate-src and mutate-test-code targets read them.
const reportNames: readonly (readonly [file: string, name: string])[] = [
  ['packages/node-test-extensions/stryker.config.mjs', '@layzee/node-test-extensions.src'],
  ['packages/node-test-extensions/stryker.test-code.config.mjs', '@layzee/node-test-extensions.test-code'],
  ['packages/stryker-node-test-mutators/stryker.config.mjs', '@layzee/stryker-node-test-mutators.src'],
  ['packages/stryker-node-test-mutators/stryker.test-code.config.mjs', '@layzee/stryker-node-test-mutators.test-code'],
  ['packages/stryker-node-test-runner/stryker.config.mjs', '@layzee/stryker-node-test-runner.src'],
  ['packages/stryker-node-test-runner/stryker.test-code.config.mjs', '@layzee/stryker-node-test-runner.test-code'],
  ['tools/eslint-rules/stryker.config.mjs', 'eslint-rules.src'],
  ['tools/eslint-rules/stryker.test-code.config.mjs', 'eslint-rules.test-code'],
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

  lzTestEach(reportNames)('%s writes its HTML and JSON reports as reports/mutation/%s', async (file, name) => {
    const config = await loadConfig(file);

    assert.deepEqual(
      { html: config['htmlReporter'], json: config['jsonReporter'] },
      { html: { fileName: `reports/mutation/${name}.html` }, json: { fileName: `reports/mutation/${name}.json` } },
    );
  });
});
