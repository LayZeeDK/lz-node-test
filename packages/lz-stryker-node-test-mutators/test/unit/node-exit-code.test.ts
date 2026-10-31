import assert from 'node:assert/strict';
import { describe } from 'node:test';

import { lzTestEach } from '@layzee/lz-node-test';
import { nodeExitCode } from '../../src/node-exit-code.ts';
import { mutantsOf } from '../mutants-of.fixtures.ts';

describe('LzNodeExitCode', () => {
  lzTestEach([
    ['a failure into a success', 'process.exitCode = 1;', ['0']],
    ['another failure code into a success', 'process.exitCode = 2;', ['0']],
    ['a success into a failure', 'process.exitCode = 0;', ['1']],
    ['the exit code set in a function', 'export function fail() {\n  process.exitCode = 1;\n}', ['0']],
    ['the exit code of node:process', "import process from 'node:process';\nprocess.exitCode = 1;", ['0']],
    ['the exit code of a renamed process', "import * as proc from 'process';\nproc.exitCode = 1;", ['0']],
  ])('turns %s', async (_title, source, expected) => {
    assert.deepEqual(await mutantsOf(nodeExitCode, source), expected);
  });

  lzTestEach([
    ['an exit code that is not a literal', 'process.exitCode = code;'],
    ['a string exit code', "process.exitCode = '1';"],
    ['a compound assignment', 'process.exitCode += 1;'],
    ['a read of the exit code', 'const failed = process.exitCode === 1;'],
    ['a computed member', "process['exitCode'] = 1;"],
    ['the exit code of another object', 'child.exitCode = 1;'],
    ['another member of process', 'process.exitCodes = 1;'],
    ['a process of its own', 'function end(process: { exitCode: number }) {\n  process.exitCode = 1;\n}'],
    ['a process of another module', "import process from './process.ts';\nprocess.exitCode = 1;"],
  ])('leaves %s alone', async (_title, source) => {
    assert.deepEqual(await mutantsOf(nodeExitCode, source), []);
  });
});
