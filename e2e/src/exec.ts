import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { text } from 'node:stream/consumers';

export interface LzExecResult {
  /** 1 for a process that a signal ended. */
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Whether the process ran past `timeoutMs` and was ended. */
  readonly timedOut: boolean;
}

export interface LzExecOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Ends the process after this long; 0 waits for it however long it runs. */
  readonly timeoutMs?: number;
}

/**
 * Runs `file` with `args` to its end and collects both streams. Never rejects on a non-zero exit; it rejects only when
 * the process cannot start. A timeout ends the process alone, not the processes it started.
 */
export async function lzExec(
  file: string,
  args: readonly string[],
  { cwd, env = process.env, timeoutMs = 0 }: LzExecOptions,
): Promise<LzExecResult> {
  const child = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          child.kill();
        }, timeoutMs)
      : undefined;

  try {
    const closed: Promise<unknown[]> = once(child, 'close');
    const [stdout, stderr, [code]] = await Promise.all([text(child.stdout), text(child.stderr), closed]);

    return { exitCode: typeof code === 'number' ? code : 1, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}
