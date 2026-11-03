import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, openSync, writeSync } from 'node:fs';
import type { Readable } from 'node:stream';

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
  /** Receives stdout and stderr as they arrive, so a long run can be followed. */
  readonly logFile?: string | undefined;
}

/** A timeout ends the process alone, not the processes it started. */
export async function lzExec(
  file: string,
  args: readonly string[],
  { cwd, env = process.env, timeoutMs = 0, logFile }: LzExecOptions,
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
  const [code, signal] = await closed;

  if (log !== undefined) {
    closeSync(log);
  }

  return {
    exitCode: typeof code === 'number' ? code : 1,
    stdout: out.join(''),
    stderr: err.join(''),
    timedOut: timeoutMs > 0 && signal === timeoutSignal,
  };
}
