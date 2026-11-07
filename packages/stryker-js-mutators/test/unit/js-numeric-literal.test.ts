import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import type { LzOperator } from '@layzee/stryker-mutator-core';
import { jsAssignmentStatement } from '../../src/js-assignment-statement.ts';
import { jsNumericLiteral } from '../../src/js-numeric-literal.ts';
import { mutantsOf, mutantsOfAll } from '../mutants-of.fixtures.ts';

/**
 * Stands in for a mutator of a site that holds a number: the argument of a call, as LzNodeTimerDelay mutates a timer's
 * delay, or an assigned number, as LzNodeExitCode mutates `process.exitCode = 1`.
 */
const site: LzOperator = {
  name: 'Site',
  sample: '',
  *mutate(path, t) {
    if (path.isNumericLiteral() && (path.parentPath.isCallExpression() || path.parentPath.isAssignmentExpression())) {
      yield t.binaryExpression('+', t.cloneNode(path.node), t.numericLiteral(1));
    }
  },
};

describe('LzJsNumericLiteral', () => {
  lzTestEach([
    ['2', 'const n = 2;', ['3', '1']],
    ['1, down to 0', 'const n = 1;', ['2', '0']],
    ['0, down to a negative number', 'const n = 0;', ['1', '-1']],
    ['a hexadecimal literal', 'const n = 0x10;', ['17', '15']],
    ['a literal with separators', 'const n = 1_024;', ['1025', '1023']],
    ['an exponent literal', 'const n = 1e3;', ['1001', '999']],
    ['the literal of a negative number, so -1 becomes -2 and -0', 'const n = -1;', ['2', '0']],
    ['an index', 'const first = items[0];', ['1', '-1']],
    ['a computed key', "const o = { [1]: 'a' };", ['2', '0']],
    ['the value of a property', 'const o = { a: 2 };', ['3', '1']],
    ['a case', 'switch (n) {\n  case 3:\n    break;\n}', ['4', '2']],
    ['an argument of another call', 'child.close(9);', ['10', '8']],
    ['a negative argument of another call', 'skip(-1);', ['2', '0']],
    ['a number next to a kill call', 'kill(pid, signal + 1);', ['2', '0']],
  ])('moves %s by 1 each way', async (_title, source, expected) => {
    assert.deepEqual(await mutantsOf(jsNumericLiteral, source), expected);
  });

  lzTestEach([
    ['a fraction', 'const n = 2.5;'],
    ['an integer beyond the safe range, where 1 more is the same number', 'const n = 9007199254740993;'],
    ['a BigInt', 'const n = 10n;'],
    ['a number type', 'type T = 1;\nlet x: 2 | 3;'],
    [
      'a number type after satisfies, where Babel takes no expression',
      'const n = x satisfies 1;\nconst m = y satisfies -1;',
    ],
    ['a string', "const n = '1';"],
    ['an enum member', 'enum E {\n  A = 1,\n}'],
    ['an object key', "const o = { 1: 'a' };"],
    ['a class member key', 'class C {\n  1 = 2.5;\n}'],
    ['the signal of process.kill, as 0 + 1 is SIGHUP', 'process.kill(pid, 0);'],
    ['the signal of a kill method', 'child.kill(9);'],
    ['a negative process id of a kill function, as -0 is the process group', 'kill(-1, 15);'],
    ['an argument of an optional kill call', 'child?.kill(9);'],
    [
      'the signal of a private kill method',
      'class C {\n  #kill(pid, signal) {}\n  stop() {\n    this.#kill(pid, 0);\n  }\n}',
    ],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(jsNumericLiteral, source), []);
  });

  lzTestEach([
    ['an argument', 'setTimeout(f, 10);\nconst n = 2;', ['10 + 1', '3', '1']],
    ['a number assigned in a statement, which keeps it', 'process.exitCode = 1;', ['1 + 1']],
  ])('leaves a number that another mutator mutates, as %s, to that mutator', async (_title, source, expected) => {
    const mutants = await mutantsOfAll([site, jsAssignmentStatement, jsNumericLiteral], source);

    assert.deepEqual(
      mutants.map(([, replacement]) => replacement),
      expected,
    );
  });

  it('keeps its mutants of an assigned number, so LzJsAssignmentStatement leaves the statement alone', async () => {
    assert.deepEqual(await mutantsOfAll([jsAssignmentStatement, jsNumericLiteral], 'x = 1;'), [
      ['LzJsNumericLiteral', '2'],
      ['LzJsNumericLiteral', '0'],
    ]);
  });
});
