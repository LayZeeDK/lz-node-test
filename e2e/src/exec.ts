import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, openSync, writeSync } from 'node:fs';
import type { Readable } from 'node:stream';

export interface LzExecResult {
  /** 1 when a signal ended the process. */
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Set by the timer, as a process that handles the signal, such as Stryker on Linux, exits with its own code. */
  readonly timedOut: boolean;
}

export interface LzExecOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  /** Receives stdout and stderr as they arrive, so a long run can be followed. */
  readonly logFile?: string | undefined;
}

/** A timeout ends the process alone, not the processes it started. */
export async function lzExec(
  file: string,
  args: readonly string[],
  { cwd, env = process.env, timeoutMs = 0, logFile }: LzExecOptions,
): Promise<LzExecResult> {
  const child = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const closed = once(child, 'close');
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, timeoutMs)
      : undefined;
  // 'close' also waits for the processes the child started that still hold its stdout or stderr.
  child.once('exit', () => clearTimeout(timer));
  const log = logFile === undefined ? undefined : openSync(logFile, 'w');
  const collect = (stream: Readable): string[] => {
    const chunks: string[] = [];

    stream.setEncoding('utf8').on('data', (chunk: string) => {
      chunks.push(chunk);

      if (log !== undefined) {
        writeSync(log, chunk);
      }
    });

    return chunks;
  };
  const out = collect(child.stdout);
  const err = collect(child.stderr);

  try {
    await closed;
  } finally {
    clearTimeout(timer);
  }

  if (log !== undefined) {
    closeSync(log);
  }

  return {
    exitCode: child.exitCode ?? 1,
    signal: child.signalCode,
    stdout: out.join(''),
    stderr: err.join(''),
    timedOut,
  };
}
