import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import type { LzMutator } from '@layzee/stryker-mutator-core';
import { lzAssertMethod } from '../../src/bindings.ts';
import { mutantsOf } from '../mutants-of.fixtures.ts';

const probe: LzMutator = {
  name: 'Probe',
  sample: '',
  *mutate(path, t) {
    const method = path.isCallExpression() ? lzAssertMethod(path, path.node.callee) : undefined;

    if (method !== undefined) {
      yield t.stringLiteral(method);
    }
  },
};

describe('lzAssertMethod', () => {
  lzTestEach([
    ['a call of the default import', "import assert from 'node:assert';\nassert(x);", ['"ok"']],
    ['a method of the default import', "import assert from 'node:assert/strict';\nassert.equal(x, 1);", ['"equal"']],
    ['a named import', "import { throws } from 'assert';\nthrows(f);", ['"throws"']],
    ['a renamed import', "import { rejects as fails } from 'assert/strict';\nfails(p);", ['"rejects"']],
    ['a method of a member', "import * as assert from 'node:assert';\nassert.strict.fail();", ['"fail"']],
    ["the test context's assert", 'function check(t: any) {\n  t.assert.match(x, /y/);\n}', ['"match"']],
    ['a computed method', "import assert from 'node:assert';\nassert['equal'](x, 1);", []],
    ['another module', "import assert from 'other';\nassert.equal(x, 1);", []],
    ['a function of its own', 'function assert(x: unknown) {}\nassert(x);', []],
    ["a context's assert called itself", 'function check(t: any) {\n  t.assert(x);\n}', []],
    ["a context's member other than assert", 'function check(t: any) {\n  t.other.match(x, /y/);\n}', []],
    ['an assert under another member', 'function check(t: any) {\n  t.inner.assert.match(x, /y/);\n}', []],
    ['an assert of a value that is no parameter', 'const t: any = {};\nt.assert.match(x, /y/);', []],
  ])('finds the method of %s', async (_title, source, expected) => {
    assert.deepEqual(await mutantsOf(probe, source), expected);
  });
});
