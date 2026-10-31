import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { text } from 'node:stream/consumers';

export interface LzExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export interface LzExecOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

/** A timeout ends the process alone, not the processes it started. */
export async function lzExec(
  file: string,
  args: readonly string[],
  { cwd, env = process.env, timeoutMs = 0 }: LzExecOptions,
): Promise<LzExecResult> {
  const timeoutSignal = 'SIGTERM';
  const child = spawn(file, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeoutMs,
    killSignal: timeoutSignal,
    windowsHide: true,
  });
  const closed: Promise<unknown[]> = once(child, 'close');
  const [stdout, stderr, [code, signal]] = await Promise.all([text(child.stdout), text(child.stderr), closed]);

  return {
    exitCode: typeof code === 'number' ? code : 1,
    stdout,
    stderr,
    timedOut: timeoutMs > 0 && signal === timeoutSignal,
  };
}
