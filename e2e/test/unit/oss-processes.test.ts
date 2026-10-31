import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  lzDescendants,
  lzLeftovers,
  lzNewEntries,
  lzParseProcSamples,
  lzParseSamples,
  lzPeaks,
  type LzProcessRow,
} from '../../src/oss/processes.ts';

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

describe('lzParseProcSamples', () => {
  const init =
    '1 (node) S 0 1 1 34816 1 4194560 21542 0 0 0 51 12 0 0 20 0 11 0 2845 1093210112 12880 18446744073709551615 1 1 0 0 0 0 0 16781312 134235650 0 0 0 17 3 0 0 0 0 0 0 0 0 0 0 0 0 0';
  const tool =
    '4021 (my (tool) x) R 1 4021 1 34816 4021 4194304 310 0 0 0 1 0 0 0 20 0 1 0 90210 2347008 512 18446744073709551615 1 1 0 0 0 0 0 0 0 0 0 0 17 5 0 0 0 0 0 0 0 0 0 0 0 0 0';

  it('reads the page size, then each sample of /proc/<pid>/stat lines up to its -- line', () => {
    assert.deepEqual(lzParseProcSamples(`4096\n${init}\n${tool}\n--\n${init}\n--\n`), [
      [
        { pid: 1, ppid: 0, workingSetBytes: 12880 * 4096, created: 2845n, name: 'node' },
        { pid: 4021, ppid: 1, workingSetBytes: 512 * 4096, created: 90210n, name: 'my (tool) x' },
      ],
      [{ pid: 1, ppid: 0, workingSetBytes: 12880 * 4096, created: 2845n, name: 'node' }],
    ]);
  });

  it('drops a sample that the stop cut short', () => {
    assert.equal(lzParseProcSamples(`4096\n${init}\n--\n${init}`).length, 1);
  });

  it('refuses text that does not start with the page size', () => {
    assert.throws(() => lzParseProcSamples(`${init}\n--\n`), { message: `Not a page size: "${init}"` });
  });

  it('refuses a line that is no /proc/<pid>/stat line', () => {
    assert.throws(() => lzParseProcSamples('4096\n1 (node) S 0\n--\n'), {
      message: 'Not a /proc/<pid>/stat line: "1 (node) S 0"',
    });
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

  it('keeps a child that started in the same clock tick as its parent', () => {
    const rows = [row(1, 0, 50), row(2, 1, 50)];

    assert.deepEqual(
      lzDescendants(rows, 1, new Set()).map(({ pid }) => pid),
      [2],
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
  it('finds the seen processes that still run', () => {
    const seen = [row(10, 1), row(11, 10), row(12, 11)];
    const now = [row(1, 0), row(12, 11), row(10, 1)];

    assert.deepEqual(
      lzLeftovers(seen, now).map(({ pid }) => pid),
      [12, 10],
    );
  });

  it('leaves out a child of the root that no sample saw, such as the snapshot itself', () => {
    assert.deepEqual(lzLeftovers([row(10, 1)], [row(1, 0), row(20, 1)]), []);
  });

  it('leaves out a child of an ended run process that no sample saw in the run', () => {
    assert.deepEqual(lzLeftovers([row(10, 1), row(11, 10)], [row(1, 0), row(12, 10, 50)]), []);
  });

  it('leaves out a process that reuses the id of an ended one', () => {
    assert.deepEqual(lzLeftovers([row(10, 1), row(11, 10)], [row(1, 0), row(11, 7, 99)]), []);
  });
});

describe('lzNewEntries', () => {
  it('lists what the second listing adds, sorted', () => {
    assert.deepEqual(lzNewEntries(['a', 'b'], ['c', 'a', 'b', 'Z']), ['Z', 'c']);
  });
});
