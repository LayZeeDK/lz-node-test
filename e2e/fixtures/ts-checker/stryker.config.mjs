import { lzNodeMutators } from '@layzee/stryker-node-mutators';

await lzNodeMutators();

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['src/**/*.ts'],
  plugins: ['@stryker-mutator/*', '@layzee/stryker-node-test-runner'],
  testRunner: 'lz-node-test',
  lzNodeTest: { testFiles: ['test/**/*.test.ts'], maxMemoryMB: 300 },
  checkers: ['typescript'],
  reporters: ['clear-text', 'progress'],
};
