import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { ESLint, type Linter } from 'eslint';
import { lzIsRecord } from './stryker-report.ts';

const workspaceRoot = join(import.meta.dirname, '..', '..');

// One file per lint scope: each files glob of the root and package ESLint configs.
const samples = [
  'eslint.config.mjs',
  'stryker.base.mjs',
  'packages/node-test-extensions/eslint.config.mjs',
  'packages/node-test-extensions/stryker.config.mjs',
  'packages/stryker-node-mutators/stryker.config.mjs',
  'packages/stryker-node-test-runner/stryker.test-code.config.mjs',
  'tools/eslint-rules/stryker.config.mjs',
  'packages/node-test-extensions/src/index.ts',
  'packages/stryker-node-mutators/src/index.ts',
  'packages/stryker-node-test-runner/src/index.ts',
  'packages/node-test-extensions/test/unit/title.test.ts',
  'packages/node-test-extensions/test/modified.types.ts',
  'packages/stryker-node-mutators/test/unit/operators.test.ts',
  'packages/stryker-node-test-runner/test/runner.fixtures.ts',
  'tools/eslint-rules/index.ts',
  'tools/eslint-rules/index.test.ts',
  'e2e/src/exec.ts',
  'e2e/test/esm-js.e2e.ts',
  'e2e/test/unit/report.test.ts',
  'packages/node-test-extensions/package.json',
  'packages/stryker-node-mutators/package.json',
  'packages/stryker-node-test-runner/package.json',
];

const warnSettings: readonly Linter.RuleSeverity[] = ['warn', 1];
const warnSeverities = new Set<unknown>(warnSettings);

// ESLint gives each rule as [severity, ...options]; a bare severity is read the same way.
function isWarn(entry: unknown): boolean {
  const [severity]: unknown[] = [entry].flat();

  return warnSeverities.has(severity);
}

async function rulesAtWarn(file: string, eslint = new ESLint({ cwd: workspaceRoot })): Promise<readonly string[]> {
  const config: unknown = await eslint.calculateConfigForFile(join(workspaceRoot, file));
  assert.ok(lzIsRecord(config), `ESLint computed no config for ${file}`);
  const rules = config['rules'];
  assert.ok(lzIsRecord(rules), `${file} has no rules`);

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
