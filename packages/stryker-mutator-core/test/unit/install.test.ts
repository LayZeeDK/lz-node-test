import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { types } from '@babel/core';

import { lzTestEach } from '@layzee/node-test-extensions';
import { lzInstall, type LzInstallMode } from '../../src/install.ts';
import type { LzInstrumentedMutant, LzInstrumenter, LzListedMutator, LzSourceFile } from '../../src/instrumenter.ts';
import { lzIsOwn, type LzOperator } from '../../src/operator.ts';

const sampleLocation = { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } };
const packageName = 'lz-sample-mutators';

function operator(name: string): LzOperator {
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
  const run = (mode: LzInstallMode, operators: LzOperator[], corePeerRange = '^10.1.1', by = packageName) =>
    lzInstall(
      { packageName: by, corePeerRange, mode, operators },
      () => Promise.resolve([instrumenter]),
      (message) => warnings.push(message),
    );
  const names = () => allMutators.map(({ name }) => name);

  return { run, names, instrumented, warnings, instrumenter };
}

describe('lzInstall', () => {
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
      lzInstall({ packageName, corePeerRange: '^10.1.1', mode: 'add', operators: [operator('Alpha')] }, () =>
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

  it("keeps the mutators another package installed when it replaces Stryker's", async () => {
    const { run, names } = setup({ builtIns: ['StringLiteral', 'CallExpression'] });

    await run('add', [operator('Delta')], '^10.1.1', 'lz-other-mutators');
    await run('add', [operator('Alpha')]);
    await run('replace', [operator('Beta')]);

    assert.deepEqual(names(), ['Delta', 'Beta']);
  });

  it('refuses a name that another package installed', async () => {
    const { run, names } = setup();

    await run('add', [operator('Delta')], '^10.1.1', 'lz-other-mutators');

    await assert.rejects(run('add', [operator('DELTA')]), {
      message: 'lz-sample-mutators: another mutator already has the name DELTA.',
    });
    assert.deepEqual(names(), ['StringLiteral', 'Delta']);
  });

  it('throws, naming the calling package, the instrumenter and the operators that made no mutant', async () => {
    const { run } = setup({ silent: ['Alpha', 'Gamma'] });

    await assert.rejects(run('add', [operator('Alpha'), operator('Beta'), operator('Gamma')]), {
      message:
        'lz-sample-mutators: the instrumenter in /stryker/instrumenter made no mutants of Alpha, Gamma from their ' +
        'samples, so it does not read the mutator list this module added to. A bundled instrumenter does that.',
    });
  });

  const refusals: readonly (readonly [string, LzInstallMode, readonly LzOperator[], string])[] = [
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
      message: `lz-sample-mutators: another mutator already has the name ${name}.`,
    });
    assert.deepEqual([names(), instrumented], [['StringLiteral', 'CallExpression'], []]);
  });

  lzTestEach(['NodeTimer1', 'Node-Timer', 'Node_Timer', 'Node Timer', ''])(
    'refuses the name %j, as a name has letters only',
    async (name) => {
      const { run, names } = setup();

      await assert.rejects(run('add', [operator('Alpha'), operator(name)]), {
        message:
          "lz-sample-mutators: a mutator name has letters only, as Stryker's directives match no other " +
          `character: ${JSON.stringify(name)}`,
      });
      assert.deepEqual(names(), ['StringLiteral']);
    },
  );

  it('names every name that is not letters only', async () => {
    const { run } = setup();

    await assert.rejects(run('add', [operator('Node1'), operator('Alpha'), operator('Node-2')]), {
      message:
        "lz-sample-mutators: a mutator name has letters only, as Stryker's directives match no other " +
        'character: "Node1", "Node-2"',
    });
  });

  it('refuses a peer range that is no caret range of a release before it changes the list', async () => {
    const { run, names, instrumented } = setup();

    await assert.rejects(run('add', [operator('Alpha')], '~10.1.1'), {
      message: 'lz-sample-mutators: ~10.1.1 is no caret range of a release.',
    });
    assert.deepEqual([names(), instrumented], [['StringLiteral'], []]);
  });

  it("passes on one warning, naming the calling package, for an instrumenter version outside the caller's peer range", async () => {
    const { run, warnings } = setup({ version: '10.1.1' });

    await run('add', [operator('Alpha')], '^10.2.0');

    assert.deepEqual(warnings, [
      'lz-sample-mutators accepts @stryker-mutator/instrumenter 10.2.0 or a later 10.x, not 10.1.1. Its install ' +
        'check passed, but it sees only this process, so mutants of its mutators may be missing.',
    ]);
  });
});
