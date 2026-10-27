import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { types } from '@babel/core';

import { lzTestEach } from '@layzee/lz-node-test';
import {
  corePackageJson,
  install,
  resolveFromCore,
  type Instrumenter,
  type ListedMutator,
  type InstrumentedMutant,
  type SourceFile,
} from '../../src/install.ts';
import { isOwn, type NodeMutatorLike, type Operator } from '../../src/operator.ts';

const sampleLocation = { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } };

function operator(name: string): Operator {
  return { name, sample: `${name}();`, *mutate() {} };
}

function setup({
  builtIns = ['StringLiteral'],
  silent = [],
  version = '10.1.1',
}: { builtIns?: string[]; silent?: string[]; version?: string } = {}) {
  const allMutators: ListedMutator[] = builtIns.map((name) => ({ name, *mutate() {} }));
  const instrumented: SourceFile[][] = [];
  const warnings: string[] = [];
  const instrumenter: Instrumenter = {
    dir: '/stryker/instrumenter',
    version,
    allMutators,
    setMutators(mutators) {
      allMutators.splice(0, allMutators.length, ...mutators);
    },
    types,
    async instrument(files) {
      instrumented.push([...files]);

      return allMutators
        .filter((mutator) => isOwn(mutator) && !silent.includes(mutator.name))
        .map(
          (mutator): InstrumentedMutant => ({ mutatorName: mutator.name, replacement: '', location: sampleLocation }),
        );
    },
  };
  const run = (mode: 'add' | 'replace', operators: Operator[]) =>
    install(
      mode,
      operators,
      async () => instrumenter,
      (message) => warnings.push(message),
    );
  const names = () => allMutators.map(({ name }) => name);

  return { run, names, instrumented, warnings };
}

describe('install', () => {
  it("adds the operators after Stryker's mutators, and instruments each one's sample", async () => {
    const { run, names, instrumented, warnings } = setup();

    await run('add', [operator('Alpha'), operator('Beta')]);

    assert.deepEqual(names(), ['StringLiteral', 'Alpha', 'Beta']);
    assert.deepEqual(instrumented, [
      [
        { name: 'Alpha.self-check.ts', content: 'Alpha();' },
        { name: 'Beta.self-check.ts', content: 'Beta();' },
      ],
    ]);
    assert.deepEqual(warnings, []);
  });

  it('adds nothing when it installs the same operators again', async () => {
    const { run, names } = setup();

    await run('add', [operator('Alpha')]);
    await run('add', [operator('Alpha'), operator('Beta')]);

    assert.deepEqual(names(), ['StringLiteral', 'Alpha', 'Beta']);
  });

  it("replaces Stryker's mutators, and its own, with the operators", async () => {
    const { run, names } = setup({ builtIns: ['StringLiteral', 'CallExpression'] });

    await run('add', [operator('Alpha')]);
    await run('replace', [operator('Beta'), operator('Gamma')]);
    await run('replace', [operator('Beta'), operator('Gamma')]);

    assert.deepEqual(names(), ['Beta', 'Gamma']);
  });

  it('throws, naming the instrumenter and the operators that made no mutant', async () => {
    const { run } = setup({ silent: ['Alpha', 'Gamma'] });

    await assert.rejects(run('add', [operator('Alpha'), operator('Beta'), operator('Gamma')]), {
      message:
        'lz-stryker-node-test-mutators: the instrumenter in /stryker/instrumenter made no mutants of Alpha, Gamma from their ' +
        'samples, so it does not read the mutator list this module added to. A bundled instrumenter does that.',
    });
  });

  const refusals: readonly (readonly [string, 'add' | 'replace', readonly Operator[], string])[] = [
    ["a name of Stryker's", 'add', [operator('StringLiteral')], 'StringLiteral'],
    ["a name of Stryker's, also when it replaces them", 'replace', [operator('StringLiteral')], 'StringLiteral'],
    ['a name twice', 'add', [operator('Alpha'), operator('Beta'), operator('Alpha')], 'Alpha'],
    ["a name of Stryker's in another case", 'add', [operator('Stringliteral')], 'Stringliteral'],
    ['a name twice in another case', 'add', [operator('Alpha'), operator('ALPHA')], 'ALPHA'],
    [
      "two names of Stryker's",
      'add',
      [operator('CallExpression'), operator('StringLiteral')],
      'CallExpression, StringLiteral',
    ],
  ];

  lzTestEach(refusals)('refuses %s before it changes the list', async (_title, mode, operators, name) => {
    const { run, names, instrumented } = setup({ builtIns: ['StringLiteral', 'CallExpression'] });

    await assert.rejects(run(mode, [...operators]), {
      message: `lz-stryker-node-test-mutators: another mutator already has the name ${name}.`,
    });
    assert.deepEqual([names(), instrumented], [['StringLiteral', 'CallExpression'], []]);
  });

  lzTestEach(['NodeTimer1', 'Node-Timer', 'Node_Timer', 'Node Timer', ''])(
    'refuses the name %j, as a name has letters only',
    async (name) => {
      const { run, names } = setup();

      await assert.rejects(run('add', [operator('Alpha'), operator(name)]), {
        message:
          "lz-stryker-node-test-mutators: a mutator name has letters only, as Stryker's directives match no other " +
          `character: ${JSON.stringify(name)}`,
      });
      assert.deepEqual(names(), ['StringLiteral']);
    },
  );

  it('names every name that is not letters only', async () => {
    const { run } = setup();

    await assert.rejects(run('add', [operator('Node1'), operator('Alpha'), operator('Node-2')]), {
      message:
        "lz-stryker-node-test-mutators: a mutator name has letters only, as Stryker's directives match no other " +
        'character: "Node1", "Node-2"',
    });
  });

  lzTestEach(['10.2.0', '110.1.0'])(
    'warns about the instrumenter version %s, which it was not written for',
    async (version) => {
      const { run, warnings } = setup({ version });

      await run('add', [operator('Alpha')]);

      assert.deepEqual(warnings, [
        `lz-stryker-node-test-mutators was written for @stryker-mutator/instrumenter 10.1, not ${version}; its install check ` +
          'passed.',
      ]);
    },
  );
});

