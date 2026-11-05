import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/node-test-extensions';
import { nodeCallbackError } from '../../src/node-callback-error.ts';
import { mutantsOf } from '../mutants-of.fixtures.ts';

describe('LzNodeCallbackError', () => {
  lzTestEach([
    ['cb(err)', 'cb(err);', ['cb()']],
    ['callback(error)', 'callback(error);', ['callback()']],
    ['done(e)', 'done(e);', ['done()']],
    ['next(er)', 'next(er);', ['next()']],
    ['a callback returned', 'function end(err: Error, cb: (error?: Error) => void) {\n  return cb(err);\n}', ['cb()']],
    ['a callback in a catch block', 'try {\n  run();\n} catch (e) {\n  done(e);\n}', ['done()']],
    ['stream.destroy(err)', 'stream.destroy(err);', ['stream.destroy()']],
    [
      'this.destroy(error)',
      'class Sink {\n  fail(error: Error) {\n    this.destroy(error);\n  }\n}',
      ['this.destroy()'],
    ],
  ])('drops the error of %s', async (_title, source, expected) => {
    assert.deepEqual(await mutantsOf(nodeCallbackError, source), expected);
  });

  lzTestEach([
    ['a call without an argument', 'cb();'],
    ['a null argument', 'cb(null);'],
    ['an undefined argument', 'cb(undefined);'],
    ['a second argument', 'cb(err, value);'],
    ['an argument with another name', 'cb(result);'],
    ['a member of the error', 'cb(err.message);'],
    ['a new error', "cb(new Error('closed'));"],
    ['a spread error', 'cb(...err);'],
    ['a callee with another name', 'handler(err);'],
    ['a callback that is a member', 'this.cb(err);'],
    ['a computed destroy', "stream['destroy'](err);"],
    ['another method', 'stream.close(err);'],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(nodeCallbackError, source), []);
  });
});
