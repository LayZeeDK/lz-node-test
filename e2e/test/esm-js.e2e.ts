import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';

import { lzFixture, lzLeftover, lzMutants } from '../src/fixture.ts';

const fixture = await lzFixture('esm-js');
const production = await fixture.stryker();
const testCode = await fixture.stryker('stryker.test-code.config.mjs');

it('kills the mutants the table tests reach and lets the boundary mutant no case sits on survive', () => {
  assert.deepEqual(lzMutants(production, 'src/age.js'), [
    '1:30 BlockStatement {} Killed',
    '2:10 ConditionalExpression false Killed',
    '2:10 ConditionalExpression true Killed',
    '2:10 EqualityOperator age < 18 Killed',
    '2:10 EqualityOperator age > 18 Survived',
  ]);
});

it('reports the mutants of an export no test calls as not covered', () => {
  assert.deepEqual(lzMutants(production, 'src/senior.js'), [
    '1:31 BlockStatement {} NoCoverage',
    '2:10 ConditionalExpression false NoCoverage',
    '2:10 ConditionalExpression true NoCoverage',
    '2:10 EqualityOperator age < 65 NoCoverage',
    '2:10 EqualityOperator age > 65 NoCoverage',
  ]);
});

it('mutates only the assertions of a test file with the test-code entry and kills the failing one', () => {
  assert.deepEqual(lzMutants(testCode, 'test/age.test.js'), [
    '14:5 LzAssertCall { assert.equal(isAdult(age), adult); throw new Error("Stryker: assertion reached"); } Killed',
  ]);
});

it('leaves only the dry run memory peaks in its temporary directory after either run', () => {
  assert.deepEqual(
    [...lzLeftover(production), ...lzLeftover(testCode)],
    ['lz-stryker-node-test-peaks-<pid>-dry-run', 'lz-stryker-node-test-peaks-<pid>-dry-run'],
  );
});

it('removes the memory peaks of an ended run at the next run', () => {
  const [firstPeaks] = production.leftover;

  assert.ok(firstPeaks);
  assert.equal(existsSync(join(fixture.dir, 'tmp', firstPeaks)), false);
});
