import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { types } from '@babel/core';

import { lzTestEach } from '@layzee/node-test-extensions';
import { lzInstall, type LzInstallMode } from '../../src/install.ts';
import type { LzInstrumentedMutant, LzInstrumenter, LzListedMutator, LzSourceFile } from '../../src/instrumenter.ts';
import { lzIsOwn, type LzMutator } from '../../src/mutator.ts';

const sampleLocation = { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } };
const packageName = 'lz-sample-mutators';

function mutator(name: string): LzMutator {
  return { name, sample: `${name}();`, *mutate() {} };
}

function setup({
  builtIns = ['StringLiteral'],
  silent = [],
  version = '10.1.1',
  dir = '/stryker/instrumenter',
}: { builtIns?: string[]; silent?: string[]; version?: string; dir?: string } = {}) {
  const allMutators: LzListedMutator[] = builtIns.map((name) => ({ name, *mutate() {} }));
  const instrumented: LzSourceFile[][] = [];
  const warnings: string[] = [];
  const instrumenter: LzInstrumenter = {
    dir,
    version,
    allMutators,
    setMutators(mutators) {
      allMutators.splice(0, allMutators.length, ...mutators);
    },
    types,
    instrument(files) {
      instrumented.push([...files]);

      return Promise.resolve(
        allMutators
          .filter((mutator) => lzIsOwn(mutator) && !silent.includes(mutator.name))
          .map(
            (mutator): LzInstrumentedMutant => ({
              mutatorName: mutator.name,
              replacement: '',
              location: sampleLocation,
            }),
          ),
      );
    },
  };
  const run = (mode: LzInstallMode, mutators: LzMutator[], corePeerRange = '^10.1.1', by = packageName) =>
    lzInstall(
      { packageName: by, corePeerRange, mode, mutators },
      () => Promise.resolve([instrumenter]),
      (message) => warnings.push(message),
    );
  const names = () => allMutators.map(({ name }) => name);

  return { run, names, instrumented, warnings, instrumenter };
}

