import '@layzee/lz-stryker-node-test-mutators';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['src/**/*.ts'],
  plugins: ['@stryker-mutator/*', '@layzee/lz-stryker-node-test-runner'],
  testRunner: 'lz-stryker-node-test',
  lzStrykerNodeTest: { testFiles: ['test/**/*.test.ts'], maxMemoryMB: 300 },
  checkers: ['typescript'],
  reporters: ['clear-text', 'progress'],
};
