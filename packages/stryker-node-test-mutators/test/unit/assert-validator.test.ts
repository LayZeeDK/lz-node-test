import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { assertValidator } from '../../src/assert-validator.ts';
import { mutantsOf, strict } from '../mutants-of.fixtures.ts';

const throws = '() => { throw new Error("Stryker"); }';
const rejects = 'Promise.reject(new Error("Stryker"))';

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

  const nodeTest = "import { it } from 'node:test';\n";
  const expecting = (matcher: string) =>
    `${nodeTest}it('rejects a bad id', { expectFailure: ${matcher} }, () => parse('x'));`;

  lzTestEach([
    ['a regular expression', expecting('/bad id/')],
    ['an error class', expecting('TypeError')],
    ['an object', expecting("{ code: 'ERR_BAD_ID' }")],
    ['a function', expecting("(error) => error.code === 'ERR_BAD_ID'")],
    ['a function expression', expecting("function (error) { return error.code === 'ERR_BAD_ID'; }")],
    ['a variable', expecting('badId')],
    ['the match of a label', expecting("{ label: 'bad ids fail', match: /bad id/ }")],
    ['a match with no label', expecting('{ match: /bad id/ }')],
    ['an object with a label and other keys', expecting("{ label: 'bad ids fail', code: 'ERR_BAD_ID' }")],
    ['an empty object', expecting('{}')],
    ['a member of an object', expecting('errors.badId')],
    ['a class expression', expecting('class extends TypeError {}')],
    ['an object match of a label', expecting("{ label: 'bad ids fail', match: { code: 'ERR_BAD_ID' } }")],
  ])('replaces the test function of an expectFailure that matches through %s', async (_title, source) => {
    assert.deepEqual(await mutantsOf(assertValidator, source), [throws]);
  });

  lzTestEach([
    ['the default import', "import test from 'node:test';\ntest('fails', { expectFailure: /x/ }, f);"],
    [
      'a renamed import of test',
      "import { test as check } from 'node:test';\ncheck('fails', { expectFailure: /x/ }, f);",
    ],
    [
      "the test context's test",
      "it('parent', async (t) => {\n  await t.test('fails', { expectFailure: /x/ }, f);\n});",
    ],
    ['it.only', `${nodeTest}it.only('fails', { expectFailure: /x/ }, f);`],
    ['skip set to false', `${nodeTest}it('fails', { expectFailure: /x/, skip: false }, f);`],
    ['a namespace import', "import * as nt from 'node:test';\nnt.test('fails', { expectFailure: /x/ }, f);"],
    ['the it of a namespace import', "import * as nt from 'node:test';\nnt.it('fails', { expectFailure: /x/ }, f);"],
    ['the it of the default import', "import test from 'node:test';\ntest.it('fails', { expectFailure: /x/ }, f);"],
    ['the it of the imported test', "import { test } from 'node:test';\ntest.it('fails', { expectFailure: /x/ }, f);"],
    [
      'the it.only of a namespace import',
      "import * as nt from 'node:test';\nnt.it.only('fails', { expectFailure: /x/ }, f);",
    ],
  ])('replaces the test function of an expectFailure test made through %s', async (_title, source) => {
    assert.deepEqual(await mutantsOf(assertValidator, source), [throws]);
  });

  lzTestEach([
    ['a label', expecting("'a known bug'")],
    ['a template label', expecting('`bug ${id}`')],
    ['true', expecting('true')],
    ['a label with no match', expecting("{ label: 'a known bug' }")],
    ["a match that is a string, which node:test reads as the assertion's message", expecting("{ match: 'bad id' }")],
    ['a number', expecting('1')],
    ['a ternary', expecting("process.platform === 'win32' ? /bad id/ : 'a known bug'")],
    ['a comparison', expecting("process.platform === 'win32'")],
    ['undefined', expecting('undefined')],
    ['a match of undefined', expecting('{ match: undefined }')],
    ['no expectFailure', `${nodeTest}it('parses', { timeout: 10 }, () => parse('x'));`],
    [
      'test.skip, which never runs',
      "import { test } from 'node:test';\ntest.skip('fails', { expectFailure: /x/ }, f);",
    ],
    ['it.todo, whose failure fails nothing', `${nodeTest}it.todo('fails', { expectFailure: /x/ }, f);`],
    ['a skip option', `${nodeTest}it('fails', { expectFailure: /x/, skip: 'flaky' }, f);`],
    ['a todo option', `${nodeTest}it('fails', { expectFailure: /x/, todo: true }, f);`],
    [
      'options that spread another object, which may set skip',
      `${nodeTest}it('fails', { ...flaky, expectFailure: /x/ }, f);`,
    ],
    [
      'another import of node:test',
      "import { describe } from 'node:test';\ndescribe('fails', { expectFailure: /x/ }, f);",
    ],
    [
      'the test of another import of node:test',
      "import { mock } from 'node:test';\nmock.test('fails', { expectFailure: /x/ }, f);",
    ],
    ['no options', `${nodeTest}it('parses', () => parse('x'));`],
    ['options passed whole', `${nodeTest}it('fails', options, f);`],
    ['an it of another library', "import { it } from 'vitest';\nit('fails', { expectFailure: /x/ }, f);"],
    ['an it of its own', "function it(...args: unknown[]) {}\nit('fails', { expectFailure: /x/ }, f);"],
    ['an it.only of another library', "import { it } from 'vitest';\nit.only('fails', { expectFailure: /x/ }, f);"],
    ['a namespace of another library', "import * as v from 'vitest';\nv.it('fails', { expectFailure: /x/ }, f);"],
    [
      'a parameter that shadows the imported it',
      `${nodeTest}[f].forEach((it) => {\n  it('fails', { expectFailure: /x/ }, f);\n});`,
    ],
    ['a test method of a variable', "const re = /x/;\nre.test('fails', { expectFailure: /x/ }, f);"],
    [
      'an it of the test context',
      "it('parent', async (t) => {\n  await t.it('fails', { expectFailure: /x/ }, f);\n});",
    ],
    [
      'a computed test of the test context',
      "it('parent', async (t) => {\n  await t['test']('fails', { expectFailure: /x/ }, f);\n});",
    ],
  ])('leaves a test with %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(assertValidator, source), []);
  });
});
