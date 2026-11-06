import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { MutantRunStatus } from '@stryker-mutator/api/test-runner';

import { lzDirPrefix } from '../../src/dirs.ts';
import {
  activeMutant,
  complete,
  dryRun,
  fixture,
  initRunner,
  logger,
  mutantRunOptions,
  passed,
  passing,
  project,
  settle,
  shareCompileCache,
  summary,
} from '../runner.fixtures.ts';

shareCompileCache();

describe('LzNodeTestTestRunner experimentalWorkerCopy', () => {
  it("runs the test files in the worker's copy of the sandbox and names their tests by the sandbox's files", async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "import { writeFileSync } from 'node:fs';",
        "it('writes', () => { cover('f-write'); writeFileSync('written.txt', ''); });",
      ),
    });
    const file = join(dir, 'a.test.mjs');
    const runner = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true });

    const { tests, mutantCoverage } = complete(await settle(runner.dryRun(dryRun)));
    await runner.dispose();

    assert.equal(existsSync(join(dir, 'written.txt')), false);
    assert.deepEqual(summary(tests), [passed(`${file} > writes`)]);
    assert.equal(tests[0]?.fileName, file);
    assert.equal(mutantCoverage?.perTest[`${file} > writes`]?.['f-write'], 1);
  });

  it("runs the tests that Stryker's filter names by the sandbox's files and names the killing ones the same", async (t) => {
    const dir = project(t, {
      'a.test.mjs': fixture(
        "it('other', () => { throw new Error('ran outside the filter'); });",
        `it('selected', () => { assert.equal(process.env.${activeMutant} ?? globalThis.__stryker__?.activeMutant, undefined); });`,
      ),
    });
    const selected = `${join(dir, 'a.test.mjs')} > selected`;
    const runner = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true });

    const result = await settle(runner.mutantRun(mutantRunOptions({ testFilter: [selected] })));
    await runner.dispose();

    assert.equal(result.status, MutantRunStatus.Killed, JSON.stringify(result));
    assert.deepEqual(result.killedBy, [selected]);
  });

  it('removes its copy when it is disposed', async (t) => {
    const dir = project(t, { 'a.test.mjs': passing });
    const copies = () => readdirSync(dirname(dir)).filter((name) => name.startsWith(lzDirPrefix('copy', process.pid)));
    const before = copies();
    const debug: string[] = [];
    const runner = await initRunner(['*.test.mjs'], { experimentalWorkerCopy: true }, { log: logger({ debug }) });
    const made = copies().filter((name) => !before.includes(name));

    await runner.dispose();

    assert.deepEqual(copies(), before);
    assert.equal(made.length, 1);
    assert.match(debug.join('\n'), new RegExp(`Copied the sandbox to .*${made.join('')} in \\d+ ms`));
  });
});
