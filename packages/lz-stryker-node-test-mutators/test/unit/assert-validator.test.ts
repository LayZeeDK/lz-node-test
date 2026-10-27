import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';
import { assertValidator } from '../../src/assert-validator.ts';
import { mutantsOf } from '../mutants-of.fixtures.ts';

const throws = '() => { throw new Error("Stryker"); }';
const rejects = 'Promise.reject(new Error("Stryker"))';
const strict = "import assert from 'node:assert/strict';\n";

describe('LzAssertValidator', () => {
  lzTestEach([
    ['assert.throws', `${strict}assert.throws(() => parse(''), /empty/);`, [throws]],
    ['assert.throws without a validator', `${strict}assert.throws(() => parse(''));`, [throws]],
    ['assert.rejects', `${strict}await assert.rejects(load(), { message: 'gone' });`, [rejects]],
    ['a named import of throws', "import { throws } from 'node:assert';\nthrows(f, TypeError);", [throws]],
    ['a renamed import of rejects', "import { rejects as fails } from 'assert';\nawait fails(p, Error);", [rejects]],
    ["the test context's throws", 'function check(t: any) {\n  t.assert.throws(f, /x/);\n}', [throws]],
    ["the test context's rejects", 'async function check(t: any) {\n  await t.assert.rejects(p);\n}', [rejects]],
    ['an assertion whose value is used', `${strict}const done = assert.rejects(p);`, [rejects]],
    ['a subject that is a call, and not its arguments', `${strict}assert.throws(wrap(f));`, [throws]],
  ])('replaces what %s checks, and only that', async (_title, source, expected) => {
    assert.deepEqual(await mutantsOf(assertValidator, source), expected);
  });

  lzTestEach([
    ['a spread', `${strict}assert.throws(...args);`],
    ['assert.doesNotThrow', `${strict}assert.doesNotThrow(f);`],
    ['assert.doesNotReject', `${strict}await assert.doesNotReject(p);`],
    ['another assertion', `${strict}assert.equal(f, g);`],
    ['a throws of its own', 'function throws(f: unknown) {}\nthrows(f);'],
    ['a throws of another library', "import { assert } from 'chai';\nassert.throws(f);"],
    ['an array element in first place', `${strict}[assert.throws, f];`],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(assertValidator, source), []);
  });
});
