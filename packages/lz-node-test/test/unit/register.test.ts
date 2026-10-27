import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseArguments, templateRows, type EachOptions } from '../../src/register.ts';
import { lzTestEach } from '../../src/test-each.ts';
import { lzTestFor } from '../../src/test-for.ts';
import { signatures } from '../reported.fixtures.ts';

describe('parseArguments', () => {
  const fn = () => {};

  const cases: readonly (readonly [
    string,
    readonly [(() => void) | EachOptions | undefined, (() => void) | number | undefined],
    unknown,
  ])[] = [
    ['(name, fn)', [fn, undefined], { options: {}, fn }],
    ['(name, fn, timeout)', [fn, 50], { options: { timeout: 50 }, fn }],
    ['(name, options, fn)', [{ skip: true }, fn], { options: { skip: true }, fn }],
    ['(name, options, timeout)', [{ skip: true }, 50], { options: { timeout: 50 } }],
    ['(name)', [undefined, undefined], { options: {} }],
  ];

  lzTestFor(cases)('reads %s', ([, args, expected]) => {
    assert.deepEqual(parseArguments(args[0], args[1]), expected);
  });

  lzTestEach([
    { shape: 'options after a function', args: [fn, {}] },
    { shape: 'two functions', args: [fn, fn] },
    { shape: 'null options', args: [null, fn] },
  ])('rejects $shape', ({ args: [optionsOrFn, fnOrTimeout] }) => {
    // @ts-expect-error -- the shapes untyped callers can pass, which the types refuse
    assert.throws(() => parseArguments(optionsOrFn, fnOrTimeout), signatures);
  });

  it('accepts a null after a function', () => {
    // @ts-expect-error -- null in place of a timeout, which untyped callers can pass
    assert.deepEqual(parseArguments(fn, null), { options: {}, fn });
  });
});

describe('templateRows', () => {
  lzTestEach([
    [
      ['\n  a | b\n  ', ' | ', '\n  ', ' | ', '\n'],
      [1, 2, 3, 4],
      [
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ],
    ],
    [['first name|x\n', '|', ''], [1, 2, 3], [{ firstname: 1, x: 2 }]],
    [['a|b', '|', ''], [1], []],
    [['a\tb ', ''], [1], [{ 'a\tb': 1 }]],
  ])('reads %o with %o', (strings, values, rows) => {
    assert.deepEqual(templateRows(strings, values), rows);
  });
});
