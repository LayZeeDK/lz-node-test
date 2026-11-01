import { readFileSync } from 'node:fs';

import { lzCompareReports } from './compare-reports.ts';
import { lzParseReport } from './report.ts';

const [firstFile, secondFile, ...extra] = process.argv.slice(2);

if (firstFile === undefined || secondFile === undefined || extra.length > 0) {
  throw new Error('Usage: node e2e/src/compare-reports-cli.ts <first mutation.json> <second mutation.json>');
}

const differences = lzCompareReports(
  lzParseReport(readFileSync(firstFile, 'utf8')),
  lzParseReport(readFileSync(secondFile, 'utf8')),
);

for (const difference of differences) {
  console.log(difference);
}

if (differences.length > 0) {
  process.exitCode = 1;
}
