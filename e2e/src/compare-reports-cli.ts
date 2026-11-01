import { readFileSync } from 'node:fs';

import { lzCompareReports } from './compare-reports.ts';
import { lzParseReport } from './report.ts';

const [first, second] = process.argv.slice(2).map((file) => lzParseReport(readFileSync(file, 'utf8')));

if (first === undefined || second === undefined) {
  throw new Error('Usage: node e2e/src/compare-reports-cli.ts <first mutation.json> <second mutation.json>');
}

const differences = lzCompareReports(first, second);

for (const difference of differences) {
  console.log(difference);
}

if (differences.length > 0) {
  process.exitCode = 1;
}
