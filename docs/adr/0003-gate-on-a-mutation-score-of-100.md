---
status: accepted
---

# Gate every project on a mutation score of 100, on every pull request push

Every Stryker configuration sets `thresholds` to `{ high: 100, low: 100, break: 100 }`, so a surviving mutant fails the
build. The mutation score is the workspace's only measure of its tests. There is no code coverage tool, because a
mutant in code that no test reaches is `NoCoverage`, which already keeps the score below 100. Mutation testing runs on
every pull request push and every push to `main`. When it got slow, the runs were made faster instead of less
frequent.

## Considered options

- A code coverage tool beside the score: it would add a number that the score already accounts for.
- A lower break threshold, or Stryker's default of no break: survivors would accumulate, and the score would no longer
  show that the tests catch every mutant.
- Mutation testing only on pushes to `main`: a change would merge before its survivors showed.

## Consequences

- Code in which no mutator makes a mutant, and mutants that a configuration excludes or Stryker ignores, do not show
  in the score.
- Pull requests run Stryker's incremental mode from a cache, and pushes to `main` run with `--force`, because an
  incremental run was measured reusing a static mutant's `Survived` result after a test that kills it was added. The
  cache key holds every input Stryker cannot see.
- A newer push cancels a pull request's running mutation jobs. Pushes to `main` are never cancelled, so the baseline
  stays complete.
- The runner's source configuration runs as three CI shards. With the break at 100, every shard passing means the same
  as the whole run passing.
- Two checks close gaps in `break: 100`. A run whose `mutate` patterns match no file scores `NaN` and would pass.
  Stryker leaves `RuntimeError` mutants out of the score, so each such mutant must be listed with a reason.
- Tests pin every configuration's thresholds at 100 and keep the `mutate` globs from shrinking.

Evidence: 640d51b, f25956a, c0a886e, e9c15fe, 6d28f6e, 58dec84, 982e00d, 2273666, 3ae9b49, 6e9ace0.
