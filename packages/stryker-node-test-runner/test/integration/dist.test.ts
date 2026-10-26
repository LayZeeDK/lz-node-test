import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';

import ts from 'typescript';

const DIST = join(import.meta.dirname, '..', '..', 'dist');

/** The string literals and template pieces of `file` that end in `.ts`, as `file: text`, comments aside. */
function tsLiterals(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(join(DIST, file), 'utf8'), ts.ScriptTarget.Latest);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node)) &&
      node.text.endsWith('.ts')
    ) {
      found.push(`${file}: ${node.text}`);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

it('names no .ts file in the built JavaScript, where only .js files exist', () => {
  const files = readdirSync(DIST).filter((name) => name.endsWith('.js'));

  assert.notDeepEqual(files, []);
  assert.deepEqual(files.flatMap(tsLiterals), []);
});
