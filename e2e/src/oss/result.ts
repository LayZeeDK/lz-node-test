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
  readonly wallMs: number;
  readonly processes: LzProcessPeaks & { readonly leftover: readonly LzLeftover[] };
  readonly newInOsTmp: readonly string[];
  readonly leftoverStrykerTmp: readonly string[];
}

/** The result.json of a run, with each side's `<side>.mutation.json` beside it. */
export type LzOssResult = LzOssHeader &
  ({ readonly preparedIn: string } | ({ readonly sides: LzBySide<LzSideResult> } & LzComparison));

/** The result.json of a merge, which writes no `<side>.mutation.json`. */
export type LzMergeResult = {
  readonly project: string;
  readonly mergedFrom: readonly string[];
  readonly scores: LzBySide<LzMutantsScore>;
} & LzComparison;
