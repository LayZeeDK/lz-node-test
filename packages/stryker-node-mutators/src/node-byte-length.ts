import type { NodePath, types } from '@babel/core';

import { lzPropertyName, type LzOperator } from '@layzee/stryker-mutator-core';

const bufferResults: ReadonlySet<string | undefined> = new Set([
  'from',
  'alloc',
  'allocUnsafe',
  'allocUnsafeSlow',
  'concat',
]);
const utf8: ReadonlySet<string> = new Set(['utf8', 'utf-8']);

/**
 * `Buffer.byteLength(text)` becomes `text.length`, the mistake of counting a string's characters as its bytes. A
 * `'utf8'` encoding counts too. A Buffer's length is its byte length, so the result of a Buffer factory such as
 * `Buffer.from` is left out.
 */
export const nodeByteLength: LzOperator<'LzNodeByteLength'> = {
  name: 'LzNodeByteLength',
  sample: 'export const size = Buffer.byteLength(text);\n',
  *mutate(path, t) {
    if (!path.isCallExpression() || bufferMethod(path) !== 'byteLength') {
      return;
    }

    const [text, encoding] = path.get('arguments');

    if (
      text === undefined ||
      !text.isExpression() ||
      (text.isCallExpression() && bufferResults.has(bufferMethod(text))) ||
      (encoding !== undefined && !(encoding.isStringLiteral() && utf8.has(encoding.node.value)))
    ) {
      return;
    }

    yield t.memberExpression(t.cloneNode(text.node), t.identifier('length'));
  },
};

/** The method of the global `Buffer` that `call` calls, if any. */
function bufferMethod(call: NodePath<types.CallExpression>): string | undefined {
  const { callee } = call.node;

  if (
    callee.type !== 'MemberExpression' ||
    callee.object.type !== 'Identifier' ||
    callee.object.name !== 'Buffer' ||
    call.scope.hasBinding('Buffer')
  ) {
    return undefined;
  }

  return lzPropertyName(callee);
}
