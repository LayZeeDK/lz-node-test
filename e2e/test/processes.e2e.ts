import assert from 'node:assert/strict';
import { it } from 'node:test';

import { lzFixture, lzMutants } from '../src/fixture.ts';

const run = await (await lzFixture('processes')).stryker();

it('kills the mutants that only a child process a test spawns reaches', () => {
  assert.deepEqual(lzMutants(run, 'src/child-only.js'), [
    '1:30 BlockStatement {} Killed',
    '2:10 StringLiteral "" Killed',
  ]);
});

it('reports the mutants that only a child spawned without NODE_OPTIONS reaches as not covered', () => {
  assert.deepEqual(lzMutants(run, 'src/unhooked-only.js'), [
    '1:33 BlockStatement {} NoCoverage',
    '2:10 StringLiteral "" NoCoverage',
  ]);
});

it('kills the mutants that only a worker thread a test starts reaches', () => {
  assert.deepEqual(lzMutants(run, 'src/worker-only.js'), [
    '1:31 BlockStatement {} Killed',
    '2:10 StringLiteral "" Killed',
  ]);
});

it('leaves nothing in its temporary directory', () => {
  assert.deepEqual(run.leftover, []);
});
