import '@layzee/lz-stryker-node-test-mutators/test-code';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['test/**/*.test.js'],
  plugins: ['@stryker-mutator/*', '@layzee/lz-stryker-node-test-runner'],
  testRunner: 'lz-stryker-node-test',
  lzStrykerNodeTest: { testFiles: ['test/**/*.test.js'] },
  reporters: ['clear-text', 'progress'],
};
