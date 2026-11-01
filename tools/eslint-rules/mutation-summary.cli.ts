import { readFile } from 'node:fs/promises';

import { lzMutationSummary } from './mutation-summary.ts';

const [reportFile, title] = process.argv.slice(2);

if (reportFile === undefined || title === undefined) {
  throw new Error('Usage: node tools/eslint-rules/mutation-summary.cli.ts <report.json> <title>');
}

const report: unknown = JSON.parse(await readFile(reportFile, 'utf8'));
process.stdout.write(lzMutationSummary(title, report));
