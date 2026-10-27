import nx from '@nx/eslint-plugin';
import n from 'eslint-plugin-n';
import nodeTest from 'eslint-node-test';

// Relative to the config ESLint loads: the root one or a package's, which spreads this one.
// The workspace's ESLint rules keep their tests beside them, outside src/ and test/.
const TOOL_TEST = ['tools/eslint-rules/*.test.ts'];
const SRC = ['**/src/**/*.ts', 'tools/eslint-rules/*.ts'];
const TEST = ['**/test/**/*.ts', ...TOOL_TEST];
// Code samples the operators' tests mutate, not tests.
const SYNTHETIC = ['**/test/synthetic/**'];
// Consumer projects the e2e suite installs; they break workspace rules on purpose.
const E2E_FIXTURES = ['**/e2e/fixtures/**'];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc', '**/.stryker-tmp', ...SYNTHETIC, ...E2E_FIXTURES],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'type:lib',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            {
              sourceTag: 'type:tool',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.mjs'],
    rules: { '@nx/workspace-require-windows-hide': 'error' },
  },
  {
    files: [...SRC, ...TEST],
    plugins: { n },
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    settings: { n: { version: '^22.18.0 || >=24.0.0' } },
    rules: {
      'n/no-deprecated-api': 'error',
      'n/no-unsupported-features/node-builtins': ['error', { ignores: ['module.registerHooks', 'util.getCallSites'] }],
      'n/no-unsupported-features/es-builtins': 'error',
      'n/no-unsupported-features/es-syntax': 'error',
      'n/prefer-node-protocol': 'error',
      'n/prefer-promises/fs': 'error',
      'n/prefer-promises/dns': 'error',
      'n/no-path-concat': 'error',
      'preserve-caught-error': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/no-floating-promises': [
        'error',
        // Never add 'test': it also silences an un-awaited t.test() subtest.
        { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['it', 'describe', 'suite'] }] },
      ],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/return-await': ['error', 'in-try-catch'],
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Augmenting node:test's types takes a namespace inside `declare module`.
      '@typescript-eslint/no-namespace': ['error', { allowDeclarations: true }],
    },
  },
  {
    files: SRC,
    ignores: TOOL_TEST,
    rules: {
      'n/no-process-exit': 'error',
      'n/no-extraneous-import': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': ['error', { allowThrowingUnknown: true }],
      '@typescript-eslint/only-throw-error': ['error', { allowThrowingUnknown: true }],
      // It asks for `as const`, which the `as` ban below reports in src.
      '@typescript-eslint/prefer-as-const': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name=/^set(Timeout|Interval)$/][arguments.length<2]',
          message: 'Pass the delay explicitly, so LzNodeTimerDelay can mutate it.',
        },
        {
          // Also `as const`, which consistent-type-assertions allows.
          selector: 'TSAsExpression, TSTypeAssertion',
          message:
            'Stryker 10 mutates nothing inside an `as` expression. Annotate the binding, use `satisfies`, or Object.freeze() a literal table instead.',
        },
      ],
    },
  },
  {
    files: [...SRC, ...TEST],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['node:assert', 'assert', 'assert/strict'].map((name) => ({
            name,
            message: "Import assert from 'node:assert/strict', whose equal and deepEqual are the strict methods.",
          })),
        },
      ],
    },
  },
  {
    // Test rules stay off src: @layzee/lz-node-test's src imports node:test as a library.
    files: TEST,
    plugins: { 'node-test': nodeTest },
    rules: {
      ...nodeTest.configs.recommended.rules,
      'node-test/prefer-test-context-assert': 'off',
      'node-test/no-import-test-files': 'off',
      'node-test/no-process-env-mutation': 'off',
      'node-test/no-process-exit-in-test': 'off',
      'node-test/no-export': 'off',
      'node-test/no-done-callback': 'error',
      'node-test/no-skip-without-reason': 'error',
      'node-test/no-commented-tests': 'error',
      'node-test/no-snapshot-in-loop': 'error',
      'node-test/no-assert-in-hook': 'error',
      // The tests' empty functions are no-op test doubles.
      '@typescript-eslint/no-empty-function': 'off',
      '@nx/workspace-no-assertion-in-iteration': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression > MemberExpression.callee[object.name=/^test(Each|For)$/][property.name="only"]',
          message: 'Remove .only before committing: it makes node:test --test-only skip every other test.',
        },
      ],
    },
  },
  {
    files: ['**/test/**/*.test.ts', ...TOOL_TEST],
    rules: { 'node-test/no-export': 'error' },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      // It asks for `!` in place of `as NonNullable<T>`, both of which the two rules above report.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      // Deprecated in favour of no-empty-object-type, which reports the same node.
      '@typescript-eslint/no-empty-interface': 'off',
    },
  },
];
