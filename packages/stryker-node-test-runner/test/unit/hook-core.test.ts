import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Position } from '@stryker-mutator/api/core';

import { lzTestFor } from '@layzee/node-test-extensions';
import { recordEvents, redirectNodeTest, writesAllowed, type TestEvent } from '../../src/hook-core.ts';
import type { RecordedTest } from '../../src/record.ts';
import {
  importRedirected,
  loadContext,
  out,
  reported,
  resolveContext,
  testFile,
  type TestDetails,
} from '../hook-core.fixtures.ts';

function record(
  events: TestEvent[],
  positions = new Map<string, Position>(),
  diagnostics: string[] = [],
): RecordedTest[] {
  const tests: RecordedTest[] = [];
  const recordEvent = recordEvents(testFile, tests, positions, diagnostics);

  for (const event of events) {
    recordEvent(event);
  }

  return tests;
}

describe('recordEvents', () => {
  const testDetails: TestDetails = { type: 'test', duration_ms: 1.5 };
  const suiteDetails: TestDetails = { type: 'suite', duration_ms: 3 };

  it('records each test with its status and time, named after the file, its suites and its parent tests', () => {
    assert.deepEqual(
      record([
        { type: 'test:enqueue', data: { name: 'top', nesting: 0 } },
        { type: 'test:start', data: { name: 'outer', nesting: 0 } },
        ...reported('first', 1, 'pass', testDetails),
        { type: 'test:start', data: { name: 'parent', nesting: 1 } },
        ...reported('child', 2, 'pass', testDetails),
        { type: 'test:pass', data: { name: 'parent', nesting: 1, details: { type: 'test', duration_ms: 2 } } },
        ...reported('second', 1, 'pass', testDetails),
        { type: 'test:pass', data: { name: 'outer', nesting: 0, details: suiteDetails } },
        { type: 'test:complete', data: { name: 'outer', nesting: 0, details: suiteDetails } },
        ...reported('top', 0, 'pass', { type: 'test', duration_ms: 0.25 }),
        { type: 'test:diagnostic', data: { name: 'tests 5', nesting: 0 } },
      ]),
      [
        { id: `${testFile} > outer > first`, status: 'passed', timeSpentMs: 1.5 },
        { id: `${testFile} > outer > parent > child`, status: 'passed', timeSpentMs: 1.5 },
        { id: `${testFile} > outer > parent`, status: 'passed', timeSpentMs: 2 },
        { id: `${testFile} > outer > second`, status: 'passed', timeSpentMs: 1.5 },
        { id: `${testFile} > top`, status: 'passed', timeSpentMs: 0.25 },
      ],
    );
  });

  it('records no test for a result without details, or one whose test did not start', () => {
    assert.deepEqual(
      record([
        { type: 'test:start', data: { name: 'no details', nesting: 0 } },
        { type: 'test:pass', data: { name: 'no details', nesting: 0 } },
        { type: 'test:fail', data: { name: 'not started', nesting: 1, details: testDetails } },
        ...reported('recorded', 0, 'pass', testDetails),
      ]),
      [{ id: `${testFile} > recorded`, status: 'passed', timeSpentMs: 1.5 }],
    );
  });

  it('records a failed test with what it threw, or with the message node:test gives the failure', () => {
    const failure = (message: string, cause: unknown, failureType = 'testCodeFailure') => ({
      ...testDetails,
      error: { failureType, message, cause },
    });

    assert.deepEqual(
      record([
        ...reported('throws', 0, 'fail', failure('wrapped', new Error('expected 1 to be 2'))),
        ...reported('throws text', 0, 'fail', failure('plain text', 'plain text')),
        ...reported('times out', 0, 'fail', failure('test timed out after 5ms', 'test timed out after 5ms')),
        ...reported('hook', 0, 'fail', failure('failed running afterEach hook', new Error('hook'), 'hookFailed')),
        ...reported('without cause', 0, 'fail', { ...testDetails, error: { message: 'no cause' } }),
      ]).map(({ id, status, failureMessage }) => ({ id, status, failureMessage })),
      [
        { id: `${testFile} > throws`, status: 'failed', failureMessage: 'expected 1 to be 2' },
        { id: `${testFile} > throws text`, status: 'failed', failureMessage: 'plain text' },
        { id: `${testFile} > times out`, status: 'failed', failureMessage: 'test timed out after 5ms' },
        { id: `${testFile} > hook`, status: 'failed', failureMessage: 'hook' },
        { id: `${testFile} > without cause`, status: 'failed', failureMessage: 'no cause' },
      ],
    );
  });

  it('records where the wrapper found that a test is declared', () => {
    const positions = new Map([[`${testFile} > declared`, { line: 2, column: 0 }]]);

    assert.deepEqual(
      record(
        [...reported('declared', 0, 'pass', testDetails), ...reported('unknown', 0, 'pass', testDetails)],
        positions,
      ),
      [
        { id: `${testFile} > declared`, status: 'passed', timeSpentMs: 1.5, startPosition: { line: 2, column: 0 } },
        { id: `${testFile} > unknown`, status: 'passed', timeSpentMs: 1.5 },
      ],
    );
  });

  it('records skipped and todo tests as skipped, whatever their outcome', () => {
    const error = { failureType: 'testCodeFailure', message: 'not done', cause: new Error('not done') };

    assert.deepEqual(
      record([
        ...reported('skipped', 0, 'pass', testDetails, { skip: true }),
        ...reported('skipped with a reason', 0, 'pass', testDetails, { skip: 'not here' }),
        ...reported('todo', 0, 'pass', testDetails, { todo: true }),
        ...reported('failing todo', 0, 'fail', { ...testDetails, error }, { todo: 'later' }),
      ]),
      [
        { id: `${testFile} > skipped`, status: 'skipped', timeSpentMs: 1.5 },
        { id: `${testFile} > skipped with a reason`, status: 'skipped', timeSpentMs: 1.5 },
        { id: `${testFile} > todo`, status: 'skipped', timeSpentMs: 1.5 },
        { id: `${testFile} > failing todo`, status: 'skipped', timeSpentMs: 1.5 },
      ],
    );
  });

  it('records a suite only when it fails by itself or is skipped, not when it passes or a test inside it fails', () => {
    const suiteFailure = (failureType: string, message: string, cause: unknown) => ({
      ...suiteDetails,
      error: { failureType, message, cause },
    });

    assert.deepEqual(
      record([
        ...reported('passes', 0, 'pass', suiteDetails),
        ...reported('fails inside', 0, 'fail', suiteFailure('subtestsFailed', '1 subtest failed', '1 subtest failed')),
        ...reported('before', 0, 'fail', suiteFailure('hookFailed', 'failed running before hook', new Error('before'))),
        ...reported('skipped', 0, 'pass', suiteDetails, { skip: true }),
        ...reported('skipped with a reason', 0, 'pass', suiteDetails, { skip: 'not here' }),
      ]),
      [
        { id: `${testFile} > before`, status: 'failed', failureMessage: 'before', timeSpentMs: 3 },
        { id: `${testFile} > skipped`, status: 'skipped', timeSpentMs: 3 },
        { id: `${testFile} > skipped with a reason`, status: 'skipped', timeSpentMs: 3 },
      ],
    );
  });

  it('records the failure of the test file itself, from an `after` hook outside any suite, as that hook', () => {
    const error = { failureType: 'hookFailed', message: 'after failure', cause: new Error('after failure') };

    assert.deepEqual(
      record([
        ...reported('passes', 0, 'pass', testDetails),
        { type: 'test:fail', data: { name: testFile, nesting: 0, details: { duration_ms: 4, error } } },
      ]),
      [
        { id: `${testFile} > passes`, status: 'passed', timeSpentMs: 1.5 },
        { id: `${testFile} > "after" hook`, status: 'failed', failureMessage: 'after failure', timeSpentMs: 4 },
      ],
    );
  });

  it('tells same-named suites and tests of one parent apart in the order node:test reports them, as the wrapper does', () => {
    const suite = (name: string, ...inside: TestEvent[]): TestEvent[] => [
      { type: 'test:start', data: { name, nesting: 0 } },
      ...inside,
      { type: 'test:pass', data: { name, nesting: 0, details: suiteDetails } },
    ];

    assert.deepEqual(
      record([
        ...suite('s', ...reported('works', 1, 'pass', testDetails), ...reported('works', 1, 'pass', testDetails)),
        ...suite('s', ...reported('works', 1, 'pass', testDetails)),
        ...reported('a > b', 0, 'pass', testDetails),
      ]).map(({ id }) => id),
      [
        `${testFile} > s > works`,
        `${testFile} > s > works (2)`,
        `${testFile} > s (2) > works`,
        `${testFile} > a \\> b`,
      ],
    );
  });

  it('keeps the diagnostics of errors raised after a test ended, and no others', () => {
    const late =
      'Error: Test "late" at a.test.mjs:1:1 generated asynchronous activity after the test ended. This activity ' +
      'created the error "Error: boom" and would have caused the test to fail, but instead triggered an ' +
      'uncaughtException event.';
    const diagnostic = (message: string): TestEvent => ({
      type: 'test:diagnostic',
      data: { name: '', nesting: 0, message },
    });
    const diagnostics: string[] = [];

    const tests = record(
      [
        diagnostic(late),
        diagnostic('tests 1'),
        { type: 'test:stdout', data: { name: '', nesting: 0, message: late } },
        diagnostic(`${late} Again.`),
        ...reported('late', 0, 'pass', testDetails),
      ],
      new Map(),
      diagnostics,
    );

    assert.deepEqual(diagnostics, [late, `${late} Again.`]);
    assert.equal(tests.length, 1);
  });

  it("records where the wrapper found the test file's failing `after` hook", () => {
    const error = { failureType: 'hookFailed', message: 'after failure' };
    const positions = new Map([[`${testFile} > "after" hook`, { line: 2, column: 4 }]]);

    assert.deepEqual(
      record(
        [{ type: 'test:fail', data: { name: testFile, nesting: 0, details: { duration_ms: 4, error } } }],
        positions,
      ),
      [
        {
          id: `${testFile} > "after" hook`,
          status: 'failed',
          failureMessage: 'after failure',
          timeSpentMs: 4,
          startPosition: { line: 2, column: 4 },
        },
      ],
    );
  });
});

