import { lzIsRecord } from '../report.ts';
import type { LzProcessPeaks } from './processes.ts';
import type { LzBySide, LzComparison, LzMutantsScore } from './verdicts.ts';

export interface LzOssHeader {
  readonly project: string;
  readonly source: string;
  readonly sourceCommit: string;
  readonly workspaceCommit: string;
  readonly node: string;
  readonly platform: string;
  readonly concurrency: number;
  readonly timeLimitMinutes: number;
  /** Stryker's `timeoutMS` from `--mutant-timeout-ms`; null for Stryker's default. */
  readonly mutantTimeoutMs: number | null;
  /** The `--mutate` patterns; empty when the run mutated the project's whole set. */
  readonly mutate: readonly string[];
  readonly tarballs: readonly string[];
  readonly startedAt: string;
}

export interface LzLeftover {
  readonly pid: number;
  readonly name: string;
  readonly endedByDriver: boolean;
}

export interface LzStrykerResult extends LzMutantsScore {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly reported: boolean;
  readonly leftoverInRunTmp: readonly string[];
}

export interface LzSideResult {
  /** Null when the Stryker run itself threw; `errors` says why. */
  readonly stryker: LzStrykerResult | null;
  /** Each step that threw, so a failed step leaves the result of the others. */
  readonly errors: readonly string[];
  /** For a resumed side, the last run's time only. */
  readonly wallMs: number;
  /**
   * Mutants in the checkpoint that an earlier run of the same part left when it ended before its report; Stryker
   * retests those whose code or tests changed.
   */
  readonly resumedMutants: number;
  /** lzSideSetup of the run, which a merge matches across its runs in place of the workspace commit. */
  readonly setup: string;
  readonly processes: LzProcessPeaks & { readonly leftover: readonly LzLeftover[] };
  readonly newInOsTmp: readonly string[];
  readonly leftoverStrykerTmp: readonly string[];
}

/** The result.json of a run, with each side's `<side>.mutation.json` beside it. */
export type LzOssResult = LzOssHeader &
  ({ readonly preparedIn: string } | ({ readonly sides: LzBySide<LzSideResult> } & LzComparison));

/** What a merge needs of a run's result.json: the header fields it matches, and each side's entry as written. */
export interface LzParsedOssResult {
  readonly project: string;
  readonly sourceCommit: string;
  readonly node: string;
  readonly platform: string;
  readonly mutantTimeoutMs: number | null;
  readonly tarballs: readonly string[];
  readonly sides: Readonly<Record<string, unknown>>;
}

/** Reads the parsed JSON of a driver run's result.json, refusing a merge's result and anything that is not a run's. */
export function lzParseOssResult(file: string, value: unknown): LzParsedOssResult {
  if (lzIsRecord(value) && 'mergedFrom' in value) {
    throw new Error(
      `${file} is the result of a merge; merges do not compose, so merge the runs it lists in mergedFrom.`,
    );
  }

  if (lzIsRecord(value)) {
    const { project, sourceCommit, node, platform, mutantTimeoutMs, tarballs, sides } = value;

    if (
      typeof project === 'string' &&
      typeof sourceCommit === 'string' &&
      typeof node === 'string' &&
      typeof platform === 'string' &&
      (typeof mutantTimeoutMs === 'number' || mutantTimeoutMs === null) &&
      isStrings(tarballs) &&
      lzIsRecord(sides)
    ) {
      return { project, sourceCommit, node, platform, mutantTimeoutMs, tarballs, sides };
    }
  }

  throw new Error(`${file} is not the result.json of a driver run.`);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

/** The result.json of a merge, which writes no `<side>.mutation.json`. */
export type LzMergeResult = {
  readonly project: string;
  readonly mergedFrom: readonly string[];
  readonly scores: LzBySide<LzMutantsScore>;
} & LzComparison;
