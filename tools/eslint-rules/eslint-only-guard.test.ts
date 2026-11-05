import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { ESLint } from 'eslint';

const workspaceRoot = join(import.meta.dirname, '..', '..');
const testFile = join(workspaceRoot, 'packages/stryker-node-mutators/test/unit/operators.test.ts');

async function onlyReports(code: string): Promise<readonly string[]> {
  const eslint = new ESLint({ cwd: workspaceRoot });
  const [result] = await eslint.lintText(code, { filePath: testFile });
  assert.ok(result, 'ESLint returned no result');

  return result.messages.filter(({ ruleId }) => ruleId === 'no-restricted-properties').map(({ message }) => message);
}

describe('the .only guard', () => {
  lzTestEach(['lzTestEach', 'lzTestFor'])('reports %s.only in a test', async (name) => {
    const reports = await onlyReports(`${name}.only([1])('case %s', () => {});\n`);

    assert.equal(reports.length, 1);
    assert.match(reports[0] ?? '', /Remove \.only before committing/);
  });

  lzTestEach(['lzTestEach', 'lzTestFor'])('leaves %s.skip alone', async (name) => {
    const reports = await onlyReports(`${name}.skip([1])('case %s', () => {});\n`);

    assert.deepEqual(reports, []);
  });
});
