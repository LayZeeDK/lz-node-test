import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseSync, traverse, types } from '@babel/core';

import { lzTestEach } from '@layzee/lz-node-test';
import { returnAwait } from '../../src/return-await.ts';
import { mutantsOf } from '../mutants-of.fixtures.ts';

const guarded = (body: string) =>
  `export async function read() {\n  try {\n    ${body}\n  } catch {\n    return 0;\n  }\n}`;

describe('LzReturnAwait', () => {
  lzTestEach([
    ['a function', guarded('return await load();')],
    [
      'an arrow function',
      'const read = async () => {\n  try {\n    return await load();\n  } finally {\n    done();\n  }\n};',
    ],
    ['a block nested in the try block', guarded('if (ready) {\n      return await load();\n    }')],
    [
      'a function, through a catch block with no finally block',
      guarded('try {\n      check();\n    } catch {\n      return await load();\n    }'),
    ],
  ])('returns the promise unawaited from the try block of %s', async (_title, source) => {
    assert.deepEqual(await mutantsOf(returnAwait, source), ['load()']);
  });

  it('returns the promise unawaited from a catch block that a finally block follows', async () => {
    const source =
      'export async function read() {\n  try {\n    return 1;\n  } catch {\n    return await load();\n  } finally {\n    done();\n  }\n}';

    assert.deepEqual(await mutantsOf(returnAwait, source), ['load()']);
  });

  lzTestEach([
    ['a return await outside a try', 'export async function read() {\n  return await load();\n}'],
    [
      'a return await in a catch block with no finally block',
      'export async function read() {\n  try {\n    return 1;\n  } catch {\n    return await load();\n  }\n}',
    ],
    [
      'a return await in a finally block',
      'export async function read() {\n  try {\n    return 1;\n  } finally {\n    return await load();\n  }\n}',
    ],
    [
      'a return await in a function inside a try block',
      guarded('return [1].map(async () => {\n  return await load();\n});'),
    ],
    [
      "a return await in an async generator's try block, where return awaits too",
      'export async function* read() {\n  try {\n    return await load();\n  } catch {\n    return 0;\n  }\n}',
    ],
    ['an await that is not returned', guarded('await load();\n    return 1;')],
    ['an await that is part of the returned value', guarded('return (await load()).value;')],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(returnAwait, source), []);
  });

  it('leaves alone a return await at the top level of a script that allows a return outside a function', () => {
    const file = parseSync('return await load();\n', {
      babelrc: false,
      configFile: false,
      parserOpts: { allowReturnOutsideFunction: true },
    });
    assert.ok(file);
    const mutants: unknown[] = [];
    traverse(file, {
      AwaitExpression(path) {
        mutants.push(...returnAwait.mutate(path, types));
      },
    });

    assert.deepEqual(mutants, []);
  });
});
