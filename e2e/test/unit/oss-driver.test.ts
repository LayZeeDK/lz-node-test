import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { LzMutantDetail, LzMutantStatus } from '../../src/report.ts';
import {
  lzCompare,
  lzDescendants,
  lzLeftovers,
  lzNewEntries,
  lzParseOptions,
  lzParseSamples,
  lzPeaks,
  lzScore,
  lzStrykerConfig,
  lzStrykerOptions,
  type LzOssProject,
  type LzProcessRow,
} from '../../src/oss/driver.ts';

const required = ['--project', 'env-schema', '--source', 'D:/clone', '--out', 'D:/out', '--concurrency', '5'];

describe('lzParseOptions', () => {
  it('reads the options and looks the project up', () => {
    const options = lzParseOptions(required);

    assert.deepEqual(
      { ...options, project: options.project.name },
      {
        project: 'env-schema',
        source: 'D:/clone',
        out: 'D:/out',
        concurrency: 5,
        tarballs: undefined,
        prepareOnly: false,
      },
    );
  });

  it('reads the tarball folder and --prepare-only', () => {
    const options = lzParseOptions([...required, '--tarballs', 'D:/tgz', '--prepare-only']);

    assert.deepEqual([options.tarballs, options.prepareOnly], ['D:/tgz', true]);
  });

  it('refuses a project it has no settings for, and names those it has', () => {
    assert.throws(() => lzParseOptions(required.with(1, 'pino')), {
      message: /--project is one of env-schema, fastify-cookie, fast-json-stringify, fastify\.$/,
    });
  });

  it('refuses a missing --out', () => {
    assert.throws(() => lzParseOptions(required.slice(0, 4).concat(required.slice(6))), {
      message: /--source and --out are required\.$/,
    });
  });

  it('refuses a concurrency of 0', () => {
    assert.throws(() => lzParseOptions(required.with(7, '0')), { message: /--concurrency is a positive integer/ });
  });

  it('refuses an option it does not know', () => {
    assert.throws(() => lzParseOptions([...required, '--sides', 'lz']), { code: 'ERR_PARSE_ARGS_UNKNOWN_OPTION' });
  });
});

const project: LzOssProject = {
  name: 'p',
  mutate: ['index.js'],
  testFiles: ['test/*.test.js'],
  command: 'node --test',
};

describe('lzStrykerOptions', () => {
  it('selects the runner of this workspace with the test files on the lz side', () => {
    assert.deepEqual(lzStrykerOptions('lz', project), {
      mutate: ['index.js'],
      plugins: ['@stryker-mutator/*', '@layzee/lz-stryker-node-test-runner'],
      testRunner: 'lz-stryker-node-test',
      lzStrykerNodeTest: { testFiles: ['test/*.test.js'] },
    });
  });

  it("runs the project's command with coverage analysis off on the command side", () => {
    assert.deepEqual(lzStrykerOptions('command', project), {
      mutate: ['index.js'],
      testRunner: 'command',
      commandRunner: { command: 'node --test' },
      coverageAnalysis: 'off',
    });
  });
});

