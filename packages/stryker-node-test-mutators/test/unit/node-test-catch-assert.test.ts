import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { nodeTestCatchAssert } from '../../src/node-test-catch-assert.ts';
import { mutantsOf, strict } from '../mutants-of.fixtures.ts';

const test = "import { it } from 'node:test';\n";

describe('LzNodeTestCatchAssert', () => {
  lzTestEach([
    [
      'an assertion of a default import',
      `${strict}try {\n  parse('');\n} catch (error: any) {\n  assert.equal(error.message, 'empty');\n}`,
    ],
    [
      'an assertion of a CommonJS require',
      "const assert = require('node:assert');\ntry {\n  parse('');\n} catch (error) {\n  assert.ok(error);\n}",
    ],
    ['a call of assert itself', `${strict}try {\n  parse('');\n} catch (error) {\n  assert(error);\n}`],
    ['a method of the strict member', `${strict}try {\n  parse('');\n} catch (error) {\n  assert.strict.ok(error);\n}`],
    // fastify/test/hooks-async.test.js:763
    [
      "the test context's assert",
      `${test}it('works', (t) => {\n  try {\n    fastify.addHook('onRequest', async () => {});\n  } catch (e: any) {\n    t.assert.strictEqual(e.code, 'FST_ERR_HOOK_INVALID_ASYNC_HANDLER');\n  }\n});`,
    ],
    [
      'an assert member of a member',
      'function check(x: any) {\n  try {\n    parse();\n  } catch (e) {\n    x.t.assert.ok(e);\n  }\n}',
    ],
    [
      'an assertion in a branch of the catch',
      `${strict}try {\n  parse('');\n} catch (error) {\n  if (error) {\n    assert.ok(error);\n  }\n}`,
    ],
    [
      'an assertion beside a throw in a function',
      `${strict}try {\n  parse('');\n} catch (error) {\n  assert.ok(error);\n  setTimeout(() => {\n    throw error;\n  });\n}`,
    ],
    [
      'a catch with a finally, which stays',
      `${strict}try {\n  parse('');\n} catch (error) {\n  assert.ok(error);\n} finally {\n  done();\n}`,
    ],
    ['a catch without a parameter', `${strict}try {\n  parse('');\n} catch {\n  assert.ok(true);\n}`],
  ])('empties the try block of %s', async (_title, source) => {
    assert.deepEqual(await mutantsOf(nodeTestCatchAssert, source), ['{}']);
  });

  lzTestEach([
    ['a catch that only fails', `${strict}try {\n  parse('');\n} catch (error) {\n  assert.fail(String(error));\n}`],
    [
      "a catch that only calls the test context's fail",
      `${test}it('works', (t) => {\n  try {\n    parse('');\n  } catch {\n    t.assert.fail('threw');\n  }\n});`,
    ],
    [
      'a catch that rethrows',
      `${strict}try {\n  parse('');\n} catch (error) {\n  assert.ok(error);\n  throw error;\n}`,
    ],
    [
      'a catch that throws in a branch',
      `${strict}try {\n  parse('');\n} catch (error) {\n  if (!(error instanceof TypeError)) {\n    throw error;\n  }\n  assert.ok(error);\n}`,
    ],
    ['a catch without an assertion', "try {\n  parse('');\n} catch (error) {\n  console.log(error);\n}"],
    [
      'an assertion in a function inside the catch',
      `${strict}try {\n  parse('');\n} catch (error) {\n  process.nextTick(() => assert.ok(error));\n}`,
    ],
    ['an empty try block', `${strict}try {\n} catch (error) {\n  assert.ok(error);\n}`],
    ['a try without a catch', `${strict}try {\n  parse('');\n} finally {\n  assert.ok(true);\n}`],
    [
      'an assertion in the try block',
      `${strict}try {\n  assert.ok(parse(''));\n} catch (error) {\n  console.log(error);\n}`,
    ],
    [
      'a named import, which syntax does not see',
      "import { strictEqual } from 'node:assert';\ntry {\n  parse('');\n} catch (error) {\n  strictEqual(error, 1);\n}",
    ],
    ['console.assert', "try {\n  parse('');\n} catch (error) {\n  console.assert(error);\n}"],
    ['a computed method', `${strict}try {\n  parse('');\n} catch (error) {\n  assert[method](error);\n}`],
    [
      "a computed method of the test context's assert",
      `${test}it('works', (t: any) => {\n  try {\n    parse('');\n  } catch (e) {\n    t.assert[method](e);\n  }\n});`,
    ],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(nodeTestCatchAssert, source), []);
  });
});
