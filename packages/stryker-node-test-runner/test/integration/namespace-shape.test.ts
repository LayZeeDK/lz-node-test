import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';

// Stryker's mutant switches read this namespace in every instrumented function. An object that V8 has moved to
// dictionary mode, as deleting a property that is not the last one added does, makes V8 deoptimize them, and tests
// that check V8's optimization, such as fast-json-stringify's test/deopt.test.js on Node.js 22, then fail.
const child = [
  `import { install } from ${JSON.stringify(new URL('../../src/hook-core.ts', import.meta.url).href)};`,
  `import { envNames } from ${JSON.stringify(new URL('../../src/record.ts', import.meta.url).href)};`,
  `import { lzCurrentTests } from ${JSON.stringify(new URL('../../src/wrap.ts', import.meta.url).href)};`,
  `import { harness, out } from ${JSON.stringify(new URL('../hook-core.fixtures.ts', import.meta.url).href)};`,
  'const ended = {};',
  "const end = lzCurrentTests({ ns: ended, env: {}, now: () => 0 }).makeCurrent('a.test.ts > first');",
  'ended.mutantCoverage = { static: {}, perTest: {} };',
  'end();',
  'const { deps } = harness({ [envNames.out]: out });',
  "const installed = { currentTestId: 'stale', mutantCoverage: { static: {}, perTest: {} } };",
  'deps.global.__stryker__ = installed;',
  'install(deps);',
  'console.log(JSON.stringify({',
  '  ended: [ended.currentTestId, %HasFastProperties(ended)],',
  '  installed: [installed.currentTestId, %HasFastProperties(installed)],',
  '}));',
].join('\n');

describe("Stryker's namespace", () => {
  it('keeps fast properties when a test ends and when the hook attributes the process to no test', () => {
    const run = spawnSync(process.execPath, ['--allow-natives-syntax', '--input-type=module', '-e', child], {
      encoding: 'utf8',
      windowsHide: true,
    });

    assert.equal(run.status, 0, run.stderr);
    const shapes: unknown = JSON.parse(run.stdout);
    assert.deepEqual(shapes, { ended: ['', true], installed: ['', true] });
  });
});
