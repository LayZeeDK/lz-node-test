import parser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import rule from './stryker-disable-comment.ts';

/** With no global describe or it, as under node:test, RuleTester runs each case inside the calling test. */
function tester(): RuleTester {
  return new RuleTester({ languageOptions: { parser } });
}

describe('stryker-disable-comment', () => {
  lzTestEach([
    ['a next-line disable with a reason', '// Stryker disable next-line ArrayDeclaration: equivalent\nf([]);'],
    ['two mutators', '// Stryker disable next-line LzAssertStatement,CallExpression: never empty\nf();'],
    ['two mutators with a space', '// Stryker disable next-line Regex, StringLiteral: equivalent\nf();'],
    ['no space after the slashes', '//Stryker disable next-line ArrayDeclaration: equivalent\nf([]);'],
    ['a block comment', '/* Stryker disable next-line ArrayDeclaration: equivalent */\nf([]);'],
    ['a file-wide pair', '// Stryker disable StringLiteral: equivalent\nf();\n// Stryker restore StringLiteral\ng();'],
    [
      'a pair that names the mutators in another order and case',
      '// Stryker disable Regex,StringLiteral: equivalent\nf();\n// Stryker restore stringliteral, REGEX\ng();',
    ],
    [
      'a pair whose list ends in a comma',
      '// Stryker disable Regex,: equivalent\nf();\n// Stryker restore Regex\ng();',
    ],
    ['a restore with a reason', '// Stryker disable Regex: equivalent\nf();\n// Stryker restore Regex: done\ng();'],
    [
      'two pairs of the same mutators',
      '// Stryker disable Regex: a\nf();\n// Stryker restore Regex\n// Stryker disable Regex: b\ng();\n// Stryker restore Regex',
    ],
    ['two spaces before Stryker, which Stryker does not read', '//  Stryker disable all\nf();'],
    ['text before Stryker, which Stryker does not read', '// see Stryker disable all\nf();'],
    ['a doc comment, which Stryker does not read', '/** Stryker disable all */\nf();'],
    ['a lowercase directive, which Stryker does not read', '// stryker disable all\nf();'],
    ['a directive in a string', "f('// Stryker disable all');"],
  ])('accepts %s', (_, code) => {
    tester().run('stryker-disable-comment', rule, { valid: [code], invalid: [] });
  });

  lzTestEach([
    ['a next-line disable of all', '// Stryker disable next-line all: equivalent\nf();', 'all'],
    ['all in any case', '// Stryker disable next-line ALL: equivalent\nf();', 'all'],
    ['all beside a mutator', '// Stryker disable next-line Regex, all: equivalent\nf();', 'all'],
    ['a block comment of all', '/* Stryker disable next-line all: equivalent */\nf();', 'all'],
    ['all with no space after the slashes', '//Stryker disable next-line all: equivalent\nf();', 'all'],
    ['a restore of all', '// Stryker restore all\nf();', 'all'],
    ['a next-line disable with no reason', '// Stryker disable next-line Regex\nf();', 'reason'],
    ['a next-line disable with an empty reason', '// Stryker disable next-line Regex:\nf();', 'reason'],
    ['a next-line disable with a blank reason', '// Stryker disable next-line Regex: \t\nf();', 'reason'],
    ['a file-wide disable with no restore', '// Stryker disable Regex: equivalent\nf();', 'unrestored'],
    ['a next-line restore', '// Stryker restore next-line Regex\nf();', 'form'],
    ['a restore with no disable', '// Stryker restore Regex\nf();', 'form'],
  ])('reports %s', (_, code, messageId) => {
    tester().run('stryker-disable-comment', rule, { valid: [], invalid: [{ code, errors: [{ messageId }] }] });
  });

  lzTestEach([
    [
      'a pair whose disable gives no reason',
      '// Stryker disable Regex\nf();\n// Stryker restore Regex',
      [{ messageId: 'reason', line: 1 }],
    ],
    [
      'a restore of other mutators',
      '// Stryker disable Regex: equivalent\nf();\n// Stryker restore StringLiteral',
      [
        { messageId: 'unrestored', line: 1 },
        { messageId: 'form', line: 3 },
      ],
    ],
    [
      'a restore of fewer mutators',
      '// Stryker disable Regex,StringLiteral: equivalent\nf();\n// Stryker restore Regex',
      [
        { messageId: 'unrestored', line: 1 },
        { messageId: 'form', line: 3 },
      ],
    ],
    [
      'a restore that splits a mutator name in two',
      '// Stryker disable ArithmeticOperator: equivalent\nf();\n// Stryker restore Arithmetic, Operator',
      [
        { messageId: 'unrestored', line: 1 },
        { messageId: 'form', line: 3 },
      ],
    ],
    [
      'a next-line restore after a file-wide disable',
      '// Stryker disable Regex: equivalent\nf();\n// Stryker restore next-line Regex',
      [
        { messageId: 'unrestored', line: 1 },
        { messageId: 'form', line: 3 },
      ],
    ],
    [
      'a restore before its disable',
      '// Stryker restore Regex\nf();\n// Stryker disable Regex: equivalent',
      [
        { messageId: 'form', line: 1 },
        { messageId: 'unrestored', line: 3 },
      ],
    ],
    [
      'two disables of the same mutators and one restore',
      '// Stryker disable Regex: a\n// Stryker disable Regex: b\nf();\n// Stryker restore Regex',
      [{ messageId: 'unrestored', line: 1 }],
    ],
    [
      'a file-wide disable of all',
      '// Stryker disable all: equivalent\nf();\n// Stryker restore all',
      [
        { messageId: 'all', line: 1 },
        { messageId: 'all', line: 3 },
      ],
    ],
  ])('reports %s at each comment', (_, code, errors) => {
    tester().run('stryker-disable-comment', rule, { valid: [], invalid: [{ code, errors }] });
  });

  lzTestEach([
    ['all', '// Stryker disable next-line all: equivalent\nf();', /^Name the mutators instead of all/],
    ['a missing reason', '// Stryker disable next-line Regex\nf();', /^Give a reason after the mutator list/],
    ['a missing restore', '// Stryker disable Regex: equivalent\nf();', /^Restore the same mutators later/],
    ['another form', '// Stryker restore Regex\nf();', /^Use \/\/ Stryker disable next-line/],
  ])('names the fix for %s in its message', (_, code, message) => {
    tester().run('stryker-disable-comment', rule, { valid: [], invalid: [{ code, errors: [{ message }] }] });
  });
});
