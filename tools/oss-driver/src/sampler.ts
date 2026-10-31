import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { lzExec } from '../../../e2e/src/exec.ts';
import { lzParseSamples, type LzProcessRow } from './driver.ts';

export interface LzSampler {
  readonly pid: number;
  /** Ends the sampler and returns every complete sample it took, each a list of every process on the machine. */
  stop(): Promise<LzProcessRow[][]>;
}

const sampleScript =
  "Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,CreationDate,Name | ForEach-Object { '{0} {1} {2} {3} {4}' -f $_.ProcessId, $_.ParentProcessId, $_.WorkingSetSize, $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }), $_.Name }; '--'";

/** Samples every process once a second, in one PowerShell process, until `stop`. */
export function lzStartSampler(): LzSampler {
  const child = spawn(pwsh(), [...pwshArgs, loopScript()], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const chunks: string[] = [];
  const errors: string[] = [];
  const closed = once(child, 'close');

  child.stdout.setEncoding('utf8').on('data', (chunk: string) => chunks.push(chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => errors.push(chunk));

  if (child.pid === undefined) {
    throw new Error('The process sampler did not start.');
  }

  return {
    pid: child.pid,
    async stop() {
      child.kill();
      await closed;

      if (errors.length > 0) {
        throw new Error(`The process sampler failed:\n${errors.join('')}`);
      }

      return lzParseSamples(chunks.join(''));
    },
  };
}

/** One sample of every process on the machine. */
export async function lzSnapshot(): Promise<LzProcessRow[]> {
  const { exitCode, stdout, stderr } = await lzExec(pwsh(), [...pwshArgs, sampleScript], { cwd: process.cwd() });
  const [sample] = lzParseSamples(stdout);

  if (exitCode !== 0 || sample === undefined) {
    throw new Error(`The process snapshot failed with exit code ${exitCode}:\n${stderr}`);
  }

  return sample;
}

const pwshArgs: readonly string[] = ['-NoProfile', '-NonInteractive', '-Command'];

// ponytail: Windows only; a Linux run needs a `ps -eo pid=,ppid=,rss=,lstart=,comm=` reader in this file.
function pwsh(): string {
  if (process.platform !== 'win32') {
    throw new Error(`The process sampler reads Win32_Process; ${process.platform} has no reader yet.`);
  }

  return 'pwsh';
}

function loopScript(): string {
  return `$ErrorActionPreference = 'Stop'; while ($true) { $start = Get-Date; ${sampleScript}; $wait = 1000 - ((Get-Date) - $start).TotalMilliseconds; if ($wait -gt 0) { Start-Sleep -Milliseconds $wait } }`;
}
