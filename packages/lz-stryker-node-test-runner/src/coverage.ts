import type { MutantCoverage } from '@stryker-mutator/api/core';

import type { LzTimeWindow, ProcessRecord } from './record.ts';

/** Adds up the hits of `coverages`, static and by test. */
export function lzMergeCoverage(coverages: readonly (MutantCoverage | undefined)[]): MutantCoverage {
  const total: MutantCoverage = { static: {}, perTest: {} };
  const add = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [mutantId, hits] of Object.entries(from)) {
      into[mutantId] = (into[mutantId] ?? 0) + hits;
    }
  };

  for (const coverage of coverages) {
    if (!coverage) {
      continue;
    }

    add(total.static, coverage.static);

    for (const [testId, hits] of Object.entries(coverage.perTest)) {
      add((total.perTest[testId] ??= {}), hits);
    }
  }

  return total;
}

/** Adds up the hits of `coverages` as static, those inside tests too, as Stryker's coverage analysis `all` expects. */
export function lzMergeAsStatic(coverages: readonly (MutantCoverage | undefined)[]): MutantCoverage {
  const { static: hits, perTest } = lzMergeCoverage(coverages);

  return lzMergeCoverage([hits, ...Object.values(perTest)].map((ofTest) => ({ static: ofTest, perTest: {} })));
}

/**
 * A process or thread reads its current test once, when it starts, so it puts all its hits under that test. They go to
 * every test that was current while it lived instead, which can add tests to a mutant's run but not drop the one that
 * reaches it, and to static as well when it lived while no test was current. Its life counts from the start of the
 * span of the test it read, as it starts before its hook runs. Without its lifetime or the file's spans, its hits
 * count as static.
 */
export function lzOverlapCoverage(
  record: ProcessRecord,
  testSpans: ProcessRecord['testSpans'],
): MutantCoverage | undefined {
  const { mutantCoverage: coverage, lifetime } = record;

  if (!coverage || record.main) {
    return coverage;
  }

  if (!lifetime || !testSpans) {
    return lzMergeAsStatic([coverage]);
  }

  const timeline = Object.values(testSpans)
    .flat()
    .toSorted((a, b) => a.start - b.start);
  const attributed = Object.entries(coverage.perTest).map(([test, hits]): MutantCoverage => {
    const life = { start: anchoredStart(testSpans[test], lifetime), end: lifetime.end };

    return {
      static: coversWholly(timeline, life) ? {} : hits,
      perTest: Object.fromEntries(testsOverlapping(testSpans, life).map((id) => [id, hits])),
    };
  });

  return lzMergeCoverage([{ static: coverage.static, perTest: {} }, ...attributed]);
}

/** The start of the latest span of `spansOfTest` that began by the start of `lifetime`, or else that start. */
function anchoredStart(spansOfTest: readonly LzTimeWindow[] | undefined, lifetime: LzTimeWindow): number {
  return spansOfTest?.findLast((span) => span.start <= lifetime.start)?.start ?? lifetime.start;
}

/** The tests with a span that overlaps `window`. */
function testsOverlapping(
  testSpans: Readonly<Record<string, readonly LzTimeWindow[]>>,
  window: LzTimeWindow,
): readonly string[] {
  return Object.entries(testSpans)
    .filter(([, spans]) => spans.some((span) => span.start <= window.end && window.start < span.end))
    .map(([id]) => id);
}

/** Whether `timeline`, the spans of every test sorted by start, leaves no part of `window` outside them. */
function coversWholly(timeline: readonly LzTimeWindow[], window: LzTimeWindow): boolean {
  const coveredUntil = timeline.reduce(
    (until, span) => (span.start <= until ? Math.max(until, span.end) : until),
    window.start,
  );

  return coveredUntil > window.end;
}
