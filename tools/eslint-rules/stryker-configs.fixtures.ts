import { globSync } from 'node:fs';
import { join } from 'node:path';

export const workspaceRoot = join(import.meta.dirname, '..', '..');

export interface StrykerConfigRow {
  readonly file: string;
  readonly project: string;
  readonly config: 'src' | 'test-code';
  readonly mutate: readonly string[];
}

export const configs: readonly StrykerConfigRow[] = [
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
    file: 'packages/stryker-js-mutators/stryker.config.mjs',
    project: '@layzee/stryker-js-mutators',
    config: 'src',
    mutate: ['packages/stryker-js-mutators/src/**/*.ts', 'packages/stryker-js-mutators/test/synthetic/js-shapes.ts'],
  },
  {
    file: 'packages/stryker-js-mutators/stryker.test-code.config.mjs',
    project: '@layzee/stryker-js-mutators',
    config: 'test-code',
    mutate: ['packages/stryker-js-mutators/test/**/*.test.ts'],
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
    mutate: ['tools/eslint-rules/*.ts', '!tools/eslint-rules/*.test.ts', '!tools/eslint-rules/*.fixtures.ts'],
  },
  {
    file: 'tools/eslint-rules/stryker.test-code.config.mjs',
    project: '@layzee/eslint-rules',
    config: 'test-code',
    mutate: ['tools/eslint-rules/*.test.ts'],
  },
];

export function expandGlobs(patterns: readonly string[]): string[] {
  const glob = (globs: readonly string[]): string[] =>
    globSync(globs, { cwd: workspaceRoot }).map((file) => file.replaceAll('\\', '/'));
  const excluded = new Set(
    glob(patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1))),
  );

  return glob(patterns.filter((pattern) => !pattern.startsWith('!'))).filter((file) => !excluded.has(file));
}
