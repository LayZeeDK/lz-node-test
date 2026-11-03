import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { types } from '@babel/core';

import { lzTestEach } from '@layzee/node-test-extensions';
import { corePackageJsons, resolveFromCore, type ListedMutator } from '../../src/instrumenter.ts';
import type { NodeMutatorLike } from '../../src/operator.ts';

const sampleLocation = { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } };

describe('corePackageJsons', () => {
  const globalCore = join('/global', 'node_modules', '@stryker-mutator', 'core');
  const here = join('/repo', 'node_modules', '@stryker-mutator', 'core', 'package.json');

  function coreFor(real: string | undefined) {
    return corePackageJsons(
      ['/usr/local/bin/node', '/usr/local/bin/stryker'],
      (path) => {
        assert.equal(path, '/usr/local/bin/stryker');

        if (real === undefined) {
          throw new Error(`ENOENT: no such file or directory, realpath '${path}'`);
        }

        return real;
      },
      (specifier) => {
        assert.equal(specifier, '@stryker-mutator/core/package.json');

        return here;
      },
    );
  }

  it("takes the core whose bin started the process, through the bin's links", () => {
    assert.deepEqual(coreFor(join(globalCore, 'bin', 'stryker.js')), [join(globalCore, 'package.json')]);
  });

  lzTestEach([
    ['another script', join('/repo', 'tools', 'corpus-diff.ts')],
    ['a file next to the bin', join(globalCore, 'bin', 'stryker.js.map')],
    ["another package's bin", join('/global', 'node_modules', '@stryker-mutator', 'other', 'bin', 'stryker.js')],
    ['a script that is no file', undefined],
  ])('takes the core this module resolves when the process runs %s', (_title, real) => {
    assert.deepEqual(coreFor(real), [here]);
  });

  const upperCore = 'D:\\repo\\node_modules\\@stryker-mutator\\core\\package.json';
  const lowerCore = 'd:\\repo\\node_modules\\@stryker-mutator\\core\\package.json';

  lzTestEach([
    ['in lower case, and this module in upper case', 'd:\\repo\\tools\\stryker.mjs', upperCore, [lowerCore, upperCore]],
    ['in upper case, and this module in lower case', 'D:\\repo\\tools\\stryker.mjs', lowerCore, [upperCore, lowerCore]],
    ['in the case of this module', 'D:\\repo\\tools\\stryker.mjs', upperCore, [upperCore]],
    ['of another drive', 'e:\\tools\\stryker.mjs', upperCore, [upperCore]],
    ['of none', '/repo/tools/stryker.mjs', upperCore, [upperCore]],
    ['of none, though a later folder is a letter and a colon', '/repo/d:/stryker.mjs', upperCore, [upperCore]],
  ])(
    "takes the core this module resolves in the drive-letter case of the script that started the process, and in its own, when the script's real path has a drive letter %s",
    (_title, script, resolvedCore, expected) => {
      const cores = corePackageJsons(
        ['node', script],
        (path) => path,
        () => resolvedCore,
      );

      assert.deepEqual(cores, expected);
    },
  );

  it('takes the core this module resolves when the process runs no script, as `node --eval` does', () => {
    const cores = corePackageJsons(
      ['/usr/local/bin/node'],
      () => join(globalCore, 'bin', 'stryker.js'),
      () => here,
    );

    assert.deepEqual(cores, [here]);
  });
});

