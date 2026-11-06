import { lzJsMutators } from '@layzee/stryker-js-mutators';

import base, { production, reportFiles, source } from '../../stryker.base.mjs';

// The shared production config installs none of this package's operators; the package's own code gets all of them.
await lzJsMutators({ experimental: true });

export default await production({
  ...base,
  // The synthetic sample is code that exists to be mutated by the production operators.
  mutate: ['packages/stryker-js-mutators/src/**/*.ts', 'packages/stryker-js-mutators/test/synthetic/js-shapes.ts'],
  tsconfigFile: 'packages/stryker-js-mutators/tsconfig.stryker.json',
  incrementalFile: 'reports/stryker-incremental/@layzee/stryker-js-mutators.src.json',
  ...reportFiles('@layzee/stryker-js-mutators.src'),
  lzNodeTest: { testFiles: ['packages/stryker-js-mutators/test/**/*.test.ts'], nodeArgs: [source] },
});
