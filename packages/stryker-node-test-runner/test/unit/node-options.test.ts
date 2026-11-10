import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { lzConsumerNodeOptions, lzNodeOptionArgs, lzReporterArgs, lzTestOnly } from '../../src/node-options.ts';

describe('lzNodeOptionArgs', () => {
  lzTestEach([
    ['nothing', undefined, []],
    ['no options', '  ', []],
    ['options at any whitespace', ' --a\t--b  --c ', ['--a', '--b', '--c']],
    ['a quoted space, keeping the quotes', '--title="a b" --c', ['--title="a b"', '--c']],
    ['an escaped quote inside quotes', '--title="a \\" b" --c', ['--title="a \\" b"', '--c']],
  ])('splits %s as node does', (_title, nodeOptions, args) => {
    assert.deepEqual(lzNodeOptionArgs(nodeOptions), args);
  });
});

describe('lzConsumerNodeOptions', () => {
  it('drops the node:test reporters and destinations, also quoted ones', () => {
    const nodeOptions = [
      '--test-reporter=spec',
      '--max-old-space-size=100',
      '--test-reporter dot',
      '"--test-reporter-destination=a b"',
      '--test-reporter-destination  stdout',
      '--title="a \\" --test-reporter=b"',
      '--test-reporter-destinations=x',
    ].join(' ');

    assert.deepEqual(lzConsumerNodeOptions({ NODE_OPTIONS: nodeOptions }), [
      '--max-old-space-size=100',
      '--title="a \\" --test-reporter=b"',
      '--test-reporter-destinations=x',
    ]);
  });

  it('drops the node:test reporters spelled with underscores, which node reads as dashes', () => {
    const nodeOptions = '--test_reporter=spec --test_reporter dot --test_reporter_destination=stdout --title=a_b';

    assert.deepEqual(lzConsumerNodeOptions({ NODE_OPTIONS: nodeOptions }), ['--title=a_b']);
  });
});

describe('lzReporterArgs', () => {
  it('gives the reporters and destinations, with the values of bare ones, and nothing else', () => {
    const args = [
      '--test-reporter=spec',
      '--enable-source-maps',
      '--test-reporter',
      'dot',
      '--test_reporter_destination=a',
    ];

    assert.deepEqual(lzReporterArgs(args), [
      '--test-reporter=spec',
      '--test-reporter',
      'dot',
      '--test_reporter_destination=a',
    ]);
  });
});

describe('lzTestOnly', () => {
  lzTestEach([
    ['neither names it', ['--no-deprecation'], '--no-warnings', false],
    ['the options name it', ['--test-only'], undefined, true],
    ['NODE_OPTIONS names it', [], '--import x  --test-only', true],
    ['NODE_OPTIONS names it quoted', [], '"--test-only"', true],
    ['it has a value, which node reads as on whatever it is', ['--test-only=false'], undefined, true],
    ['--no-test-only comes last', ['--test-only', '--no-test-only'], undefined, false],
    ['--test-only comes last', ['--no-test-only', '--test-only=true'], undefined, true],
    ['NODE_OPTIONS turns it on and the options off', ['--no-test-only'], '--test-only', false],
    ['NODE_OPTIONS turns it off and the options on', ['--test-only'], '--no-test-only', true],
    ['another option starts with it', ['--test-only-x'], undefined, false],
    ['the options name it with an underscore', ['--test_only'], undefined, true],
    ['NODE_OPTIONS turns it off with an underscore', [], '--test-only --no-test_only', false],
  ])('reads whether node runs with --test-only when %s', (_title, execArgv, nodeOptions, testOnly) => {
    assert.equal(lzTestOnly(execArgv, nodeOptions), testOnly);
  });
});
