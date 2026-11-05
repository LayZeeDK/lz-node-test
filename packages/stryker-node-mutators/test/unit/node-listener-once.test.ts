import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { mutantsOf } from '../mutants-of.fixtures.ts';
import { nodeListenerOnce } from '../../src/node-listener-once.ts';

const oneShotEvents = [
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
];

describe('LzNodeListenerOnce', () => {
  lzTestEach([
    ['on', "emitter.on('data', f);", "emitter.once('data', f)"],
    ['once', "emitter.once('data', f);", "emitter.on('data', f)"],
    ["an error's on", "stream.on('error', f);", "stream.once('error', f)"],
    // sonic-boom/index.js:335
    ["this's on", "this.on('newListener', f);", "this.once('newListener', f)"],
    // restartable/index.js:45
    ['a once of a request', "server.once('request', handler);", "server.on('request', handler)"],
    ['the on of a member', "fastify.server.on('upgrade', f);", "fastify.server.once('upgrade', f)"],
    ["the process's on", "process.on('SIGINT', f);", "process.once('SIGINT', f)"],
    ['an on whose value is used', "const self = emitter.on('data', f);", "emitter.once('data', f)"],
    ['an on with more arguments', "emitter.on('data', f, extra);", "emitter.once('data', f, extra)"],
  ])('swaps %s', async (_title, source, expected) => {
    assert.deepEqual(await mutantsOf(nodeListenerOnce, source), [expected]);
  });

  lzTestEach([
    ...oneShotEvents.flatMap((event): [string, string][] => [
      [`on of the one-shot ${event}`, `emitter.on('${event}', f);`],
      [`once of the one-shot ${event}`, `emitter.once('${event}', f);`],
    ]),
    ["an error's once", "stream.once('error', f);"],
    ['an on without a listener', "emitter.on('data');"],
    ['an on without arguments', 'emitter.on();'],
    ['an event in a template literal', 'emitter.on(`data`, f);'],
    ['an event read from a variable', 'emitter.on(event, f);'],
    ['a name after the listener', "emitter.on(f, 'data');"],
    ['a computed on', "emitter['on']('data', f);"],
    ['an on read from a variable', "emitter[on]('data', f);"],
    ['a function on of its own', "on('data', f);"],
    ['addListener', "emitter.addListener('data', f);"],
    ['prependListener', "emitter.prependListener('data', f);"],
    ['prependOnceListener', "emitter.prependOnceListener('data', f);"],
    ['off', "emitter.off('data', f);"],
    ['emit', "emitter.emit('data', value);"],
    ['addEventListener', "target.addEventListener('data', f);"],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(nodeListenerOnce, source), []);
  });
});
