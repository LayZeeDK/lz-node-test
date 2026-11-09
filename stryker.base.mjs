// What each package's Stryker configs share. Stryker runs from the workspace root, so that the sandbox keeps the
// packages' tsconfig extends and the workspace's links.

import { availableParallelism, freemem } from 'node:os';

/**
 * Stryker's default concurrency, capped by the memory free as the run starts, with 4 GB left over for the rest of the
 * machine. A unit, a checker or a test runner process, costs `gbPerUnit`. `--concurrency` still overrides it.
 *
 * @param {number} gbPerUnit
 */
export function concurrency(gbPerUnit) {
  const cores = availableParallelism();
  const byMemory = Math.floor((freemem() / 2 ** 30 - 4) / gbPerUnit);

  return Math.max(1, Math.min(cores > 4 ? cores - 1 : cores, byMemory));
}

// The packages import each other and load the runner and the operators from their TypeScript source.
export const source = '--conditions=@layzee/source';

/**
 * A package's config for its production code: `config` with the default node mutators added to Stryker's, and the
 * opt-in LzNodeAssertStatement, as these packages assert their invariants with node:assert.
 * The installs live here and not in the packages' configs, as an import there would make each package depend on the
 * mutator packages, which depend on some of them.
 *
 * @param {import('@stryker-mutator/api/core').PartialStrykerOptions} config
 * @param {import('@layzee/stryker-js-mutators').LzJsMutatorOptions} [jsMutators] the JavaScript mutators to add
 */
export async function production(config, jsMutators) {
  const { lzNodeMutators } = await import('@layzee/stryker-node-mutators');
  await lzNodeMutators({ LzNodeAssertStatement: true });

  if (jsMutators !== undefined) {
    const { lzJsMutators } = await import('@layzee/stryker-js-mutators');
    await lzJsMutators(jsMutators);
  }

  return config;
}

/**
 * A package's config for its test code: `config` with the test-code operators in place of Stryker's mutators. It
 * installs no production operators, which replace mode would keep.
 *
 * @param {import('@stryker-mutator/api/core').PartialStrykerOptions} config
 */
export async function testCode(config) {
  const { lzNodeTestMutators } = await import('@layzee/stryker-node-test-mutators');
  await lzNodeTestMutators();

  return config;
}

const ignoredEverywhere = ['/.claude', '/.nx', '/.scratch', '/reports'];

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  plugins: ['@stryker-mutator/*', '@layzee/stryker-node-test-runner'],
  testRunner: 'lz-node-test',
  testRunnerNodeArgs: [source],
  checkers: ['typescript'],
  checkerNodeArgs: [source],
  // The checker's schema calls grouped checks less accurate, and with a break of 100 a missed compile error fails the
  // run.
  typescriptChecker: { prioritizePerformanceOverAccuracy: false },
  // The progress reporter prints nothing without a terminal, as in CI.
  reporters: ['clear-text', process.env.CI ? 'progress-append-only' : 'progress', 'html', 'json'],
  thresholds: { high: 100, low: 100, break: 100 },
  ignorePatterns: [...ignoredEverywhere, '/e2e'],
  concurrency: concurrency(1.1),
};

/**
 * The ignore patterns of the configs whose runs read e2e/: the e2e project mutates it, and the eslint-rules tests
 * load its Stryker configs. Its consumer fixtures stay out of the sandbox.
 */
export const ignorePatternsKeepingE2e = [...ignoredEverywhere, '/e2e/fixtures'];

/**
 * A config's HTML and JSON report files, so that the two configs of a project do not write the same file. The
 * mutate-src and mutate-test-code targets read the JSON report by this name.
 *
 * @param {string} name `<project>.src` or `<project>.test-code`
 */
export function reportFiles(name) {
  return {
    htmlReporter: { fileName: `reports/mutation/${name}.html` },
    jsonReporter: { fileName: `reports/mutation/${name}.json` },
  };
}