describe('redirectNodeTest', () => {
  it('resolves node:test to a module of its own for import and for require', () => {
    const hooks = redirectNodeTest(['it']);
    const passOn = (...args: unknown[]) => ({ url: 'passed-on', format: undefined, passedOn: args });
    const context = resolveContext(['node', 'import']);
    const imported = hooks.resolve('node:test', context, passOn);
    const required = hooks.resolve('node:test', resolveContext(['node', 'require']), passOn);
    const loaded = [imported, required].map(({ url }) => hooks.load(url, loadContext(['node']), passOn));

    assert.deepEqual([imported.format, required.format, imported.url === required.url], ['module', 'commonjs', false]);
    assert.deepEqual(
      [imported, required].map(({ url }) => url.startsWith('node:')),
      [false, false],
    );
    // Node.js requires a hook that does not pass a module on to say so.
    assert.deepEqual(
      [imported, required, ...loaded].map(({ format, shortCircuit }) => [format, shortCircuit]),
      [
        ['module', true],
        ['commonjs', true],
        ['module', true],
        ['commonjs', true],
      ],
    );
  });

  it('passes on every other module to the next hook', () => {
    const hooks = redirectNodeTest(['it']);
    const passOn = (...args: unknown[]) => ({ url: 'passed-on', format: undefined, passedOn: args });
    const context = resolveContext(['node', 'import']);
    const loading = loadContext(['node', 'import']);
    const redirected = hooks.resolve('node:test', context, passOn);

    assert.deepEqual(hooks.resolve('node:assert', context, passOn), passOn('node:assert', context));
    assert.deepEqual(hooks.load('node:assert', loading, passOn), passOn('node:assert', loading));
    assert.deepEqual(hooks.load(`x${redirected.url}`, loading, passOn), passOn(`x${redirected.url}`, loading));
  });

  it('gives the wrapped module as default export and require result, and its properties as named exports', async () => {
    const wrapped = Object.assign(() => 'test', { it: () => 'it', mock: { name: 'mock' } });

    const { module, commonjs } = await importRedirected(redirectNodeTest(['it', 'mock']), wrapped);

    assert.deepEqual({ ...module }, { default: wrapped, it: wrapped.it, mock: wrapped.mock });
    assert.equal(commonjs, wrapped);
  });
});

describe('writesAllowed', () => {
  lzTestFor<readonly [string, boolean | undefined, boolean]>([
    ['outside the permission model', undefined, true],
    ['under the permission model with write access', true, true],
    ['under the permission model without write access', false, false],
  ])('lets a process write its record %s, or not', ([, allowed, expected]) => {
    const asked: [string, string | undefined][] = [];
    const permission =
      allowed === undefined
        ? undefined
        : {
            has: (scope: string, reference?: string) => {
              asked.push([scope, reference]);

              return allowed;
            },
          };

    assert.equal(writesAllowed(permission, out), expected);
    assert.deepEqual(asked, allowed === undefined ? [] : [['fs.write', out]]);
  });
});
