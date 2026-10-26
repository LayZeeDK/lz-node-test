import parser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';
import rule from './no-assertion-in-iteration.ts';

const STRICT = "import assert from 'node:assert/strict';\n";

/** With no global describe or it, as under node:test, RuleTester runs each case inside the calling test. */
function tester(): RuleTester {
  return new RuleTester({ languageOptions: { parser } });
}

describe('no-assertion-in-iteration', () => {
  lzTestEach([
    ['an assertion outside any loop', `${STRICT}assert.ok(x);`],
    ['a call that is not an assertion in a loop body', `${STRICT}for (const x of xs) { f(x); }`],
    ['a call that is not an assertion in a loop condition', `${STRICT}while (next()) { x++; }`],
    ['a call that is not an assertion in an iteration callback', `${STRICT}xs.map((x) => f(x));`],
    [
      'an assertion in a test callback declared in a loop body',
      `${STRICT}for (const c of cases) { test(c.name, () => { assert.ok(c); }); }`,
    ],
    [
      'an assertion in a test callback declared in an iteration callback',
      `${STRICT}cases.forEach((c) => { test(c.name, () => { assert.ok(c); }); });`,
    ],
    [
      'an assertion in a test function expression declared in a loop body',
      `${STRICT}for (const c of cases) { test(c.name, function () { assert.ok(c); }); }`,
    ],
    ['a call of a call result in a loop body', `${STRICT}for (const x of xs) { make()(x); }`],
    [
      'a test context call that is not an assertion in a loop body',
      `${STRICT}for (const x of xs) { t.mock.method(x, 'f'); }`,
    ],
    [
      'a call named like an assertion but imported from elsewhere',
      "import { ok } from './ok.ts';\nfor (const x of xs) { ok(x); }",
    ],
  ])('accepts %s', (_, code) => {
    tester().run('no-assertion-in-iteration', rule, { valid: [code], invalid: [] });
  });

  lzTestEach([
    ['an assertion in a for...of body', `${STRICT}for (const x of xs) { assert.ok(x); }`, 'loop'],
    ['an assertion in a for body', `${STRICT}for (let i = 0; i < n; i++) { assert.ok(i); }`, 'loop'],
    ['an assertion in a for...in body', `${STRICT}for (const k in o) { assert.ok(k); }`, 'loop'],
    ['an assertion in a while body', `${STRICT}while (more) { assert.ok(x); }`, 'loop'],
    ['an assertion in a do...while body', `${STRICT}do { assert.ok(x); } while (more);`, 'loop'],
    ['an assertion in a forEach callback', `${STRICT}xs.forEach((x) => { assert.ok(x); });`, 'callback'],
    [
      'an assertion in a forEach function expression',
      `${STRICT}xs.forEach(function (x) { assert.ok(x); });`,
      'callback',
    ],
    ['an assertion in a map callback', `${STRICT}xs.map((x) => { assert.ok(x); });`, 'callback'],
    ['an assertion in a flatMap callback', `${STRICT}xs.flatMap((x) => { assert.ok(x); });`, 'callback'],
    ['an assertion in an every callback', `${STRICT}xs.every((x) => { assert.ok(x); });`, 'callback'],
    ['an assertion in a some callback', `${STRICT}xs.some((x) => { assert.ok(x); });`, 'callback'],
    ['an assertion in a filter callback', `${STRICT}xs.filter((x) => { assert.ok(x); });`, 'callback'],
    ['an assertion in a find callback', `${STRICT}xs.find((x) => { assert.ok(x); });`, 'callback'],
    ['an assertion in a findIndex callback', `${STRICT}xs.findIndex((x) => { assert.ok(x); });`, 'callback'],
    ['a call of the assert function in a loop body', `${STRICT}for (const x of xs) { assert(x); }`, 'loop'],
    [
      'a named node:assert import in a loop body',
      "import { ok } from 'node:assert';\nfor (const x of xs) { ok(x); }",
      'loop',
    ],
    [
      'a namespace node:assert/strict import in a loop body',
      "import * as a from 'node:assert/strict';\nfor (const x of xs) { a.ok(x); }",
      'loop',
    ],
    ['a t.assert assertion in a for...of body', 'for (const x of xs) { t.assert.ok(x); }', 'loop'],
    ['a t.assert assertion in a forEach callback', 'xs.forEach((x) => { t.assert.ok(x); });', 'callback'],
    ['an assertion in a reduce callback', `${STRICT}xs.reduce((a, x) => { assert.ok(x); return a; }, 0);`, 'callback'],
  ])('reports %s', (_, code, messageId) => {
    tester().run('no-assertion-in-iteration', rule, { valid: [], invalid: [{ code, errors: [{ messageId }] }] });
  });

  lzTestEach([
    [
      'a loop body',
      `${STRICT}for (const x of xs) { assert.ok(x); }`,
      /^An assertion in a loop body may run zero times/,
    ],
    [
      'an iteration callback',
      `${STRICT}xs.forEach((x) => { assert.ok(x); });`,
      /^An assertion in an iteration callback may run zero times/,
    ],
  ])('names the fix for %s in its message', (_, code, message) => {
    tester().run('no-assertion-in-iteration', rule, { valid: [], invalid: [{ code, errors: [{ message }] }] });
  });
});
