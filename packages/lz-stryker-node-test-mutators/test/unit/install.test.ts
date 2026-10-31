import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

import { types } from '@babel/core';

import { lzTestEach } from '@layzee/lz-node-test';
import {
  corePackageJsons,
  inPeerRange,
  install,
  parseCaretFloor,
  resolveFromCore,
  type Instrumenter,
  type ListedMutator,
  type InstrumentedMutant,
  type SourceFile,
} from '../../src/install.ts';
import { isOwn, type NodeMutatorLike, type Operator } from '../../src/operator.ts';
import pkg from '../../package.json' with { type: 'json' };

const sampleLocation = { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } };

function operator(name: string): Operator {
  return { name, sample: `${name}();`, *mutate() {} };
}

function setup({
  builtIns = ['StringLiteral'],
  silent = [],
  version = '10.1.1',
  dir = '/stryker/instrumenter',
}: { builtIns?: string[]; silent?: string[]; version?: string; dir?: string } = {}) {
  const allMutators: ListedMutator[] = builtIns.map((name) => ({ name, *mutate() {} }));
  const instrumented: SourceFile[][] = [];
  const warnings: string[] = [];
  const instrumenter: Instrumenter = {
    dir,
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
      async () => [instrumenter],
      (message) => warnings.push(message),
    );
  const names = () => allMutators.map(({ name }) => name);

  return { run, names, instrumented, warnings, instrumenter };
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

  it('installs into each copy of the instrumenter, and throws naming the copy that made no mutant', async () => {
    const first = setup();
    const second = setup({ silent: ['Alpha'], dir: '/stryker/copy' });

    await assert.rejects(
      install('add', [operator('Alpha')], async () => [first.instrumenter, second.instrumenter]),
      { message: /^lz-stryker-node-test-mutators: the instrumenter in \/stryker\/copy made no mutants of Alpha / },
    );
    assert.deepEqual(
      [first.names(), second.names()],
      [
        ['StringLiteral', 'Alpha'],
        ['StringLiteral', 'Alpha'],
      ],
    );
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

  lzTestEach(['11.0.0', '110.1.1'])(
    'warns that mutants may be missing with the instrumenter version %s, outside the peer range',
    async (version) => {
      const { run, warnings } = setup({ version });

      await run('add', [operator('Alpha')]);

      assert.deepEqual(warnings, [
        `lz-stryker-node-test-mutators accepts @stryker-mutator/instrumenter 10.1.1 or a later 10.x, not ${version}. ` +
          'Its install check passed, but it sees only this process, so mutants of its mutators may be missing.',
      ]);
    },
  );
});

describe('inPeerRange', () => {
  lzTestEach([
    ['10.1.5', '^10.2.0', false],
    ['10.2.0', '^10.2.0', true],
    ['10.1.9', '^10.1.10', false],
    ['10.0.0', '^10.0.0', true],
    ['9.9.9', '^10.0.0', false],
    ['v10.1.1', '^10.1.1', false],
    ['10.12.0', '^10.1.1', true],
  ])('takes %s in %s: %s', (version, range, expected) => {
    assert.equal(inPeerRange(version, range), expected);
  });

  lzTestEach(['~10.1.1', '^10.1', '^10.1.1-beta.0'])(
    'refuses the range %s, which is no caret range of a release',
    (range) => {
      assert.throws(() => inPeerRange('10.1.1', range), {
        message: `lz-stryker-node-test-mutators: ${range} is no caret range of a release.`,
      });
    },
  );
});

describe('the Stryker versions of the peer range', () => {
  const { major, minor, patch } = parseCaretFloor(pkg.peerDependencies['@stryker-mutator/core']);
  const semver = (...parts: readonly number[]) => parts.join('.');
  const floor = semver(major, minor, patch);

  function belowFloor(): string {
    if (patch > 0) {
      return semver(major, minor, patch - 1);
    }

    return minor > 0 ? semver(major, minor - 1, 999) : semver(major - 1, 999, 999);
  }

  async function warningsFor(version: string): Promise<readonly string[]> {
    const { run, warnings } = setup({ version });

    await run('add', [operator('Alpha')]);

    return warnings;
  }

  lzTestEach([floor, semver(major, minor, patch + 1), semver(major, minor + 1, 0)])(
    'installs into the instrumenter version %s without a warning',
    async (version) => {
      assert.deepEqual(await warningsFor(version), []);
    },
  );

  lzTestEach([
    belowFloor(),
    semver(major + 1, 0, 0),
    semver(major - 1, minor, patch),
    `1${floor}`,
    `${semver(major, minor + 1, 0)}-beta.0`,
  ])('warns about the instrumenter version %s', async (version) => {
    assert.equal((await warningsFor(version)).length, 1);
  });

  it('is the range the README names', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8').replaceAll(/\s+/g, ' ');

    assert.ok(readme.includes(`It accepts Stryker ${floor} or a later ${String(major)}.x version`));
  });
});

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
    `lz-stryker-node-test-mutators: ${source} has no ${key} of the shape this module reads.`;
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
    const load = async (path: string): Promise<unknown> => {
      loaded.push(path);

      return { allMutators: [], transformBabel() {}, Instrumenter: class {}, types };
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
