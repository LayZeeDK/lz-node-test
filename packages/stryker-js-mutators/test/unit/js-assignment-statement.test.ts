import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { jsAssignmentStatement } from '../../src/js-assignment-statement.ts';
import { mutantsOf, removalsNextToBuiltIns } from '../mutants-of.fixtures.ts';

describe('LzJsAssignmentStatement', () => {
  lzTestEach([
    ['a variable', 'x = y;'],
    ['a property', 'obj.k = v;'],
    ['an element', 'arr[i] = v;'],
    ['a chain, as one statement', 'a = b = c;'],
    ['a property of an object named env', 'config.env.HOME = dir;'],
  ])('removes the assignment statement of %s', async (_title, source) => {
    assert.deepEqual(await mutantsOf(jsAssignmentStatement, source), [';']);
  });

  lzTestEach([
    ['a compound assignment, which AssignmentOperator mutates', 'x += 1;'],
    ['an update, which UpdateOperator mutates', 'i++;'],
    ['a declaration', 'const x = y;'],
    ['a declaration with no value', 'let x;'],
    ['a delete', 'delete o.k;'],
    ['an assignment inside another expression', 'f(x = y);'],
    ['an assignment under a non-null assertion, which is no statement', '(x = y)!;'],
    ['an environment variable, which can point a test away from real files', 'process.env.HOME = dir;'],
    ['an environment variable by its quoted name', "process.env['HOME'] = dir;"],
    ['an environment variable of a quoted env', "process['env'].HOME = dir;"],
    ['the whole environment', 'process.env = { HOME: dir };'],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(jsAssignmentStatement, source), []);
  });

  lzTestEach([
    ['an assignment of a variable', 'x = y;', [], ['LzJsAssignmentStatement']],
    ['an assignment of a literal that BooleanLiteral mutates', 'x = true;', [], []],
    ['an assignment of a string that StringLiteral mutates', "x = 'a';", [], []],
    ['an assignment of an expression that LogicalOperator mutates', 'x = a ?? b;', [], []],
    ['an assignment of a call, which CallExpression does not remove', 'x = f(a);', [], ['LzJsAssignmentStatement']],
    ['an assignment of an awaited call', 'x = await g();', [], ['LzJsAssignmentStatement']],
    ['a call statement', 'f(a);', ['CallExpression'], ['CallExpression']],
  ])("gives %s exactly the removals next to Stryker's mutators", async (_title, source, alone, together) => {
    assert.deepEqual(await removalsNextToBuiltIns(jsAssignmentStatement, source), [alone, together]);
  });
});
