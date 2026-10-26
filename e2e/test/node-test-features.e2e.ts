import assert from 'node:assert/strict';
import { it } from 'node:test';

import { lzFixture, lzMutants } from '../src/fixture.ts';

const run = await (await lzFixture('node-test-features')).stryker();

it('kills the mutants a test with t.plan reaches', () => {
  assert.deepEqual(lzMutants(run, 'src/double.js'), [
    '1:27 BlockStatement {} Killed',
    '2:10 ArithmeticOperator n / 2 Killed',
  ]);
});

it('kills the mutants only a before hook reaches, through the test that reads its value', () => {
  assert.deepEqual(lzMutants(run, 'src/triple.js'), [
    '1:27 BlockStatement {} Killed',
    '2:10 ArithmeticOperator n / 3 Killed',
  ]);
});

it('kills the mutants an lzTestFor.only case reaches under --test-only', () => {
  assert.deepEqual(lzMutants(run, 'src/negate.js'), ['1:27 BlockStatement {} Killed', '2:10 UnaryOperator +n Killed']);
});

it('reports the mutants only a test that --test-only skips reaches as not covered', () => {
  assert.deepEqual(lzMutants(run, 'src/half.js'), [
    '1:25 BlockStatement {} NoCoverage',
    '2:10 ArithmeticOperator n * 2 NoCoverage',
  ]);
});

it('leaves nothing in its temporary directory', () => {
  assert.deepEqual(run.leftover, []);
});