describe('corePackageJson', () => {
  const globalCore = join('/global', 'node_modules', '@stryker-mutator', 'core');
  const here = join('/repo', 'node_modules', '@stryker-mutator', 'core', 'package.json');

  function coreFor(real: string | undefined) {
    return corePackageJson(
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
    assert.equal(coreFor(join(globalCore, 'bin', 'stryker.js')), join(globalCore, 'package.json'));
  });

  lzTestEach([
    ['another script', join('/repo', 'tools', 'corpus-diff.ts')],
    ['a file next to the bin', join(globalCore, 'bin', 'stryker.js.map')],
    ["another package's bin", join('/global', 'node_modules', '@stryker-mutator', 'other', 'bin', 'stryker.js')],
    ['a script that is no file', undefined],
  ])('takes the core this module resolves when the process runs %s', (_title, real) => {
    assert.equal(coreFor(real), here);
  });

  it('takes the core this module resolves when the process runs no script, as `node --eval` does', () => {
    const core = corePackageJson(
      ['/usr/local/bin/node'],
      () => join(globalCore, 'bin', 'stryker.js'),
      () => here,
    );

    assert.equal(core, here);
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
    `lz-stryker-node-test-mutators: ${source} has no ${key} of the shape this module reads.`;
  const mutateFile = join('mutators', 'mutate.js');
  const babelFile = join('core', 'lib', 'index.js');
  const indexFile = join('dist', 'src', 'index.js');

  lzTestEach([
    ['allMutators that is no array', mutateFile, { allMutators: {} }, 'allMutators'],
    ['a listed mutator that is null', mutateFile, { allMutators: [null] }, 'allMutators'],
    ['a listed mutator with no name', mutateFile, { allMutators: [{ mutate() {} }] }, 'allMutators'],
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
    const resolving = resolveFromCore(corePackageJson(), load);

    await assert.rejects(resolving, { message: refusal(replaced.join(), key) });
  });

  const resolvingTo = (result: unknown) =>
    class {
      async instrument() {
        return result;
      }
    };
  const located = (mutant: object) => ({
    mutants: [{ mutatorName: 'Own', replacement: '""', location: sampleLocation, ...mutant }],
  });
  const noMutants = (index: string) => refusal(`the instrument() result of the Instrumenter of ${index}`, 'mutants');

  lzTestEach([
    [
      'an Instrumenter with no instrument method',
      class {},
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
    const instrumenter = await resolveFromCore(corePackageJson(), load);

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
