import assert from 'node:assert/strict';
import { describe } from 'node:test';

import type { NodePath } from '@babel/core';
import type { Location } from '@stryker-mutator/api/core';

import { lzTestEach } from '@layzee/node-test-extensions';
import type { LzOperator } from '@layzee/stryker-mutator-core';
import { instrumentWith, mutantsOf } from '../mutants-of.fixtures.ts';
import { jsOperators } from '../../src/operators.ts';

const operators = jsOperators;
const allowed: ReadonlySet<string> = new Set(['Error', 'Promise.reject']);
const keywords: ReadonlySet<string> = new Set([
  'catch',
  'for',
  'function',
  'if',
  'return',
  'switch',
  'typeof',
  'while',
]);
const targets = [
  'process.kill(pid, 0);',
  "import { rmSync } from 'node:fs';\nrmSync(dir, { recursive: true });",
  "import { spawn } from 'node:child_process';\nspawn(cmd, args, { shell: false });",
];
const corpus = [
  ...operators.map(({ sample }) => sample),
  ...targets,
  'latest = id;\nenv[name] = await load(id);\nthis.total = count(items);',
  'export function last(items: readonly number[]) {\n  return items[items.length - 1];\n}',
  'const limit = 40;\nconst page = rows.slice(0, limit);',
];

function callees(code: string): Set<string> {
  const names = [...code.matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?=\s*\()/g)].map(([name]) => name);

  return new Set(names.filter((name) => !keywords.has(name)));
}

function textAt(source: string, { start, end }: Location): string {
  return source
    .split('\n')
    .slice(start.line, end.line + 1)
    .map((line, index, lines) =>
      line.slice(index === 0 ? start.column : 0, index === lines.length - 1 ? end.column : line.length),
    )
    .join('\n');
}

async function newCallees(operator: LzOperator, source: string): Promise<string[][]> {
  const mutants = await instrumentWith(operator, source);

  return mutants.map(({ location, replacement }) => {
    const before = callees(textAt(source, location));

    return [...callees(replacement)].filter((name) => !before.has(name) && !allowed.has(name));
  });
}

describe('safety', () => {
  lzTestEach(operators.map((operator): readonly [string, LzOperator] => [operator.name, operator]))(
    '%s calls nothing new in its replacements but Error and Promise.reject',
    async (_name, operator) => {
      const found = await Promise.all(corpus.map((source) => newCallees(operator, source)));

      assert.deepEqual(found.flat().flat(), []);
      assert.ok(found.flat().length > 0, `${operator.name} made no mutant in the corpus`);
    },
  );

  lzTestEach([
    [
      'an operator that signals a process',
      'f();',
      (t: Parameters<LzOperator['mutate']>[1]) =>
        t.callExpression(t.memberExpression(t.identifier('process'), t.identifier('kill')), [
          t.memberExpression(t.identifier('process'), t.identifier('pid')),
          t.stringLiteral('SIGKILL'),
        ]),
      (path: NodePath) => path.isCallExpression(),
      [['process.kill']],
    ],
    [
      'an operator that only throws an Error',
      'f();',
      (t: Parameters<LzOperator['mutate']>[1]) => t.newExpression(t.identifier('Error'), []),
      (path: NodePath) => path.isCallExpression(),
      [[]],
    ],
  ])('reports %s', async (_title, source, replacement, where, expected) => {
    const unsafe: LzOperator = {
      name: 'Unsafe',
      sample: '',
      *mutate(path, t) {
        if (where(path)) {
          yield replacement(t);
        }
      },
    };

    assert.deepEqual(await newCallees(unsafe, source), expected);
  });

  lzTestEach(
    operators.flatMap((operator) =>
      targets.map((source): readonly [string, string, LzOperator] => [operator.name, source, operator]),
    ),
  )('%s leaves %j alone', async (_name, source, operator) => {
    assert.deepEqual(await mutantsOf(operator, source), []);
  });

  lzTestEach(operators.map((operator) => [operator.name, operator]))(
    '%s makes a mutant of its own sample',
    async (_name, operator) => {
      assert.notDeepEqual(await mutantsOf(operator, operator.sample), []);
    },
  );
});
