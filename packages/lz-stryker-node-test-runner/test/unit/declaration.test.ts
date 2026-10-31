import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { StrykerOptions } from '@stryker-mutator/api/core';
import { PluginKind } from '@stryker-mutator/api/plugin';
import ajvModule from 'ajv';

import { lzTestEach } from '@layzee/lz-node-test';
import * as entry from '../../src/index.ts';
import { LzStrykerNodeTestRunner, strykerPlugins, strykerValidationSchema } from '../../src/index.ts';
import { lzMinNodeVersion } from '../../src/runner.ts';
import pkg from '../../package.json' with { type: 'json' };

/** Stryker validates its options with these settings, and merges the properties of each plugin's schema into its own. */
function validator() {
  return new ajvModule.default({ useDefaults: true, allErrors: true, strict: false }).compile({
    type: 'object',
    properties: strykerValidationSchema.properties,
  });
}

describe('plugin declaration', () => {
  it('exports only the plugin, its schema and the runner class from the package entry', () => {
    assert.deepEqual(Object.keys(entry).sort(), [
      'LzStrykerNodeTestRunner',
      'strykerPlugins',
      'strykerValidationSchema',
    ]);
  });

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

  it('gives stryker init the keyword it lists test runners by, a homepage, and a config that names and loads the runner', () => {
    // stryker init merges initStrykerConfig over the config it writes, so its fields must be Stryker options.
    const initConfig: Partial<StrykerOptions> = pkg.initStrykerConfig;

    assert.ok(pkg.keywords.includes('@stryker-mutator/test-runner-plugin'));
    assert.match(pkg.homepage, /^https:\/\/github\.com\/.+\/packages\/lz-stryker-node-test-runner#readme$/);
    assert.deepEqual(
      [initConfig],
      strykerPlugins.map((plugin) => ({ testRunner: plugin.name, appendPlugins: [pkg.name] })),
    );
  });

  it('supports the Node.js versions that package.json supports', () => {
    assert.equal(pkg.engines.node, `>=${lzMinNodeVersion.join('.')}`);
  });

  lzTestEach([
    [{}, { lzStrykerNodeTest: { testFiles: ['**/?(*.)+(spec|test).[jt]s?(x)'], nodeArgs: [] } }],
    [
      { lzStrykerNodeTest: { maxMemoryMB: 1500 } },
      { lzStrykerNodeTest: { testFiles: ['**/?(*.)+(spec|test).[jt]s?(x)'], nodeArgs: [], maxMemoryMB: 1500 } },
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
