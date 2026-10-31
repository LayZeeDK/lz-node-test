import type { Rule } from 'eslint';
import type { Comment } from 'estree';

/**
 * Stryker 10.1.1's directive pattern, `strykerCommentDirectiveRegex` in
 * `@stryker-mutator/instrumenter/dist/src/transformers/directive-bookkeeper.js`, which Stryker runs on each comment's
 * text. This copy names its groups and drops the `?` after the reason group: with the colon group optional and no end
 * anchor, a comment ending in `:` matches with no reason either way.
 */
const directive =
  /^\s?Stryker (?<type>disable|restore)(?: (?<scope>next-line))? (?<mutators>[a-zA-Z, ]+)(?::(?<reason>.+))?/;

/** Stryker trims and lowercases each name, and `all` matches every mutator. */
function mutatorNames(list: string): string[] {
  return list.split(',').map((name) => name.trim().toLowerCase());
}

/** Order, case, repeats and empty names do not change which mutators a list names. */
function mutatorSet(names: readonly string[]): string {
  return [...new Set(names.filter((name) => name !== ''))].sort().join(',');
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      all: 'Name the mutators instead of all; all also hides the mutants that nobody has looked at.',
      reason: 'Give a reason after the mutator list: // Stryker disable next-line <Mutator>: <reason>.',
      unrestored:
        'Restore the same mutators later in the file with // Stryker restore <Mutator>, or disable them for the next line only.',
      form: 'Use // Stryker disable next-line <Mutator>: <reason>, or a // Stryker restore of the same mutators after a file-wide disable.',
    },
  },
  create(context) {
    function report(comment: Comment, messageId: string): void {
      if (comment.loc) {
        context.report({ loc: comment.loc, messageId });
      }
    }

    return {
      Program() {
        const open: { readonly comment: Comment; readonly mutators: string }[] = [];

        for (const comment of context.sourceCode.getAllComments()) {
          const { type, scope, mutators, reason } = directive.exec(comment.value)?.groups ?? {};

          if (mutators === undefined) {
            continue;
          }

          const names = mutatorNames(mutators);

          if (names.includes('all')) {
            report(comment, 'all');

            continue;
          }

          const set = mutatorSet(names);

          if (type === 'disable') {
            if (!reason?.trim()) {
              report(comment, 'reason');
            }

            if (scope === undefined) {
              open.push({ comment, mutators: set });
            }

            continue;
          }

          const disable = open.findLastIndex((candidate) => candidate.mutators === set);

          if (scope === undefined && disable !== -1) {
            open.splice(disable, 1);
          } else {
            report(comment, 'form');
          }
        }

        for (const { comment } of open) {
          report(comment, 'unrestored');
        }
      },
    };
  },
};

export default rule;
