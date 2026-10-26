import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { PluginKind } from '@stryker-mutator/api/plugin';
import ajvModule from 'ajv';

import { lzTestEach } from '@layzee/lz-node-test';
import {
  LZ_MIN_NODE_VERSION,
  LzStrykerNodeTestRunner,
  strykerPlugins,
  strykerValidationSchema,
} from '../../src/index.ts';

/** Stryker validates its options with these settings, and merges the properties of each plugin's schema into its own. */
function validator() {
  return new ajvModule.default({ useDefaults: true, allErrors: true, strict: false }).compile({
    type: 'object',
    properties: strykerValidationSchema.properties,
  });
}

describe('plugin declaration', () => {
  it('declares the lz-stryker-node-test test runner', () => {
    assert.deepEqual(strykerPlugins, [
      { kind: PluginKind.TestRunner, name: 'lz-stryker-node-test', injectableClass: LzStrykerNodeTestRunner },
    ]);
  });

  lzTestEach([
    {},
    { lzStrykerNodeTest: {} },
    { lzStrykerNodeTest: { testFiles: ['a.test.ts', 'b/*.test.ts'] } },
    { lzStrykerNodeTest: { nodeArgs: ['--enable-source-maps', '--stack-size=900'] } },
    { lzStrykerNodeTest: { maxMemoryMB: 1500 } },
  ])('accepts the options %j', (options) => {
    assert.ok(validator()(options));
  });

  lzTestEach([
    { lzStrykerNodeTest: '*.test.ts' },
    { lzStrykerNodeTest: { testFiles: '*.test.ts' } },
    { lzStrykerNodeTest: { testFiles: [1] } },
    { lzStrykerNodeTest: { testfiles: ['*.test.ts'] } },
    { lzStrykerNodeTest: { nodeArgs: '--enable-source-maps' } },
    { lzStrykerNodeTest: { nodeArgs: [1] } },
    { lzStrykerNodeTest: { maxMemoryMB: '1500' } },
    { lzStrykerNodeTest: { maxMemoryMB: 0 } },
    { lzStrykerNodeTest: { maxMemoryMB: 1.5 } },
  ])('rejects the options %j', (options) => {
    assert.ok(!validator()(options));
  });

  it('supports the Node.js versions that package.json supports', () => {
    const { engines } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      engines: { node: string };
    };

    assert.equal(engines.node, `>=${LZ_MIN_NODE_VERSION.join('.')}`);
  });

  lzTestEach([
    [{}, { lzStrykerNodeTest: { testFiles: ['**/*.test.ts'], nodeArgs: [] } }],
    [
      { lzStrykerNodeTest: { maxMemoryMB: 1500 } },
      { lzStrykerNodeTest: { testFiles: ['**/*.test.ts'], nodeArgs: [], maxMemoryMB: 1500 } },
    ],
    [
      { lzStrykerNodeTest: { testFiles: ['a.test.ts'], nodeArgs: ['--enable-source-maps'] } },
      { lzStrykerNodeTest: { testFiles: ['a.test.ts'], nodeArgs: ['--enable-source-maps'] } },
    ],
  ])('fills in the defaults of %j', (options, filled) => {
    assert.ok(validator()(options));
    assert.deepEqual(options, filled);
  });
});
