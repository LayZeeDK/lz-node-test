import { lzNodeTestMutators } from '@layzee/stryker-node-test-mutators';

await lzNodeTestMutators();

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['test/**/*.test.js'],
  plugins: ['@stryker-mutator/*', '@layzee/stryker-node-test-runner'],
  testRunner: 'lz-node-test',
  lzNodeTest: { testFiles: ['test/**/*.test.js'] },
  reporters: ['clear-text', 'progress'],
};
