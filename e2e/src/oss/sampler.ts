import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { lzExec } from '../exec.ts';
import { lzParseProcSamples, lzParseSamples, type LzProcessRow } from './processes.ts';

export interface LzSamples {
  /** Every complete sample, each a list of every process on the machine. */
  readonly samples: readonly (readonly LzProcessRow[])[];
  /** Why sampling stopped short or wrote an error; the samples taken before it still count. */
  readonly error: string | null;
}

export interface LzSampler {
  readonly pid: number;
  stop(): Promise<LzSamples>;
}

export interface LzProcessReader {
  readonly command: string;
  readonly args: readonly string[];
  readonly sample: string;
  readonly loop: string;
  readonly parse: typeof lzParseSamples;
}

const win32Sample =
  // Stryker disable next-line StringLiteral: Windows only, as the Linux run never starts PowerShell; the Windows run kills it
  "Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,CreationDate,Name | ForEach-Object { '{0} {1} {2} {3} {4}' -f $_.ProcessId, $_.ParentProcessId, $_.WorkingSetSize, $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }), $_.Name }; '--'";

const windowsReader: LzProcessReader = {
  command: 'pwsh',
  args: ['-NoProfile', '-NonInteractive', '-Command'],
  sample: win32Sample,
  // Stryker disable next-line StringLiteral: Windows only, as the Linux run never starts PowerShell; the Windows run kills it
  loop: `$ErrorActionPreference = 'Stop'; while ($true) { $start = Get-Date; ${win32Sample}; $wait = 1000 - ((Get-Date) - $start).TotalMilliseconds; if ($wait -gt 0) { Start-Sleep -Milliseconds $wait } }`,
  parse: lzParseSamples,
};

// Each stat line, a tab and the command line with its NULs, newlines and tabs turned into spaces. A process that
// ends between the glob and the reads is skipped, and its read errors are dropped.
const procSample =
  'for d in /proc/[0-9]*; do { read -r s < "$d/stat" && c=$(tr \'\\0\\n\\t\' \'   \' < "$d/cmdline") && ' +
  'printf \'%s\\t%s\\n\' "$s" "$c"; } 2>/dev/null; done; echo --';

const linuxReader: LzProcessReader = {
  command: 'sh',
  args: ['-c'],
  sample: `getconf PAGESIZE; ${procSample}`,
  loop: `getconf PAGESIZE; while :; do ${procSample}; sleep 1; done`,
  parse: lzParseProcSamples,
};

/** Samples every process once a second, in one shell process, until `stop`. */
export async function lzStartSampler({ command, args, loop, parse } = lzProcessReader()): Promise<LzSampler> {
  // Stryker disable next-line BooleanLiteral: equivalent to a test, as a console window shown or hidden changes no output it can read
  const child = spawn(command, [...args, loop], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  await once(child, 'spawn');

  const chunks: string[] = [];
  const errors: string[] = [];
  const closed = once(child, 'close');

  child.stdout.setEncoding('utf8').on('data', (chunk: string) => chunks.push(chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => errors.push(chunk));

  if (child.pid === undefined) {
    // Stryker disable next-line StringLiteral: unreachable, as a child that emitted spawn has a pid
    throw new Error('The process sampler did not start.');
  }

  return {
    pid: child.pid,
    async stop() {
      child.kill('SIGTERM');
      await closed;

      const endedByStop = child.signalCode === 'SIGTERM';
      const error =
        errors.length > 0
          ? `The process sampler failed:\n${errors.join('')}`
          : endedByStop
            ? null
            : `The process sampler ended early, with ${child.signalCode ?? `exit code ${String(child.exitCode)}`}.`;

      return { samples: parse(chunks.join('')), error };
    },
  };
}

/** One sample of every process on the machine. */
export async function lzSnapshot(
  { command, args, sample: script, parse } = lzProcessReader(),
): Promise<LzProcessRow[]> {
  const { exitCode, stdout, stderr } = await lzExec(command, [...args, script], { cwd: process.cwd() });
  const [sample] = parse(stdout);

  if (exitCode !== 0 || stderr !== '' || sample === undefined) {
    throw new Error(`The process snapshot failed with exit code ${exitCode}:\n${stderr}`);
  }

  return sample;
}

/** The reader for `platform`, this one by default. */
export function lzProcessReader(platform: NodeJS.Platform = process.platform): LzProcessReader {
  if (platform === 'win32') {
    return windowsReader;
  }

  if (platform === 'linux') {
    return linuxReader;
  }

  throw new Error(`The process sampler reads Win32_Process or /proc; ${platform} has neither.`);
}
