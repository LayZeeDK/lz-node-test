import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { awaitStatement } from '../../src/await-statement.ts';
import { mutantsOf, removalsNextToBuiltIns, strict } from '../mutants-of.fixtures.ts';

describe('LzAwaitStatement', () => {
  lzTestEach([
    ['an awaited call', 'await flush();'],
    ['an awaited method call', 'await server.close();'],
    ['an awaited call in a function', 'export async function stop(server: any) {\n  await server.close();\n}'],
    ['an awaited call that is the body of an if', 'if (ready) await flush();'],
    ["an awaited call of another library's assert", "import { assert } from 'chai';\nawait assert.isRejected(load());"],
  ])('removes the statement of %s', async (_title, source) => {
    assert.deepEqual(await mutantsOf(awaitStatement, source), [';']);
  });

  lzTestEach([
    ['a call that is not awaited', 'flush();'],
    ['an awaited value that is no call', 'await pending;'],
    ['an awaited new expression', 'await new Promise((resolve) => setTimeout(resolve, 10));'],
    ['an awaited call whose value is kept', 'const result = await load();'],
    ['an awaited call whose value is assigned', 'let result;\nresult = await load();'],
    ['a returned await', 'export async function read() {\n  return await load();\n}'],
    ['a for await loop', 'for await (const chunk of stream) {\n}'],
    ['an awaited node:assert statement, which LzAssertStatement removes', `${strict}await assert.rejects(load());`],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(awaitStatement, source), []);
  });

  lzTestEach([
    ['an awaited call', 'await flush(1);', [], ['LzAwaitStatement']],
    ['a call that is not awaited', 'flush(1);', ['CallExpression'], ['CallExpression']],
    ['an awaited call whose argument Stryker mutates', "await flush('x');", [], []],
    ['a call whose argument Stryker mutates', "flush('x');", [], []],
  ])("gives %s exactly the removals next to Stryker's mutators", async (_title, source, alone, together) => {
    assert.deepEqual(await removalsNextToBuiltIns(awaitStatement, source), [alone, together]);
  });
});
