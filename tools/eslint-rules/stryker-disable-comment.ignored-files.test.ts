import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import parser from '@typescript-eslint/parser';
import { ESLint, Linter } from 'eslint';
import { configs, expandGlobs, workspaceRoot } from './stryker-configs.fixtures.ts';
import strykerDisableComment from './stryker-disable-comment.ts';

const eslint = new ESLint({ cwd: workspaceRoot });
const mutatedFiles = [...new Set(configs.flatMap(({ mutate }) => expandGlobs(mutate)))];
const unlinted: string[] = [];

for (const file of mutatedFiles) {
  if (await eslint.isPathIgnored(join(workspaceRoot, file))) {
    unlinted.push(file);
  }
}

describe('Stryker disable comments in mutated files that ESLint ignores', () => {
  lzTestEach(unlinted)('%s passes stryker-disable-comment', (file) => {
    const messages = new Linter().verify(
      readFileSync(join(workspaceRoot, file), 'utf8'),
      {
        files: ['**/*.ts'],
        languageOptions: { parser },
        plugins: { lz: { rules: { 'stryker-disable-comment': strykerDisableComment } } },
        rules: { 'lz/stryker-disable-comment': 'error' },
      },
      file,
    );

    assert.deepEqual(
      messages.map(({ line, message }) => `${file}:${String(line)} ${message}`),
      [],
    );
  });
});
