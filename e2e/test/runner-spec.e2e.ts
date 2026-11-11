import assert from 'node:assert/strict';
import { it } from 'node:test';

import { lzFixture, lzLeftover, lzMutant } from '../src/fixture.ts';

const run = await (await lzFixture('runner-spec')).stryker();

it("ends a mutant whose loop never ends as a timeout at Stryker's hit limit", () => {
  const mutant = lzMutant(run, { at: 'src/countdown.js:4:5', replacement: 'from++' });

  assert.equal(mutant.status, 'Timeout');
  assert.match(mutant.statusReason, /^Hit limit reached \(\d+\/\d+\)$/);
});

it("ends a mutant whose test waits on a timer as a timeout of Stryker's timer, which names no reason", () => {
  const mutant = lzMutant(run, { at: 'src/ready.js:2:10', replacement: 'false' });

  assert.deepEqual(
    { status: mutant.status, statusReason: mutant.statusReason },
    { status: 'Timeout', statusReason: '' },
  );
});

it('kills a mutant in module-level code with the tests of the file that loads it, without making it static', () => {
  const mutant = lzMutant(run, { at: 'src/greeting.js:1:25', replacement: '""' });

  assert.deepEqual(
    { status: mutant.status, static: mutant.static, coveredBy: mutant.coveredBy.length },
    { status: 'Killed', static: false, coveredBy: 1 },
  );
});

it('runs only the test that reaches a mutant, which kills it', () => {
  const mutant = lzMutant(run, { at: 'src/twice.js:2:10', replacement: 'n - n' });

  assert.equal(mutant.status, 'Killed');
  assert.equal(mutant.coveredBy.length, 1);
  assert.deepEqual(mutant.killedBy, mutant.coveredBy);
});

it('leaves nothing in its temporary directory', () => {
  assert.deepEqual(lzLeftover(run), []);
});
