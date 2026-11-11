import assert from 'node:assert/strict';
import { describe } from 'node:test';

import type { NodePath } from '@babel/core';
import type { Location } from '@stryker-mutator/api/core';

import { lzTestEach } from '@layzee/node-test-extensions';
import type { LzMutator } from '@layzee/stryker-mutator-core';
import { instrumentWith, mutantsOf } from '../mutants-of.fixtures.ts';
import { testMutators } from '../../src/mutators.ts';

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
  ...testMutators.map(({ sample }) => sample),
  ...targets,
  [
    "import assert from 'node:assert/strict';",
    'assert.equal(compute(), 1);',
    '[1].forEach((n) => assert.ok(check(n)));',
    'await assert.rejects(load());',
    'const settled = async () => await assert.rejects(load());',
    "assert.throws(() => parse(''), /empty/);",
  ].join('\n'),
  "import { it } from 'node:test';\nit('works', (t) => {\n  t.assert.deepEqual(run(), []);\n});",
  "import { it } from 'node:test';\nit('rejects a bad id', { expectFailure: /bad id/ }, () => parse('x'));",
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

async function newCallees(mutator: LzMutator, source: string): Promise<string[][]> {
  const mutants = await instrumentWith(mutator, source);

  return mutants.map(({ location, replacement }) => {
    const before = callees(textAt(source, location));

    return [...callees(replacement)].filter((name) => !before.has(name) && !allowed.has(name));
  });
}

describe('safety', () => {
  lzTestEach(testMutators.map((mutator): readonly [string, LzMutator] => [mutator.name, mutator]))(
    '%s calls nothing new in its replacements but Error and Promise.reject',
    async (_name, mutator) => {
      const found = await Promise.all(corpus.map((source) => newCallees(mutator, source)));

      assert.deepEqual(found.flat().flat(), []);
      assert.ok(found.flat().length > 0, `${mutator.name} made no mutant in the corpus`);
    },
  );

  lzTestEach([
    [
      'a mutator that signals a process',
      'f();',
      (t: Parameters<LzMutator['mutate']>[1]) =>
        t.callExpression(t.memberExpression(t.identifier('process'), t.identifier('kill')), [
          t.memberExpression(t.identifier('process'), t.identifier('pid')),
          t.stringLiteral('SIGKILL'),
        ]),
      (path: NodePath) => path.isCallExpression(),
      [['process.kill']],
    ],
    [
      "the first design of LzNodeTestAssertCall's arrow body, which fails through node:assert",
      "import assert from 'node:assert/strict';\n[1].forEach((n) => assert.ok(n));",
      (t: Parameters<LzMutator['mutate']>[1]) =>
        t.callExpression(
          t.memberExpression(
            t.callExpression(t.memberExpression(t.identifier('process'), t.identifier('getBuiltinModule')), [
              t.stringLiteral('node:assert'),
            ]),
            t.identifier('fail'),
          ),
          [t.stringLiteral('Stryker: assertion reached')],
        ),
      (path: NodePath) => path.isCallExpression() && path.parent.type === 'ArrowFunctionExpression',
      [['process.getBuiltinModule', 'fail']],
    ],
    [
      'a mutator that only throws an Error',
      'f();',
      (t: Parameters<LzMutator['mutate']>[1]) => t.newExpression(t.identifier('Error'), []),
      (path: NodePath) => path.isCallExpression(),
      [[]],
    ],
  ])('reports %s', async (_title, source, replacement, where, expected) => {
    const unsafe: LzMutator = {
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
    testMutators.flatMap((mutator) =>
      targets.map((source): readonly [string, string, LzMutator] => [mutator.name, source, mutator]),
    ),
  )('%s leaves %j alone', async (_name, source, mutator) => {
    assert.deepEqual(await mutantsOf(mutator, source), []);
  });

  lzTestEach(testMutators.map((mutator) => [mutator.name, mutator]))(
    '%s makes a mutant of its own sample',
    async (_name, mutator) => {
      assert.notDeepEqual(await mutantsOf(mutator, mutator.sample), []);
    },
  );
});
