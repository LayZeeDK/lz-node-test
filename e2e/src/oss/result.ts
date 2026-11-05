import { lzIsRecord, lzIsStrings } from '../report.ts';
import type { LzOssPatch } from './options.ts';
import type { LzProcessPeaks } from './processes.ts';
import type { LzBySide, LzComparison, LzMutantsScore } from './verdicts.ts';

/** What the project's copy ran with on both sides; the command side's `node --test` flags are in its strykerConfig. */
export interface LzProjectSetup {
  readonly mutate: readonly string[];
  readonly testFiles: readonly string[];
  readonly patches: readonly LzOssPatch[];
}

/**
 * The header fields that decide a run's verdicts beyond its sides' Stryker configurations: a merge matches them across
 * its runs, and a checkpoint is kept only under the same ones.
 */
export interface LzDecidingFields {
  readonly project: string;
  readonly sourceCommit: string;
  readonly node: string;
  readonly platform: string;
  /** Stryker's `timeoutMS` from `--mutant-timeout-ms`; null for Stryker's default. */
  readonly mutantTimeoutMs: number | null;
  /** sha256 of lzInstalledVersions of the copy: a clone without a lockfile can install newer dependencies on a rerun. */
  readonly installedDigest: string;
  /** sha256 of each tarball, sorted: every package is version 0.0.0, so the names cannot tell builds apart. */
  readonly tarballDigests: readonly string[];
  readonly projectSetup: LzProjectSetup;
}

/** Keyed by the interface, so the compiler refuses a field added there and missing here. */
const decidingFieldSet: Readonly<Record<keyof LzDecidingFields, null>> = {
  project: null,
  sourceCommit: null,
  node: null,
  platform: null,
  mutantTimeoutMs: null,
  installedDigest: null,
  tarballDigests: null,
  projectSetup: null,
};

export const lzDecidingFields: readonly (keyof LzDecidingFields)[] = Object.keys(decidingFieldSet).filter(
  (field): field is keyof LzDecidingFields => field in decidingFieldSet,
);

export interface LzOssHeader extends LzDecidingFields {
  readonly source: string;
  readonly workspaceCommit: string;
  readonly concurrency: number;
  readonly timeLimitMinutes: number;
  /** The `--mutate` patterns; empty when the run mutated the project's whole set. */
  readonly mutate: readonly string[];
  readonly tarballs: readonly string[];
  /** What installedDigest hashes, so a merge that refuses two digests can name the packages that differ. */
  readonly installedVersions: readonly string[];
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
  /** lzStrykerConfig of the side, which a merge matches across its batches of the side. */
  readonly strykerConfig: string;
  readonly processes: LzProcessPeaks & { readonly leftover: readonly LzLeftover[] };
  readonly newInOsTmp: readonly string[];
  readonly leftoverStrykerTmp: readonly string[];
}

/** The result.json of a run, with each side's `<side>.mutation.json` beside it. */
export type LzOssResult = LzOssHeader &
  ({ readonly preparedIn: string } | ({ readonly sides: LzBySide<LzSideResult> } & LzComparison));

/** What a merge needs of a run's result.json: the deciding fields as written, and each side's entry as written. */
export interface LzParsedOssResult {
  readonly project: string;
  readonly deciding: ReadonlyMap<keyof LzDecidingFields, unknown>;
  /** Undefined for a run of a driver that did not record them. */
  readonly installedVersions: readonly string[] | undefined;
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
    const missing = lzDecidingFields.find((field) => !(field in value));

    if (missing !== undefined) {
      throw new Error(`${file} is not the result.json of a driver run that a merge can read: it lacks ${missing}.`);
    }

    const { project, sides, installedVersions } = value;

    if (typeof project === 'string' && lzIsRecord(sides)) {
      return {
        project,
        deciding: new Map(lzDecidingFields.map((field) => [field, value[field]])),
        installedVersions: lzIsStrings(installedVersions) ? installedVersions : undefined,
        sides,
      };
    }
  }

  throw new Error(`${file} is not the result.json of a driver run.`);
}

/** The result.json of a merge, which writes no `<side>.mutation.json`. */
export type LzMergeResult = {
  readonly project: string;
  readonly mergedFrom: readonly string[];
  readonly scores: LzBySide<LzMutantsScore>;
} & LzComparison;
