import { lzPropertyName, type LzOperator } from '@layzee/stryker-mutator-core';

const callbacks: ReadonlySet<string> = new Set(['cb', 'callback', 'done', 'next']);
const errors: ReadonlySet<string> = new Set(['err', 'error', 'e', 'er']);

/**
 * `cb(err)` becomes `cb()`, and `stream.destroy(err)` becomes `stream.destroy()`: the callback still runs, but the error
 * it was handed is dropped. The names decide: a callee named `cb`, `callback`, `done` or `next`, or any `destroy`
 * method, called with one argument named `err`, `error`, `e` or `er`.
 */
export const nodeCallbackError: LzOperator = {
  name: 'LzNodeCallbackError',
  sample: 'export function end(err: Error, cb: (error?: Error) => void) {\n  cb(err);\n}\n',
  *mutate(path, t) {
    if (!path.isCallExpression() || path.node.arguments.length !== 1) {
      return;
    }

    const {
      callee,
      arguments: [argument],
    } = path.node;

    if (argument?.type !== 'Identifier' || !errors.has(argument.name)) {
      return;
    }

    if ((callee.type === 'Identifier' && callbacks.has(callee.name)) || lzPropertyName(callee) === 'destroy') {
      yield t.callExpression(t.cloneNode(callee), []);
    }
  },
};
