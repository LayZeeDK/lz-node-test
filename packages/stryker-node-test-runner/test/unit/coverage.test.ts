import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzTestFor } from '@layzee/node-test-extensions';
import { lzMergeAsStatic, lzMergeCoverage, lzOutsideTests, lzOverlapCoverage } from '../../src/coverage.ts';
import type { RecordedTest } from '../../src/record.ts';

describe('lzMergeCoverage', () => {
  it('adds up the hits of every process and skips processes without coverage', () => {
    assert.deepEqual(
      lzMergeCoverage([
        { static: { 1: 1 }, perTest: { first: { 2: 1 } } },
        undefined,
        { static: { 1: 2, 3: 1 }, perTest: { first: { 2: 3 }, second: { 4: 1 } } },
      ]),
      { static: { 1: 3, 3: 1 }, perTest: { first: { 2: 4 }, second: { 4: 1 } } },
    );
  });

  it('is empty without coverage', () => {
    assert.deepEqual(lzMergeCoverage([]), { static: {}, perTest: {} });
  });
});

describe('lzMergeAsStatic', () => {
  it('counts the hits inside tests as static', () => {
    assert.deepEqual(
      lzMergeAsStatic([
        { static: { 1: 1 }, perTest: { first: { 1: 1, 2: 1 } } },
        undefined,
        { static: {}, perTest: { first: { 2: 3 }, second: { 4: 1 } } },
      ]),
      { static: { 1: 2, 2: 4, 4: 1 }, perTest: {} },
    );
  });
});

describe('lzOverlapCoverage', () => {
  const hits = { 1: 2, 2: 1 };
  const own = { 9: 1 };
  /** `a`, then no test, then `b`, `c`; later `p`, its subtest `p > x`, and `p` again. */
  const testSpans = {
    a: [{ start: 0, end: 10 }],
    b: [{ start: 12, end: 20 }],
    c: [{ start: 22, end: 30 }],
    p: [
      { start: 40, end: 50 },
      { start: 60, end: 70 },
    ],
    'p > x': [{ start: 50, end: 60 }],
  };
  const descendant = (test: string, lifetime?: { start: number; end: number }) => ({
    tests: [],
    mutantCoverage: { static: own, perTest: { [test]: hits } },
    ...(lifetime && { lifetime }),
  });
  const attributed = (perTest: readonly string[], outside = false) => ({
    static: outside ? { 1: 2, 2: 1, 9: 1 } : own,
    perTest: Object.fromEntries(perTest.map((test) => [test, hits])),
  });

  lzTestFor<readonly [string, string, { start: number; end: number }, readonly string[]]>([
    ['one span of its test', 'a', { start: 3, end: 8 }, ['a']],
    ["its subtest's span", 'p > x', { start: 52, end: 58 }, ['p > x']],
  ])("keeps a descendant's hits per test when it lives inside %s", ([, test, lifetime, tests]) => {
    assert.deepEqual(lzOverlapCoverage(descendant(test, lifetime), testSpans), attributed(tests));
  });

  lzTestFor<readonly [string, { start: number; end: number }]>([
    ['ends during the subtest', { start: 52, end: 58 }],
    ['ends after the subtest', { start: 52, end: 65 }],
  ])('gives the hits of a descendant that a test starts and its subtest uses to both, when it %s', ([, lifetime]) => {
    assert.deepEqual(lzOverlapCoverage(descendant('p', lifetime), testSpans), attributed(['p', 'p > x']));
  });

  lzTestFor<readonly [string, { start: number; end: number }]>([
    ['starts during that test', { start: 5, end: 15 }],
    ['starts only after that test', { start: 11, end: 15 }],
  ])(
    'gives the hits of a descendant that outlives the test that started it to that test, every later test it overlapped and static, when it %s',
    ([, lifetime]) => {
      assert.deepEqual(lzOverlapCoverage(descendant('a', lifetime), testSpans), attributed(['a', 'b'], true));
    },
  );

  it("starts a descendant's life at the span of its test that starts with it, not at an earlier span", () => {
    assert.deepEqual(lzOverlapCoverage(descendant('p', { start: 60, end: 65 }), testSpans), attributed(['p']));
  });

  it('gives the hits of a descendant that ends as a test starts to that test too', () => {
    assert.deepEqual(
      lzOverlapCoverage(descendant('b', { start: 15, end: 22 }), testSpans),
      attributed(['b', 'c'], true),
    );
  });

  it('gives the hits of a descendant that ends as the span of its test ends to static too, as no test is current then', () => {
    assert.deepEqual(lzOverlapCoverage(descendant('a', { start: 3, end: 10 }), testSpans), attributed(['a'], true));
  });

  it('gives the hits of a descendant that outlives every test to the tests it overlapped and to static', () => {
    assert.deepEqual(lzOverlapCoverage(descendant('c', { start: 25, end: 35 }), testSpans), attributed(['c'], true));
  });

  it('gives the hits a descendant puts under a test without spans to the tests it overlapped', () => {
    assert.deepEqual(
      lzOverlapCoverage(descendant('gone', { start: 3, end: 15 }), testSpans),
      attributed(['a', 'b'], true),
    );
  });

  it("counts a descendant's hits as static without its lifetime or the file's spans", () => {
    assert.deepEqual(lzOverlapCoverage(descendant('a'), testSpans), attributed([], true));
    assert.deepEqual(lzOverlapCoverage(descendant('a', { start: 3, end: 8 }), undefined), attributed([], true));
  });

  it("credits the test file's own hits outside its tests to each test, counting them once so the hit limit holds", () => {
    const tests = ['a', 'b', 'c'].map((id): RecordedTest => ({ id, status: 'passed', timeSpentMs: 1 }));

    assert.deepEqual(
      lzOverlapCoverage({ main: true, tests, mutantCoverage: { static: { 9: 3 }, perTest: { a: hits } } }, testSpans),
      { static: {}, perTest: { a: { ...hits, 9: 3 }, b: { 9: 1 }, c: { 9: 1 } } },
    );
  });

  it('keeps the own hits of a test file without tests static, and a record without coverage without it', () => {
    const coverage = { static: own, perTest: {} };

    assert.deepEqual(lzOverlapCoverage({ main: true, tests: [], mutantCoverage: coverage }, {}), coverage);
    assert.equal(lzOverlapCoverage({ tests: [], lifetime: { start: 3, end: 8 } }, testSpans), undefined);
  });
});

describe('lzOutsideTests', () => {
  const tests: readonly RecordedTest[] = [{ id: 'a', status: 'passed', timeSpentMs: 1 }];

  it("names the mutants that the test file's own process reached outside its tests, not a started process's", () => {
    assert.deepEqual(
      lzOutsideTests([
        { main: true, tests, mutantCoverage: { static: { 1: 1, 2: 4 }, perTest: { a: { 3: 1 } } } },
        { tests, mutantCoverage: { static: { 5: 1 }, perTest: {} } },
      ]),
      ['1', '2'],
    );
  });

  it('names none for a test file without tests, whose hits stay static, or without coverage', () => {
    assert.deepEqual(
      lzOutsideTests([{ main: true, tests: [], mutantCoverage: { static: { 1: 1 }, perTest: {} } }]),
      [],
    );
    assert.deepEqual(lzOutsideTests([{ main: true, tests }]), []);
  });
});
