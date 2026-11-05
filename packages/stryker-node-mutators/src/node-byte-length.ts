import type { NodePath, types } from '@babel/core';

import { lzPropertyName, type LzOperator } from '@layzee/stryker-mutator-core';

const byteLength: ReadonlySet<string | undefined> = new Set(['byteLength']);
const bufferResults: ReadonlySet<string | undefined> = new Set(['from', 'alloc', 'concat']);
const utf8: ReadonlySet<string> = new Set(['utf8', 'utf-8']);

/**
 * `Buffer.byteLength(text)` becomes `text.length`, the mistake of counting a string's characters as its bytes. A
 * `'utf8'` encoding counts too. A Buffer's length is its byte length, so a `Buffer.from`, `Buffer.alloc` or
 * `Buffer.concat` result is left out.
 */
export const nodeByteLength: LzOperator = {
  name: 'LzNodeByteLength',
  sample: 'export const size = Buffer.byteLength(text);\n',
  *mutate(path, t) {
    if (!path.isCallExpression() || !isBufferCall(path, path.node, byteLength)) {
      return;
    }

    const [text, encoding] = path.get('arguments');

    if (
      text === undefined ||
      !text.isExpression() ||
      (text.isCallExpression() && isBufferCall(text, text.node, bufferResults)) ||
      (encoding !== undefined && !(encoding.isStringLiteral() && utf8.has(encoding.node.value)))
    ) {
      return;
    }

    yield t.memberExpression(t.cloneNode(text.node), t.identifier('length'));
  },
};

/** A call of one of `methods` on the global `Buffer`. */
function isBufferCall(path: NodePath, call: types.CallExpression, methods: ReadonlySet<string | undefined>): boolean {
  const { callee } = call;

  return (
    callee.type === 'MemberExpression' &&
    methods.has(lzPropertyName(callee)) &&
    callee.object.type === 'Identifier' &&
    callee.object.name === 'Buffer' &&
    !path.scope.hasBinding('Buffer')
  );
}