describe('resolveFromCore', () => {
  it("instruments with Stryker's mutators, or with the mutators given", async () => {
    const instrumenter = await resolveFromCore();
    const files = [{ name: 'sample.ts', content: "f('x');" }];
    const own: NodeMutatorLike = {
      name: 'Own',
      *mutate(path) {
        if (path.isStringLiteral()) {
          yield instrumenter.types.stringLiteral('y');
        }
      },
    };

    const mutants = async (mutators?: NodeMutatorLike[]) =>
      (await instrumenter.instrument(files, mutators)).map(({ mutatorName, replacement }) => [
        mutatorName,
        replacement,
      ]);

    assert.deepEqual([await mutants(), await mutants([own])], [[['StringLiteral', '""']], [['Own', '"y"']]]);
    assert.ok(instrumenter.allMutators.some(({ name }) => name === 'StringLiteral'));
  });

  function loadingWith(file: string, replacement: unknown) {
    const replaced: string[] = [];
    const load = async (path: string): Promise<unknown> => {
      if (path.endsWith(file)) {
        replaced.push(path);

        return replacement;
      }

      const module: unknown = await import(pathToFileURL(path).href);

      return module;
    };

    return { load, replaced };
  }

  const refusal = (source: string, key: string) =>
    `stryker-node-test-mutators: ${source} has no ${key} of the shape this module reads.`;
  const mutateFile = join('mutators', 'mutate.js');
  const babelFile = join('core', 'lib', 'index.js');
  const indexFile = join('dist', 'src', 'index.js');

  lzTestEach([
    ['allMutators that is no array', mutateFile, { allMutators: {} }, 'allMutators'],
    ['a listed mutator that is null', mutateFile, { allMutators: [null] }, 'allMutators'],
    ['a listed mutator with no name', mutateFile, { allMutators: [{ mutate() {} }] }, 'allMutators'],
    [
      'a listed mutator that is null after one it reads',
      mutateFile,
      { allMutators: [{ name: 'Own', mutate() {} }, null] },
      'allMutators',
    ],
    [
      'a listed mutator whose name is no string',
      mutateFile,
      { allMutators: [{ name: 1, mutate() {} }] },
      'allMutators',
    ],
    [
      'a listed mutator with no mutate function',
      mutateFile,
      { allMutators: [{ name: 'Own', mutate: 'no' }] },
      'allMutators',
    ],
    [
      'no transformBabel function',
      join('transformers', 'babel-transformer.js'),
      { transformBabel: {} },
      'transformBabel',
    ],
    ['no Instrumenter class', indexFile, { Instrumenter: {} }, 'Instrumenter'],
    ['no Babel types', babelFile, {}, 'types'],
    ['Babel types that are null', babelFile, { types: null }, 'types'],
    ['Babel types without a builder', babelFile, { types: { ...types, stringLiteral: undefined } }, 'types'],
  ])('refuses an instrumenter with %s', async (_title, file, module, key) => {
    const { load, replaced } = loadingWith(file, module);
    const resolving = resolveFromCore(corePackageJsons()[0], load);

    await assert.rejects(resolving, { message: refusal(replaced.join(), key) });
  });

  it("takes the instrumenter's Babel types when they lack a member the operators do not call", async () => {
    const older = Object.fromEntries(Object.entries(types).filter(([key]) => key !== 'tsTypeAnnotation'));
    const { load } = loadingWith(babelFile, { types: older });

    const instrumenter = await resolveFromCore(corePackageJsons()[0], load);

    assert.equal(instrumenter.types, older);
  });

  it("replaces the contents of the instrumenter's own mutator list", async () => {
    const listed: ListedMutator[] = [
      { name: 'First', *mutate() {} },
      { name: 'Second', *mutate() {} },
    ];
    const own: ListedMutator = { name: 'Own', *mutate() {} };
    const { load } = loadingWith(mutateFile, { allMutators: listed });
    const instrumenter = await resolveFromCore(corePackageJsons()[0], load);

    instrumenter.setMutators([own]);

    assert.deepEqual(listed, [own]);
  });

  it('constructs the Instrumenter from the entry that core resolves for the package', async (t) => {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'lz-mutators-entry-')));

    t.after(() => {
      rmSync(root, { recursive: true, force: true });
    });
    const packageFiles: Readonly<Record<string, string>> = {
      'node_modules/@stryker-mutator/instrumenter/package.json': JSON.stringify({
        name: '@stryker-mutator/instrumenter',
        version: '10.1.1',
        exports: { '.': './dist/bundle.js', './package.json': './package.json' },
      }),
      'node_modules/@stryker-mutator/instrumenter/dist/bundle.js': '',
      'node_modules/@babel/core/package.json': JSON.stringify({ name: '@babel/core', main: 'index.js' }),
      'node_modules/@babel/core/index.js': '',
    };

    Object.entries(packageFiles).forEach(([file, content]) => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), content);
    });
    const loaded: string[] = [];
    const load = (path: string): Promise<unknown> => {
      loaded.push(path);

      return Promise.resolve({ allMutators: [], transformBabel() {}, Instrumenter() {}, types });
    };

    await resolveFromCore(join(root, 'package.json'), load);

    const instrumenter = join(root, 'node_modules', '@stryker-mutator', 'instrumenter');

    assert.deepEqual(loaded, [
      join(instrumenter, 'dist', 'src', 'mutators', 'mutate.js'),
      join(instrumenter, 'dist', 'src', 'transformers', 'babel-transformer.js'),
      join(instrumenter, 'dist', 'bundle.js'),
      join(root, 'node_modules', '@babel', 'core', 'index.js'),
    ]);
  });

  const resolvingTo = (result: unknown) =>
    class {
      instrument() {
        return Promise.resolve(result);
      }
    };
  const located = (mutant: object) => ({
    mutants: [{ mutatorName: 'Own', replacement: '""', location: sampleLocation, ...mutant }],
  });
  const noMutants = (index: string) => refusal(`the instrument() result of the Instrumenter of ${index}`, 'mutants');

  lzTestEach([
    [
      'an Instrumenter with no instrument method',
      function Instrumenter() {},
      (index: string) => refusal(`the Instrumenter of ${index}`, 'instrument'),
    ],
    ['an instrument result of nothing', resolvingTo(undefined), noMutants],
    ['an instrument result of null', resolvingTo(null), noMutants],
    ['mutants that are no array', resolvingTo({ mutants: {} }), noMutants],
    ['a mutant with no mutator name', resolvingTo(located({ mutatorName: undefined })), noMutants],
    ['a mutant whose replacement is no string', resolvingTo(located({ replacement: 1 })), noMutants],
    ['a mutant with no location', resolvingTo(located({ location: undefined })), noMutants],
    ['a mutant with no start', resolvingTo(located({ location: { end: sampleLocation.end } })), noMutants],
    ['a mutant with no end', resolvingTo(located({ location: { start: sampleLocation.start } })), noMutants],
    [
      'a mutant with no start line',
      resolvingTo(located({ location: { ...sampleLocation, start: { column: 0 } } })),
      noMutants,
    ],
    [
      'a mutant with no end column',
      resolvingTo(located({ location: { ...sampleLocation, end: { line: 0 } } })),
      noMutants,
    ],
  ])('refuses %s', async (_title, instrumenterClass, message) => {
    const { load, replaced } = loadingWith(indexFile, { Instrumenter: instrumenterClass });
    const instrumenter = await resolveFromCore(corePackageJsons()[0], load);

    await assert.rejects(instrumenter.instrument([{ name: 'sample.ts', content: "f('x');" }]), {
      message: message(replaced.join()),
    });
  });

  it('instruments a file whose directive names a mutator it does not apply, which Stryker warns about', async () => {
    const instrumenter = await resolveFromCore();
    const content = "// Stryker disable next-line LzNodeTimerDelay: a directive for another catalogue\nf('x');";

    const mutants = await instrumenter.instrument([{ name: 'sample.ts', content }]);

    assert.deepEqual(
      mutants.map(({ mutatorName }) => mutatorName),
      ['StringLiteral'],
    );
  });
});
