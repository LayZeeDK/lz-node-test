import assert from 'node:assert/strict';
import { it } from 'node:test';

import { lzFixture, lzMutants } from '../src/fixture.ts';

const fixture = await lzFixture('held-open');
const strict = await fixture.stryker();
const forced = await fixture.stryker('stryker.force-exit.config.mjs');

it('fails the dry run without a report when a passing test leaves a server listening', () => {
  assert.deepEqual({ exitCode: strict.exitCode, reported: strict.reported }, { exitCode: 1, reported: false });
});

it('names the test file, what held it open and the fix in the dry run error', () => {
  assert.match(
    strict.output,
    /Test file "[^"]*server\.test\.js" stayed alive after its tests and root after hooks ended, held open by TCPServerWrap, so node --test would not end either\. Close what its tests open in an after hook, or pass --test-force-exit in lzStrykerNodeTest\.nodeArgs/,
  );
});

it('kills the mutants of the same project once nodeArgs passes --test-force-exit', () => {
  assert.deepEqual(lzMutants(forced, 'src/greeting.js'), [
    '1:32 BlockStatement {} Killed',
    '2:10 StringLiteral `` Killed',
  ]);
});

it('leaves nothing in its temporary directory after either run', () => {
  assert.deepEqual([...strict.leftover, ...forced.leftover], []);
});
