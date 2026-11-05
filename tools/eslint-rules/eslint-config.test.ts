import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { ESLint } from 'eslint';

const workspaceRoot = join(import.meta.dirname, '..', '..');
const testFile = 'packages/stryker-node-mutators/test/unit/operators.test.ts';

async function reports(code: string, file: string, ruleId: string): Promise<readonly string[]> {
  const eslint = new ESLint({ cwd: workspaceRoot });
  const [result] = await eslint.lintText(code, { filePath: join(workspaceRoot, file) });
  assert.ok(result, 'ESLint returned no result');

  return result.messages.filter((message) => message.ruleId === ruleId).map(({ message }) => message);
}

describe('the .only guard', () => {
  lzTestEach(['lzTestEach', 'lzTestFor'])('reports %s.only in a test', async (name) => {
    const found = await reports(`${name}.only([1])('case %s', () => {});\n`, testFile, 'no-restricted-properties');

    assert.equal(found.length, 1);
    assert.match(found[0] ?? '', /Remove \.only before committing/);
  });

  lzTestEach(['lzTestEach', 'lzTestFor'])('leaves %s.skip alone', async (name) => {
    const found = await reports(`${name}.skip([1])('case %s', () => {});\n`, testFile, 'no-restricted-properties');

    assert.deepEqual(found, []);
  });
});

describe('curly', () => {
  lzTestEach([
    'packages/node-test-extensions/src/title.ts',
    testFile,
    'tools/eslint-rules/index.ts',
    'stryker.base.mjs',
  ])('reports a braceless control body in %s', async (file) => {
    const found = await reports(
      'export function f(x) {\n  if (x) return 1;\n  else x++;\n  for (;;) x++;\n  while (x) x--;\n}\n',
      file,
      'curly',
    );

    assert.equal(found.length, 4);
  });
});
