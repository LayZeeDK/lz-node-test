import nx from '@nx/eslint-plugin';
import n from 'eslint-plugin-n';

// Relative to the config ESLint loads: the root one or a package's, which spreads this one.
const SRC = ['**/src/**/*.ts'];
const TEST = ['**/test/**/*.ts'];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
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
          ],
        },
      ],
    },
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
      '@typescript-eslint/non-nullable-type-assertion-style': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: SRC,
    rules: {
      'n/no-process-exit': 'error',
      'n/no-extraneous-import': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': ['error', { allowThrowingUnknown: true }],
      '@typescript-eslint/only-throw-error': ['error', { allowThrowingUnknown: true }],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never', arrayLiteralTypeAssertions: 'never' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name=/^set(Timeout|Interval)$/][arguments.length<2]',
          message: 'Pass the delay explicitly, so NodeTimerDelay can mutate it.',
        },
        {
          selector:
            "TSAsExpression:not([expression.type='Identifier']):not([expression.type='MemberExpression']):not([expression.type='ThisExpression']):not([expression.type='TSAsExpression'])",
          message:
            'Stryker 10 mutates nothing inside an `as` expression. Annotate the binding, use `satisfies`, or Object.freeze() a literal table instead.',
        },
      ],
    },
  },
];
