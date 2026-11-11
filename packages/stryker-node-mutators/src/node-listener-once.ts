import { lzPropertyName, type LzMutator } from '@layzee/stryker-mutator-core';

/** Events that fire at most once, so `on` and `once` behave the same for them. */
const oneShot: ReadonlySet<string> = new Set([
  'close',
  'end',
  'finish',
  'exit',
  'beforeExit',
  'ready',
  'listening',
  'open',
  'connect',
  'secureConnect',
  'spawn',
  'prefinish',
  'preReady',
  'start',
  'goaway',
]);
const swaps: ReadonlyMap<string | undefined, string> = new Map([
  ['on', 'once'],
  ['once', 'on'],
]);

/**
 * Swaps `on` and `once`, so a listener meant to run once runs again on every later event, or a listener meant for
 * every event misses the ones after the first. It matches the method name on any receiver, and leaves events that fire
 * at most once and `once('error')`; `on('error')` still becomes `once('error')`.
 */
export const nodeListenerOnce: LzMutator<'LzNodeListenerOnce'> = {
  name: 'LzNodeListenerOnce',
  sample: "emitter.on('data', () => {});\n",
  *mutate(path, t) {
    if (!path.isIdentifier() || path.key !== 'property') {
      return;
    }

    const callee = path.parentPath;
    const call = callee.parentPath;

    if (!callee.isMemberExpression() || callee.key !== 'callee' || !call.isCallExpression()) {
      return;
    }

    const [event, listener] = call.node.arguments;
    const method = lzPropertyName(callee.node);
    const swap = swaps.get(method);

    if (
      event?.type !== 'StringLiteral' ||
      listener === undefined ||
      swap === undefined ||
      oneShot.has(event.value) ||
      (method === 'once' && event.value === 'error')
    ) {
      return;
    }

    yield t.identifier(swap);
  },
};
