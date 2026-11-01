/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['src/**/*.js'],
  plugins: ['@stryker-mutator/*', '@layzee/stryker-node-test-runner'],
  testRunner: 'lz-stryker-node-test',
  lzStrykerNodeTest: { testFiles: ['test/**/*.test.js'], nodeArgs: ['--test-only'] },
  reporters: ['clear-text', 'progress'],
};
