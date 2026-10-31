/**
 * How a test file's process is spawned: on POSIX in a process group of its own, so that `endGroup` can end the
 * processes its tests leave running. On Windows libuv's job object already ends them with the test file's process.
 */
export function groupOptions(platform: NodeJS.Platform): { detached: boolean; windowsHide: true } {
  return { detached: platform !== 'win32', windowsHide: true };
}

const termGraceMs = 200;

/** Sends `signal` to the group; false when no process of the group is left. */
function signalGroup(
  pid: number,
  signal: NodeJS.Signals,
  kill: (pid: number, signal: NodeJS.Signals) => void,
): boolean {
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
 * Sends the group SIGTERM and, `termGraceMs` later, SIGKILL, so a process that listens for SIGTERM gets to run its
 * listener. A process that detached itself has a group of its own and stays.
 */
export async function endGroup(
  pid: number,
  platform: NodeJS.Platform,
  kill: (pid: number, signal: NodeJS.Signals) => void,
): Promise<void> {
  if (!groupOptions(platform).detached || !signalGroup(pid, 'SIGTERM', kill)) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, termGraceMs));
  signalGroup(pid, 'SIGKILL', kill);
}

/**
 * Waits for a process to end and collects its stderr. Processes it started inherit stderr and can keep it open after
 * it exits; the records of those that end soon arrive by the time stderr closes, so this waits for that, but at most
 * `graceMs` after the exit, and then lets go of stderr. Then it ends what is left of the process's group on `platform`,
 * and settles once that is done.
 */
export function processEnd(
  child: EndingProcess,
  graceMs: number,
  platform: NodeJS.Platform,
  kill: (pid: number, signal: NodeJS.Signals) => void = process.kill,
): Promise<{ exitCode: number | null; stderr: string }> {
  return new Promise((done, fail) => {
    let errors = '';
    let grace: NodeJS.Timeout | undefined;
    let ended = false;
    const end = (code: number | null) => {
      if (ended) {
        return;
      }

      ended = true;
      // A process that failed to start has no pid, and no group to end.
      const grouped = child.pid === undefined ? Promise.resolve() : endGroup(child.pid, platform, kill);
      grouped.then(() => done({ exitCode: code, stderr: errors }), fail);
    };
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => (errors += chunk));
    child.on('error', fail);
    child.on('exit', (code) => {
      grace = setTimeout(() => {
        child.stderr.destroy();
        end(code);
      }, graceMs);
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
    setEncoding(encoding: 'utf8'): unknown;
    on(event: 'data', listener: (chunk: string) => void): unknown;
    destroy(): unknown;
  };
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit' | 'close', listener: (code: number | null) => void): unknown;
}
