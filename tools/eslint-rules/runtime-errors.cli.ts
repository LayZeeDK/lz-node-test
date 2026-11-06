import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { lzCheckRuntimeErrors, lzScoresAnyMutant } from './runtime-errors.ts';

const [reportFile] = process.argv.slice(2);

if (reportFile === undefined) {
  throw new Error('Usage: node tools/eslint-rules/runtime-errors.cli.ts <report.json>');
}

if (!lzScoresAnyMutant(JSON.parse(await readFile(reportFile, 'utf8')))) {
  process.stderr.write(
    'Stryker scored no mutant, so its mutation score says nothing. Check that the mutate patterns match files ' +
      'with code to mutate.\n',
  );
  process.exitCode = 1;
}

const unrecorded = await lzCheckRuntimeErrors(reportFile, join(import.meta.dirname, 'runtime-errors.json'));

if (unrecorded.length > 0) {
  process.stderr.write(
    'Stryker left RuntimeError mutants out of the mutation score. Kill each one with a test, or record why it ' +
      `cannot be killed in tools/eslint-rules/runtime-errors.json:\n${unrecorded.map((line) => `  ${line}\n`).join('')}`,
  );
  process.exitCode = 1;
}
