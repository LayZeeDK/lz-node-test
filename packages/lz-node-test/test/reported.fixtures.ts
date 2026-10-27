import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, run, type EventData, type TestContext } from 'node:test';

import ts from 'typescript';

const testEach = new URL('../src/test-each.ts', import.meta.url).href;
const testFor = new URL('../src/test-for.ts', import.meta.url).href;

export const signatures = {
  name: 'TypeError',
  message:
    'lzTestEach and lzTestFor tables take (name, fn), (name, fn, timeout) or (name, options, fn); ' +
    'pass options as the second argument and a single function.',
};

/** A test node:test reported: its outcome, its skip and todo marks, and the message of the error it failed with. */
export interface Reported {
  readonly name: string;
  readonly outcome: 'pass' | 'fail';
  readonly skip?: true;
  readonly todo?: true;
  readonly error?: string;
}

/** Fails the test with its arguments as JSON, so the error tells what the test's body got. */
export function report(...args: unknown[]): never {
  throw new Error(JSON.stringify(args));
}

declare module 'node:test' {
  namespace test {
    interface TestContextAssert {
      /**
       * Runs a test file that calls `cases` and asserts that node:test reports `expected`, in order. The file has
       * `lzTestEach`, `lzTestFor` and `report` and nothing else of the caller's, so `cases` can use only those and globals.
       * With `only`, node:test runs only the tests marked only.
       */
      reports(cases: () => void, expected: Reported[], options?: { readonly only?: boolean }): Promise<void>;
    }
  }
}

assert.register(
  'reports',
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- t.assert.reports returns the promise, and every caller awaits it
  async function (this: TestContext, cases: () => void, expected: Reported[], options: { only?: boolean } = {}) {
    this.assert.deepStrictEqual(await reported(cases, options.only), expected);
  },
);

async function reported(cases: () => void, only = false): Promise<Reported[]> {
  const captured = capturedNames(String(cases));

  if (captured.length > 0) {
    throw new Error(
      `t.assert.reports cases can use only lzTestEach, lzTestFor, report and globals, not ${captured.join(', ')}.`,
    );
  }

  const dir = mkdtempSync(join(tmpdir(), 'test-each-'));
  // run() runs no files from inside a test file, which node:test marks with this variable.
  const context = process.env['NODE_TEST_CONTEXT'];

  try {
    const file = join(dir, 'cases.test.mjs');
    writeFileSync(
      file,
      [
        `import { lzTestEach } from ${JSON.stringify(testEach)};`,
        `import { lzTestFor } from ${JSON.stringify(testFor)};`,
        String(report),
        `(${cases})();`,
      ].join('\n'),
    );
    delete process.env['NODE_TEST_CONTEXT'];
    const tests: Reported[] = [];
    const record = (
      outcome: Reported['outcome'],
      { name, skip, todo, details }: EventData.TestPass | EventData.TestFail,
    ) => {
      const error = 'error' in details ? details.error : undefined;
      tests.push({
        name,
        outcome,
        ...(skip !== undefined && { skip: true }),
        ...(todo !== undefined && { todo: true }),
        ...(error && { error: error.cause instanceof Error ? error.cause.message : error.message }),
      });
    };
    // The stream's iterator yields `any`; its named events carry typed data.
    const stream = run({ files: [file], only });
    stream.on('test:pass', (data) => record('pass', data));
    stream.on('test:fail', (data) => record('fail', data));
    await stream.toArray();

    return tests;
  } finally {
    if (context !== undefined) {
      process.env['NODE_TEST_CONTEXT'] = context;
    }

    rmSync(dir, { recursive: true, force: true });
  }
}

const casesFile = 'cases.ts';
const compilerOptions: ts.CompilerOptions = {
  noEmit: true,
  target: ts.ScriptTarget.ES2023,
  lib: ['lib.es2023.d.ts'],
  types: ['node'],
};
const host = ts.createCompilerHost(compilerOptions);
const libraries = new Map<string, ts.SourceFile | undefined>();

/**
 * The names `source` uses that neither it nor the test file that `reported` writes declares, which the TypeScript
 * checker reports as names it cannot find. The library files are parsed once and shared by every call.
 */
function capturedNames(source: string): string[] {
  const text = `declare const lzTestEach: any, lzTestFor: any, report: any;\n(${source})();\n`;
  const program = ts.createProgram([casesFile], compilerOptions, {
    ...host,
    getSourceFile: (name, version) => {
      if (name === casesFile) {
        return ts.createSourceFile(name, text, ts.ScriptTarget.ES2023);
      }

      if (!libraries.has(name)) {
        libraries.set(name, host.getSourceFile(name, version));
      }

      return libraries.get(name);
    },
  });
  const unknown = program
    .getSemanticDiagnostics(program.getSourceFile(casesFile))
    // Cannot find name 'x', and the same with a suggestion.
    .filter((diagnostic) => diagnostic.code === 2304 || diagnostic.code === 2552);

  const names = unknown.map(({ start, length, messageText }) => {
    if (start === undefined || length === undefined) {
      throw new Error(`A diagnostic without a position: ${JSON.stringify(messageText)}`);
    }

    return text.slice(start, start + length);
  });

  return [...new Set(names)];
}
