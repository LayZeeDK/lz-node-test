export interface LzProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly workingSetBytes: number;
  /** Windows FILETIME of the start, so a reused process id is told apart from the process it replaced. */
  readonly created: bigint;
  readonly name: string;
}

export interface LzProcessPeaks {
  readonly samples: number;
  readonly peakCount: number;
  readonly peakWorkingSetBytes: number;
}

/**
 * Reads the sampler's output: one line per process, `pid ppid workingSetBytes created name`, and a `--` line after
 * each sample. Text after the last `--` is a sample the stop cut short, and is dropped.
 */
export function lzParseSamples(text: string): LzProcessRow[][] {
  return text
    .split(/^--\r?$/m)
    .slice(0, -1)
    .map((sample) =>
      sample
        .split(/\r?\n/)
        .filter((line) => line !== '')
        .map(parseRow),
    );
}

function parseRow(line: string): LzProcessRow {
  const match = /^(\d+) (\d+) (\d+) (\d+) (.*)$/.exec(line);

  if (match === null) {
    throw new Error(`Not a process line: "${line}"`);
  }

  const [, pid = '', ppid = '', workingSet = '', created = '', name = ''] = match;

  return { pid: Number(pid), ppid: Number(ppid), workingSetBytes: Number(workingSet), created: BigInt(created), name };
}

/**
 * The processes below `rootPid`, leaving out `excluded` and what runs below it. A child counts only if it started no
 * earlier than its parent, as one whose parent id was reused by a later process did not. Equal counts, because a
 * Linux start time is in clock ticks and a fast child often shares its parent's tick.
 */
export function lzDescendants(
  rows: readonly LzProcessRow[],
  rootPid: number,
  excluded: ReadonlySet<number>,
): LzProcessRow[] {
  const childrenOf = (parent: LzProcessRow | undefined, pid: number): LzProcessRow[] =>
    rows
      .filter(
        (row) =>
          row.ppid === pid &&
          row.pid !== pid &&
          !excluded.has(row.pid) &&
          (parent === undefined || row.created >= parent.created),
      )
      .flatMap((row) => [row, ...childrenOf(row, row.pid)]);

  return childrenOf(
    rows.find(({ pid }) => pid === rootPid),
    rootPid,
  );
}

export function lzPeaks(samples: readonly (readonly LzProcessRow[])[]): LzProcessPeaks {
  return {
    samples: samples.length,
    peakCount: Math.max(0, ...samples.map((sample) => sample.length)),
    peakWorkingSetBytes: Math.max(
      0,
      ...samples.map((sample) => sample.reduce((sum, { workingSetBytes }) => sum + workingSetBytes, 0)),
    ),
  };
}

/**
 * The processes of `now` that a sample saw in the run, matched by id and start time. A process that the run started
 * between two samples and that outlived it is missed: walking from an ended process to its id's children would also
 * reach the children of a later process that reused that id.
 */
export function lzLeftovers(seen: readonly LzProcessRow[], now: readonly LzProcessRow[]): LzProcessRow[] {
  return now.filter((row) => seen.some(({ pid, created }) => pid === row.pid && created === row.created));
}

export function lzNewEntries(before: readonly string[], after: readonly string[]): string[] {
  return after.filter((entry) => !before.includes(entry)).sort();
}