describe('lzStrykerConfig', () => {
  it('imports the operators and exports the options on either side', () => {
    const config = lzStrykerConfig('command', project);

    assert.match(config, /^import '@layzee\/lz-stryker-node-test-mutators';\n\nexport default \{\n/);
    assert.match(config, /"testRunner": "command"/);
  });
});

function row(pid: number, ppid: number, created = pid, workingSetBytes = 100): LzProcessRow {
  return { pid, ppid, workingSetBytes, created: BigInt(created), name: `p${pid}.exe` };
}

describe('lzParseSamples', () => {
  it('reads each sample up to its -- line, with CRLF line ends and spaces in a name', () => {
    const text = '4 0 10 0 System\r\n10 4 2048 133000000000000001 my tool.exe\r\n--\r\n4 0 10 0 System\r\n--\r\n';

    assert.deepEqual(lzParseSamples(text), [
      [
        { pid: 4, ppid: 0, workingSetBytes: 10, created: 0n, name: 'System' },
        { pid: 10, ppid: 4, workingSetBytes: 2048, created: 133000000000000001n, name: 'my tool.exe' },
      ],
      [{ pid: 4, ppid: 0, workingSetBytes: 10, created: 0n, name: 'System' }],
    ]);
  });

  it('drops a sample that the stop cut short', () => {
    assert.equal(lzParseSamples('4 0 10 0 System\n--\n5 4 1').length, 1);
  });

  it('refuses a line that is no process', () => {
    assert.throws(() => lzParseSamples('WARNING: slow\n--\n'), { message: 'Not a process line: "WARNING: slow"' });
  });
});

describe('lzDescendants', () => {
  it('walks the tree below the root and leaves the root out', () => {
    const rows = [row(1, 0), row(2, 1), row(3, 2), row(4, 0)];

    assert.deepEqual(
      lzDescendants(rows, 1, new Set()).map(({ pid }) => pid),
      [2, 3],
    );
  });

  it('leaves out an excluded process and its children', () => {
    const rows = [row(1, 0), row(2, 1), row(3, 2), row(5, 1)];

    assert.deepEqual(
      lzDescendants(rows, 1, new Set([2])).map(({ pid }) => pid),
      [5],
    );
  });

  it('leaves out a process that started before the parent its id names', () => {
    const rows = [row(1, 0, 50), row(2, 1, 40), row(3, 1, 60)];

    assert.deepEqual(
      lzDescendants(rows, 1, new Set()).map(({ pid }) => pid),
      [3],
    );
  });
});

describe('lzPeaks', () => {
  it('takes the largest count and the largest summed working set of any sample', () => {
    const samples = [[row(1, 0, 1, 500)], [row(1, 0, 1, 100), row(2, 1, 2, 300)]];

    assert.deepEqual(lzPeaks(samples), { samples: 2, peakCount: 2, peakWorkingSetBytes: 500 });
  });

  it('reads zero from no samples', () => {
    assert.deepEqual(lzPeaks([]), { samples: 0, peakCount: 0, peakWorkingSetBytes: 0 });
  });
});

describe('lzLeftovers', () => {
  it('finds a seen process that still runs, and a child of an ended one that no sample saw', () => {
    const seen = [row(10, 1), row(11, 10), row(12, 11)];
    const now = [row(1, 0), row(12, 11), row(13, 11)];

    assert.deepEqual(
      lzLeftovers(seen, now, 1).map(({ pid }) => pid),
      [12, 13],
    );
  });

  it('leaves out a child of the root that no sample saw, such as the snapshot itself', () => {
    assert.deepEqual(lzLeftovers([row(10, 1)], [row(1, 0), row(20, 1)], 1), []);
  });

  it('leaves out a process that reuses the id of an ended one', () => {
    assert.deepEqual(lzLeftovers([row(10, 1), row(11, 10)], [row(1, 0), row(11, 7, 99)], 1), []);
  });
});

function mutant(line: number, status: LzMutantStatus, replacement = 'x', endColumn = 9): LzMutantDetail {
  return {
    line,
    column: 3,
    endLine: line,
    endColumn,
    mutator: 'StringLiteral',
    replacement,
    status,
    statusReason: '',
    killedBy: [],
    coveredBy: [],
  };
}

describe('lzScore', () => {
  it('counts each status and scores as Stryker does, without CompileError, RuntimeError or Ignored', () => {
    const mutants = (
      ['Killed', 'Timeout', 'Survived', 'NoCoverage', 'RuntimeError', 'Ignored', 'Killed'] satisfies LzMutantStatus[]
    ).map((status, line) => mutant(line, status));

    assert.deepEqual(lzScore(mutants), {
      counts: { Ignored: 1, Killed: 2, NoCoverage: 1, RuntimeError: 1, Survived: 1, Timeout: 1 },
      score: 60,
    });
  });

  it('has no score without a valid mutant', () => {
    assert.equal(lzScore([mutant(1, 'CompileError')]).score, null);
  });
});

describe('lzCompare', () => {
  it("pairs the sides' verdicts by file, place, mutator and replacement", () => {
    const lz = new Map([['index.js', [mutant(1, 'Killed'), mutant(2, 'Survived', 'a\n  b')]]]);
    const command = new Map([['index.js', [mutant(1, 'Killed'), mutant(2, 'Killed', 'a\n  b'), mutant(4, 'Timeout')]]]);

    assert.deepEqual(lzCompare(lz, command), [
      { mutant: 'index.js:1:3-1:9 StringLiteral x', lz: 'Killed', command: 'Killed' },
      { mutant: 'index.js:2:3-2:9 StringLiteral a b', lz: 'Survived', command: 'Killed' },
      { mutant: 'index.js:4:3-4:9 StringLiteral x', lz: null, command: 'Timeout' },
    ]);
  });

  it('keeps apart two mutants that start at one place and end at two', () => {
    const lz = new Map([['index.js', [mutant(1, 'Killed', 'true', 20), mutant(1, 'Survived', 'true', 40)]]]);
    const command = new Map([['index.js', [mutant(1, 'Killed', 'true', 20), mutant(1, 'Killed', 'true', 40)]]]);

    assert.deepEqual(
      lzCompare(lz, command).map(({ lz: status }) => status),
      ['Killed', 'Survived'],
    );
  });
});

describe('lzNewEntries', () => {
  it('lists what the second listing adds, sorted', () => {
    assert.deepEqual(lzNewEntries(['a', 'b'], ['c', 'a', 'b', 'Z']), ['Z', 'c']);
  });
});
