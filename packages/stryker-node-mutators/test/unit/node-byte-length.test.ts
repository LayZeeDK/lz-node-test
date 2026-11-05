import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { nodeByteLength } from '../../src/node-byte-length.ts';
import { mutantsOf } from '../mutants-of.fixtures.ts';

describe('LzNodeByteLength', () => {
  lzTestEach([
    ['the byte length of a string', 'const size = Buffer.byteLength(text);', ['text.length']],
    ["the byte length in 'utf8'", "const size = Buffer.byteLength(text, 'utf8');", ['text.length']],
    ["the byte length in 'utf-8'", "const size = Buffer.byteLength(text, 'utf-8');", ['text.length']],
    ['the byte length of a member', 'const size = Buffer.byteLength(bufs[last]);', ['bufs[last].length']],
    [
      'the byte length of a call',
      'const size = Buffer.byteLength(JSON.stringify(body));',
      ['JSON.stringify(body).length'],
    ],
    ['the byte length of a sum', 'const size = Buffer.byteLength(head + body);', ['(head + body).length']],
    [
      'the byte length in a condition',
      'if (Buffer.byteLength(payload) <= max) {\n  send(payload);\n}',
      ['payload.length'],
    ],
    [
      'the byte length in a function',
      "export function header(body: string) {\n  return '' + Buffer.byteLength(body);\n}",
      ['body.length'],
    ],
  ])('turns %s into its length', async (_title, source, expected) => {
    assert.deepEqual(await mutantsOf(nodeByteLength, source), expected);
  });

  lzTestEach([
    ['a byte length without an argument', 'const size = Buffer.byteLength();'],
    ['a spread argument', 'const size = Buffer.byteLength(...args);'],
    ["the 'latin1' encoding", "const size = Buffer.byteLength(text, 'latin1');"],
    ["the 'base64' encoding", "const size = Buffer.byteLength(text, 'base64');"],
    ['an encoding that is not a literal', 'const size = Buffer.byteLength(text, encoding);'],
    ["an upper-case 'UTF8'", "const size = Buffer.byteLength(text, 'UTF8');"],
    ['a Buffer.from result', 'const size = Buffer.byteLength(Buffer.from(text));'],
    ['a Buffer.alloc result', 'const size = Buffer.byteLength(Buffer.alloc(4));'],
    ['a Buffer.concat result', 'const size = Buffer.byteLength(Buffer.concat(chunks));'],
    ['a read of the method', 'const measure = Buffer.byteLength;'],
    ['a computed member', "const size = Buffer['byteLength'](text);"],
    ['another method of Buffer', 'const size = Buffer.compare(a, b);'],
    ['the byteLength of another object', 'const size = buffer.byteLength(text);'],
    [
      'a Buffer of its own',
      'function size(Buffer: { byteLength(text: string): number }, text: string) {\n  return Buffer.byteLength(text);\n}',
    ],
    ['the Buffer of node:buffer', "import { Buffer } from 'node:buffer';\nconst size = Buffer.byteLength(text);"],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(nodeByteLength, source), []);
  });
});
