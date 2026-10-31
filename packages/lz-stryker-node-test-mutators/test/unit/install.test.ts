import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { types } from '@babel/core';

import { lzTestEach } from '@layzee/lz-node-test';
import { install } from '../../src/install.ts';
import type { Instrumenter, InstrumentedMutant, ListedMutator, SourceFile } from '../../src/instrumenter.ts';
import { isOwn, type Operator } from '../../src/operator.ts';

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
    instrument(files) {
      instrumented.push([...files]);

      return Promise.resolve(
        allMutators
          .filter((mutator) => isOwn(mutator) && !silent.includes(mutator.name))
          .map(
            (mutator): InstrumentedMutant => ({ mutatorName: mutator.name, replacement: '', location: sampleLocation }),
          ),
      );
    },
  };
  const run = (mode: 'add' | 'replace', operators: Operator[]) =>
    install(
      mode,
      operators,
      () => Promise.resolve([instrumenter]),
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
      install('add', [operator('Alpha')], () => Promise.resolve([first.instrumenter, second.instrumenter])),
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

  it('passes on one warning for an instrumenter version outside the peer range', async () => {
    const { run, warnings } = setup({ version: '0.0.0' });

    await run('add', [operator('Alpha')]);

    assert.equal(warnings.length, 1);
    assert.match(warnings.join('\n'), /, not 0\.0\.0\. /);
  });
});
