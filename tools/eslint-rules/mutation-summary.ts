import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const statuses = ['Killed', 'Survived', 'Timeout', 'NoCoverage', 'RuntimeError', 'CompileError'];

const malformedReport = "The mutation report does not match Stryker's JSON report schema.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStatuses(report: unknown): readonly string[] {
  const files = isRecord(report) ? report['files'] : undefined;

  if (!isRecord(files)) {
    throw new Error(malformedReport);
  }

  return Object.values(files).flatMap((result) => {
    const mutants = isRecord(result) ? result['mutants'] : undefined;

    if (!Array.isArray(mutants)) {
      throw new Error(malformedReport);
    }

    return mutants.map((mutant: unknown) => {
      const status = isRecord(mutant) ? mutant['status'] : undefined;

      if (typeof status !== 'string') {
        throw new Error(malformedReport);
      }

      return status;
    });
  });
}

/**
 * A Markdown section for a GitHub job summary: the mutation score of Stryker's JSON report and its mutants per status.
 * The score is Stryker's: Killed and Timeout mutants out of those plus Survived and NoCoverage ones.
 */
export function lzMutationSummary(title: string, report: unknown): string {
  const found = parseStatuses(report);
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

const [entry, reportFile, title] = process.argv.slice(1);

if (entry !== undefined && pathToFileURL(entry).href === import.meta.url) {
  if (reportFile === undefined || title === undefined) {
    throw new Error('Usage: node tools/eslint-rules/mutation-summary.ts <report.json> <title>');
  }

  const report: unknown = JSON.parse(await readFile(reportFile, 'utf8'));
  process.stdout.write(lzMutationSummary(title, report));
}
