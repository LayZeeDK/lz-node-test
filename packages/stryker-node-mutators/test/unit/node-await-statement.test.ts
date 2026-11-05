import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { nodeAwaitStatement } from '../../src/node-await-statement.ts';
import { mutantsOf, removalsNextToBuiltIns, strict } from '../mutants-of.fixtures.ts';

describe('LzNodeAwaitStatement', () => {
  lzTestEach([
    ['an awaited call', 'await flush();'],
    ['an awaited method call', 'await server.close();'],
    ['an awaited call in a function', 'export async function stop(server: any) {\n  await server.close();\n}'],
    ['an awaited call that is the body of an if', 'if (ready) await flush();'],
    ["an awaited call of another library's assert", "import { assert } from 'chai';\nawait assert.isRejected(load());"],
    [
      "an awaited call in a fastify plugin's after callback",
      'export async function plugin(app: any) {\n  app.after(async () => {\n    await app.ready();\n  });\n}',
    ],
    [
      'an awaited call in the after callback of another library',
      "import { after } from 'mocha';\nafter(async () => {\n  await server.close();\n});",
    ],
    [
      'an awaited call in a node:test before callback',
      "import { before } from 'node:test';\nbefore(async () => {\n  await server.listen();\n});",
    ],
  ])('removes the statement of %s', async (_title, source) => {
    assert.deepEqual(await mutantsOf(nodeAwaitStatement, source), [';']);
  });

  lzTestEach([
    ['a call that is not awaited', 'flush();'],
    ['an awaited value that is no call', 'await pending;'],
    ['an awaited new expression', 'await new Promise((resolve) => setTimeout(resolve, 10));'],
    ['an awaited call whose value is kept', 'const result = await load();'],
    ['an awaited call whose value is assigned', 'let result;\nresult = await load();'],
    ['a returned await', 'export async function read() {\n  return await load();\n}'],
    ['a for await loop', 'for await (const chunk of stream) {\n}'],
    ['an awaited node:assert statement, which LzNodeAssertStatement removes', `${strict}await assert.rejects(load());`],
    [
      'an awaited call in a node:test after callback',
      "import { after } from 'node:test';\nafter(async () => {\n  await server.close();\n});",
    ],
    [
      'an awaited call in a node:test afterEach callback',
      "import { afterEach as cleanUp } from 'test';\ncleanUp(async () => {\n  await server.close();\n});",
    ],
    [
      "an awaited call in a test context's after callback",
      "import test from 'node:test';\ntest('closes', async (t) => {\n  t.after(async () => {\n    await app.close();\n  });\n});",
    ],
    [
      "an awaited call in a subtest context's afterEach callback",
      "import { test } from 'node:test';\ntest('outer', async (t) => {\n  t.test('inner', async (s) => {\n    s.afterEach(async () => {\n      await app.close();\n    });\n  });\n});",
    ],
    [
      "an awaited call in an after callback of node:test's default export",
      "import test from 'node:test';\ntest.after(async () => {\n  await server.close();\n});",
    ],
    [
      'an awaited call in an afterEach callback of a node:test namespace import',
      "import * as nt from 'node:test';\nnt.afterEach(async () => {\n  await server.close();\n});",
    ],
    [
      'an awaited call nested in a function inside a node:test after callback',
      "import { after } from 'node:test';\nafter(() => Promise.all(servers.map(async (server) => {\n  await server.close();\n})));",
    ],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(nodeAwaitStatement, source), []);
  });

  lzTestEach([
    ['an awaited call', 'await flush(1);', [], ['LzNodeAwaitStatement']],
    ['a call that is not awaited', 'flush(1);', ['CallExpression'], ['CallExpression']],
    ['an awaited call whose argument Stryker mutates', "await flush('x');", [], []],
    ['a call whose argument Stryker mutates', "flush('x');", [], []],
  ])("gives %s exactly the removals next to Stryker's mutators", async (_title, source, alone, together) => {
    assert.deepEqual(await removalsNextToBuiltIns(nodeAwaitStatement, source), [alone, together]);
  });
});
