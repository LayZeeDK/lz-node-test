// What each package's Stryker configs share. Stryker runs from the workspace root, so that the sandbox keeps the
// packages' tsconfig extends and the workspace's links.
import '@layzee/stryker-node-test-mutators';

// The packages import each other and load the runner and the operators from their TypeScript source.
export const SOURCE = '--conditions=@lz-node-test/source';

/**
 * A package's config for its test code: `config` with the operators for test files installed in place of the
 * production ones. The replace install has to run after this module's add install ends, and an ES module's sibling
 * static import starts before an earlier sibling's top-level await settles.
 *
 * @param {import('@stryker-mutator/api/core').PartialStrykerOptions} config
 */
export async function testCode(config) {
  await import('@layzee/stryker-node-test-mutators/test-code');

  return config;
}

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  plugins: ['@stryker-mutator/*', '@layzee/stryker-node-test-runner'],
  testRunner: 'lz-node-test',
  testRunnerNodeArgs: [SOURCE],
  checkers: ['typescript'],
  checkerNodeArgs: [SOURCE],
  // The checker's schema calls grouped checks less accurate, and with a break of 100 a missed compile error fails the
  // run.
  typescriptChecker: { prioritizePerformanceOverAccuracy: false },
  reporters: ['clear-text', 'progress'],
  thresholds: { high: 100, low: 100, break: 100 },
  ignorePatterns: ['/.claude', '/.nx', '/plans'],
};
