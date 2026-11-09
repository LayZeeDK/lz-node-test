/**
 * How a test file's process is spawned: on POSIX in a process group of its own, so that `endGroup` can end the
 * processes its tests leave running. On Windows libuv's job object ends the processes that the test file's process
 * started directly with it; one started through a shell (`shell: true`, a `.cmd` file) or with `detached: true` stays.
 */
export function groupOptions(platform: NodeJS.Platform): { detached: boolean; windowsHide: true } {
  return { detached: platform !== 'win32', windowsHide: true };
}

/** How often the wait after SIGTERM asks whether the group is gone. */
const pollMs = 10;

/** How long the processes of a test file's group get after SIGTERM before SIGKILL, at most: a whole number of polls. */
export const termGraceMs = 20 * pollMs;

/**
 * How long a test file's process may hold stderr open after it exits, for the records of the processes it started
 * that end soon.
 */
const closeGraceMs = 1_500;

/** How much of a test file's stderr the runner keeps, from its end. */
export const lzStderrTailBytes = 8 * 1024;

/** `tail` as text, without the bytes of a character whose start it cut off. */
function wholeCharacters(tail: Buffer): string {
  const start = tail.findIndex((byte) => (byte & 0xc0) !== 0x80);

  return tail.subarray(start === -1 ? tail.length : start).toString('utf8');
}

type Kill = (pid: number, signal: NodeJS.Signals | 0) => void;

/** Sends `signal` to the group, where 0 only asks whether it is there; false when no process of the group is left. */
function signalGroup(pid: number, signal: NodeJS.Signals | 0, kill: Kill): boolean {
  try {
    kill(-pid, signal);

    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false;
    }

    throw error;
  }
}

/**
 * Sends the group SIGTERM and, when any of it is left `termGraceMs` later, SIGKILL, so a process that listens for
 * SIGTERM gets to run its listener. A process that detached itself has a group of its own and stays.
 */
export async function endGroup(pid: number, platform: NodeJS.Platform, kill: Kill): Promise<void> {
  if (!groupOptions(platform).detached || !signalGroup(pid, 'SIGTERM', kill)) {
    return;
  }

  if (await groupLasts(pid, kill)) {
    signalGroup(pid, 'SIGKILL', kill);
  }
}

/** Whether the group is still there `termGraceMs` from now; it asks every `pollMs` and stops once the group is gone. */
function groupLasts(pid: number, kill: Kill): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let polls = 0;
    const poll = setInterval(() => {
      polls += 1;

      try {
        const lasts = signalGroup(pid, 0, kill);

        if (lasts && polls * pollMs < termGraceMs) {
          return;
        }

        clearInterval(poll);
        resolve(lasts);
      } catch (error) {
        clearInterval(poll);
        reject(error);
      }
    }, pollMs);
  });
}

/**
 * Waits for a process to end and collects the last `lzStderrTailBytes` of its stderr. Processes it started inherit
 * stderr and can keep it open after it exits; the records of those that end soon arrive by the time stderr closes, so
 * this waits for that, but at most `closeGraceMs` after the exit, and then lets go of stderr. Then it ends what is left
 * of the process's group on `platform`, and settles once that is done.
 */
export function processEnd(
  child: EndingProcess,
  platform: NodeJS.Platform,
  kill: Kill = (pid, signal) => process.kill(pid, signal),
): Promise<{ exitCode: number | null; stderr: string }> {
  return new Promise((done, fail) => {
    let errors = Buffer.alloc(0);
    let grace: NodeJS.Timeout | undefined;
    let ended = false;
    const end = (code: number | null) => {
      if (ended) {
        return;
      }

      ended = true;
      // A process that failed to start has no pid, and no group to end.
      const grouped = child.pid === undefined ? Promise.resolve() : endGroup(child.pid, platform, kill);
      grouped.then(() => {
        done({ exitCode: code, stderr: wholeCharacters(errors) });
      }, fail);
    };
    child.stderr.on('data', (chunk: Buffer) => {
      const all = Buffer.concat([errors, chunk]);
      errors = all.subarray(Math.max(0, all.length - lzStderrTailBytes));
    });
    child.on('error', fail);
    child.on('exit', (code) => {
      grace = setTimeout(() => {
        child.stderr.destroy();
        end(code);
      }, closeGraceMs);
    });
    child.on('close', (code) => {
      clearTimeout(grace);
      end(code);
    });
  });
}

interface EndingProcess {
  /** undefined for a process that failed to start, as on ChildProcess. */
  readonly pid?: number | undefined;
  readonly stderr: {
    on(event: 'data', listener: (chunk: Buffer) => void): unknown;
    destroy(): unknown;
  };
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit' | 'close', listener: (code: number | null) => void): unknown;
}
