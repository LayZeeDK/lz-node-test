import assert from 'node:assert/strict';
import { describe } from 'node:test';

import type { Location } from '@stryker-mutator/api/core';

import { lzTestEach } from '@layzee/node-test-extensions';
import type { LzOperator } from '@layzee/stryker-mutator-core';
import { instrumentWith, mutantsOf } from '../mutants-of.fixtures.ts';
import { testOperators } from '../../src/operators.ts';

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
  ...testOperators.map(({ sample }) => sample),
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

async function newCallees(operator: LzOperator, source: string): Promise<string[][]> {
  const mutants = await instrumentWith(operator, source);

  return mutants.map(({ location, replacement }) => {
    const before = callees(textAt(source, location));

    return [...callees(replacement)].filter((name) => !before.has(name) && !allowed.has(name));
  });
}

describe('safety', () => {
  lzTestEach(testOperators.map((operator): readonly [string, LzOperator] => [operator.name, operator]))(
    '%s calls nothing new in its replacements but Error and Promise.reject',
    async (_name, operator) => {
      const found = await Promise.all(corpus.map((source) => newCallees(operator, source)));

      assert.deepEqual(found.flat().flat(), []);
      assert.ok(found.flat().length > 0, `${operator.name} made no mutant in the corpus`);
    },
  );

  lzTestEach(
    testOperators.flatMap((operator) =>
      targets.map((source): readonly [string, string, LzOperator] => [operator.name, source, operator]),
    ),
  )('%s leaves %j alone', async (_name, source, operator) => {
    assert.deepEqual(await mutantsOf(operator, source), []);
  });

  lzTestEach(testOperators.map((operator) => [operator.name, operator]))(
    '%s makes a mutant of its own sample',
    async (_name, operator) => {
      assert.notDeepEqual(await mutantsOf(operator, operator.sample), []);
    },
  );
});
