import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';
import { ESLint, type Linter } from 'eslint';

const workspaceRoot = join(import.meta.dirname, '..', '..');

// One file per lint scope: each files glob of the root and package ESLint configs.
const samples = [
  'eslint.config.mjs',
  'stryker.base.mjs',
  'packages/lz-node-test/eslint.config.mjs',
  'packages/lz-node-test/stryker.config.mjs',
  'packages/lz-stryker-node-test-mutators/stryker.config.mjs',
  'packages/lz-stryker-node-test-runner/stryker.test-code.config.mjs',
  'tools/eslint-rules/stryker.config.mjs',
  'packages/lz-node-test/src/index.ts',
  'packages/lz-stryker-node-test-mutators/src/index.ts',
  'packages/lz-stryker-node-test-runner/src/index.ts',
  'packages/lz-node-test/test/unit/title.test.ts',
  'packages/lz-node-test/test/modified.types.ts',
  'packages/lz-stryker-node-test-mutators/test/unit/operator.test.ts',
  'packages/lz-stryker-node-test-runner/test/runner.fixtures.ts',
  'tools/eslint-rules/index.ts',
  'tools/eslint-rules/index.test.ts',
  'e2e/src/exec.ts',
  'e2e/test/esm-js.e2e.ts',
  'e2e/test/unit/report.test.ts',
  'packages/lz-node-test/package.json',
  'packages/lz-stryker-node-test-mutators/package.json',
  'packages/lz-stryker-node-test-runner/package.json',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const warnSettings: readonly Linter.RuleSeverity[] = ['warn', 1];
const warnSeverities = new Set<unknown>(warnSettings);

// ESLint gives each rule as [severity, ...options]; a bare severity is read the same way.
function isWarn(entry: unknown): boolean {
  const [severity]: unknown[] = [entry].flat();

  return warnSeverities.has(severity);
}

async function rulesAtWarn(file: string, eslint = new ESLint({ cwd: workspaceRoot })): Promise<readonly string[]> {
  const config: unknown = await eslint.calculateConfigForFile(join(workspaceRoot, file));
  assert.ok(isRecord(config), `ESLint computed no config for ${file}`);
  const rules = config['rules'];
  assert.ok(isRecord(rules), `${file} has no rules`);

  return Object.entries(rules)
    .filter(([, entry]) => isWarn(entry))
    .map(([rule]) => rule);
}

describe('ESLint severity', () => {
  lzTestEach(samples)('%s runs every enabled rule at error', async (file) => {
    const warn = await rulesAtWarn(file);

    assert.deepEqual({ file, warn }, { file, warn: [] });
  });

  lzTestEach(warnSettings)('reports a rule set to %s', async (severity) => {
    const eslint = new ESLint({ cwd: workspaceRoot, overrideConfig: { rules: { 'no-debugger': severity } } });

    const warn = await rulesAtWarn('stryker.base.mjs', eslint);

    assert.deepEqual(warn, ['no-debugger']);
  });
});
