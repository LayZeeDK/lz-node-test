import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';
import { assertStatement } from '../../src/assert-statement.ts';
import { resolveFromCore } from '../../src/install.ts';
import { mutantsOf } from '../mutants-of.fixtures.ts';
import { isOwn, toNodeMutator } from '../../src/operator.ts';

const strict = "import assert from 'node:assert/strict';\n";

describe('LzAssertStatement', () => {
  lzTestEach([
    ['a default import', `${strict}assert.equal(state, 'ready');`],
    ['a default import called itself', "import assert from 'node:assert';\nassert(ready);"],
    ['a namespace import', "import * as assert from 'assert';\nassert.ok(ready);"],
    ['a renamed import', "import { strictEqual as same } from 'assert/strict';\nsame(state, 'ready');"],
    ['fail, which marks code that never runs', `${strict}assert.fail('unreachable');`],
    ['an awaited assertion', `${strict}await assert.rejects(promise);`],
  ])('removes the statement of %s', async (_title, source) => {
    assert.deepEqual(await mutantsOf(assertStatement, source), [';']);
  });

  lzTestEach([
    ['console.assert', 'console.assert(ready);'],
    ['an assert of another library', "import { assert } from 'chai';\nassert.ok(ready);"],
    ['a function of its own named assert', 'function assert(value: unknown) {}\nassert(ready);'],
    ["a test context's assert", 'function check(t: any) {\n  t.assert.ok(ready);\n}'],
    ['an assertion whose value is used', `${strict}const result = assert.ok(ready);`],
    ['an assertion reached through an array', `${strict}[assert][0].ok(ready);`],
    ['a statement that is no call', `${strict}assert;`],
    // pino-pretty/node_modules/@jsumners/assert-match/index.js:44
    [
      'node:assert as the default of a parameter',
      "import nodeAssert from 'node:assert';\nfunction match(actual: unknown, { assert = nodeAssert } = {}) {\n  assert.ok(actual);\n}",
    ],
    // fast-json-stringify/index.js:109
    ['a throw statement', `${strict}if (!ready) throw new assert.AssertionError({ message: 'not ready' });`],
    // fast-json-stringify/index.js:576
    ['an assertion in generated source', `${strict}new Function('assert', 'assert.ok(ready)');`],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(assertStatement, source), []);
  });

  lzTestEach([
    ['whose arguments Stryker mutates, and which Stryker alone keeps', `${strict}assert.equal(state, 'ready');`, []],
    [
      'whose arguments Stryker leaves, and which Stryker alone removes',
      "import assert from 'node:assert';\nassert(ready);",
      ['CallExpression'],
    ],
  ])("gives an assertion %s exactly one removal next to Stryker's mutators, its own", async (_title, source, alone) => {
    const instrumenter = await resolveFromCore();
    const builtIns = instrumenter.allMutators.filter((mutator) => !isOwn(mutator));
    const removals = async (mutators: typeof builtIns) =>
      (await instrumenter.instrument([{ name: 'sample.ts', content: source }], mutators))
        .filter(({ replacement }) => replacement === ';')
        .map(({ mutatorName }) => mutatorName);

    assert.deepEqual(
      [await removals(builtIns), await removals([...builtIns, toNodeMutator(assertStatement, instrumenter.types)])],
      [alone, ['LzAssertStatement']],
    );
  });
});
