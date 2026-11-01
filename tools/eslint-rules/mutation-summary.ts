import { lzParseReport } from './runtime-errors.ts';

const statuses = ['Killed', 'Survived', 'Timeout', 'NoCoverage', 'RuntimeError', 'CompileError'];

/**
 * A Markdown section for a GitHub job summary: the mutation score of Stryker's JSON report and its mutants per status.
 * The score is Stryker's: Killed and Timeout mutants out of those plus Survived and NoCoverage ones.
 */
export function lzMutationSummary(title: string, report: unknown): string {
  const found = lzParseReport(report).flatMap(([, mutants]) => mutants.map(({ status }) => status));
  const count = (status: string): number => found.filter((each) => each === status).length;
  const detected = count('Killed') + count('Timeout');
  const valid = detected + count('Survived') + count('NoCoverage');
  const score = valid === 0 ? 'n/a' : ((detected / valid) * 100).toFixed(2);

  return [
    `### Mutation score: ${title}`,
    '',
    `| Mutation score | ${statuses.join(' | ')} |`,
    `| ${['---:', ...statuses.map(() => '---:')].join(' | ')} |`,
    `| ${[score, ...statuses.map(count)].join(' | ')} |`,
    '',
  ].join('\n');
}