describe('lzInstall', () => {
  it("adds the mutators after Stryker's mutators, and instruments each one's sample", async () => {
    const { run, names, instrumented, warnings } = setup();

    await run('add', [mutator('Alpha'), mutator('Beta')]);

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
      lzInstall({ packageName, corePeerRange: '^10.1.1', mode: 'add', mutators: [mutator('Alpha')] }, () =>
        Promise.resolve([first.instrumenter, second.instrumenter]),
      ),
      { message: /^lz-sample-mutators: the instrumenter in \/stryker\/copy made no mutants of Alpha / },
    );
    assert.deepEqual(
      [first.names(), second.names()],
      [
        ['StringLiteral', 'Alpha'],
        ['StringLiteral', 'Alpha'],
      ],
    );
  });

  it('adds nothing when it installs the same mutators again', async () => {
    const { run, names } = setup();

    await run('add', [mutator('Alpha')]);
    await run('add', [mutator('Alpha'), mutator('Beta')]);

    assert.deepEqual(names(), ['StringLiteral', 'Alpha', 'Beta']);
  });

  it("replaces Stryker's mutators, and its own, with the mutators", async () => {
    const { run, names } = setup({ builtIns: ['StringLiteral', 'CallExpression'] });

    await run('add', [mutator('Alpha')]);
    await run('replace', [mutator('Beta'), mutator('Gamma')]);
    await run('replace', [mutator('Beta'), mutator('Gamma')]);

    assert.deepEqual(names(), ['Beta', 'Gamma']);
  });

  it("keeps the mutators another package installed when it replaces Stryker's", async () => {
    const { run, names } = setup({ builtIns: ['StringLiteral', 'CallExpression'] });

    await run('add', [mutator('Delta')], '^10.1.1', 'lz-other-mutators');
    await run('add', [mutator('Alpha')]);
    await run('replace', [mutator('Beta')]);

    assert.deepEqual(names(), ['Delta', 'Beta']);
  });

  it('refuses a name that another package installed', async () => {
    const { run, names } = setup();

    await run('add', [mutator('Delta')], '^10.1.1', 'lz-other-mutators');

    await assert.rejects(run('add', [mutator('DELTA')]), {
      message: 'lz-sample-mutators: another mutator already has the name DELTA.',
    });
    assert.deepEqual(names(), ['StringLiteral', 'Delta']);
  });

  it('throws, naming the calling package, the instrumenter and the mutators that made no mutant', async () => {
    const { run } = setup({ silent: ['Alpha', 'Gamma'] });

    await assert.rejects(run('add', [mutator('Alpha'), mutator('Beta'), mutator('Gamma')]), {
      message:
        'lz-sample-mutators: the instrumenter in /stryker/instrumenter made no mutants of Alpha, Gamma from their ' +
        'samples, so it does not read the mutator list this module added to. A bundled instrumenter does that.',
    });
  });

  const refusals: readonly (readonly [string, LzInstallMode, readonly LzMutator[], string])[] = [
    ["a name of Stryker's", 'add', [mutator('StringLiteral')], 'StringLiteral'],
    ["a name of Stryker's, also when it replaces them", 'replace', [mutator('StringLiteral')], 'StringLiteral'],
    ['a name twice', 'add', [mutator('Alpha'), mutator('Beta'), mutator('Alpha')], 'Alpha'],
    ["a name of Stryker's in another case", 'add', [mutator('Stringliteral')], 'Stringliteral'],
    ['a name twice in another case', 'add', [mutator('Alpha'), mutator('ALPHA')], 'ALPHA'],
    [
      "two names of Stryker's",
      'add',
      [mutator('CallExpression'), mutator('StringLiteral')],
      'CallExpression, StringLiteral',
    ],
  ];

  lzTestEach(refusals)('refuses %s before it changes the list', async (_title, mode, mutators, name) => {
    const { run, names, instrumented } = setup({ builtIns: ['StringLiteral', 'CallExpression'] });

    await assert.rejects(run(mode, [...mutators]), {
      message: `lz-sample-mutators: another mutator already has the name ${name}.`,
    });
    assert.deepEqual([names(), instrumented], [['StringLiteral', 'CallExpression'], []]);
  });

  lzTestEach(['NodeTimer1', 'Node-Timer', 'Node_Timer', 'Node Timer', ''])(
    'refuses the name %j, as a name has letters only',
    async (name) => {
      const { run, names } = setup();

      await assert.rejects(run('add', [mutator('Alpha'), mutator(name)]), {
        message:
          "lz-sample-mutators: a mutator name has letters only, as Stryker's directives match no other " +
          `character: ${JSON.stringify(name)}`,
      });
      assert.deepEqual(names(), ['StringLiteral']);
    },
  );

  it('names every name that is not letters only', async () => {
    const { run } = setup();

    await assert.rejects(run('add', [mutator('Node1'), mutator('Alpha'), mutator('Node-2')]), {
      message:
        "lz-sample-mutators: a mutator name has letters only, as Stryker's directives match no other " +
        'character: "Node1", "Node-2"',
    });
  });

  it('refuses a peer range that is no caret range of a release before it changes the list', async () => {
    const { run, names, instrumented } = setup();

    await assert.rejects(run('add', [mutator('Alpha')], '~10.1.1'), {
      message: 'lz-sample-mutators: ~10.1.1 is no caret range of a release.',
    });
    assert.deepEqual([names(), instrumented], [['StringLiteral'], []]);
  });

  it("passes on one warning, naming the calling package, for an instrumenter version outside the caller's peer range", async () => {
    const { run, warnings } = setup({ version: '10.1.1' });

    await run('add', [mutator('Alpha')], '^10.2.0');

    assert.deepEqual(warnings, [
      'lz-sample-mutators accepts @stryker-mutator/instrumenter 10.2.0 or a later 10.x, not 10.1.1. Its install ' +
        'check passed, but it sees only this process, so mutants of its mutators may be missing.',
    ]);
  });
});
