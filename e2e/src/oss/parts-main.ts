import { readFileSync } from 'node:fs';

import { lzMutantsByLine, lzPartRanges } from './parts.ts';

const [path, file, parts, reportFile] = process.argv.slice(2);

if (path === undefined || file === undefined || parts === undefined) {
  throw new Error(
    'Usage: node e2e/src/oss/parts-main.ts <path to the file> <file as --mutate names it> <parts> [<mutation.json>]',
  );
}

const counts = reportFile === undefined ? undefined : lzMutantsByLine(reportFile, file);
const ranges = lzPartRanges(file, readFileSync(path, 'utf8'), Number(parts), (line) =>
  counts === undefined ? 1 : (counts.get(line) ?? 0),
);

if (ranges.length < Number(parts)) {
  process.stderr.write(`${file} has only ${ranges.length} parts between its top-level statements.\n`);
}

process.stdout.write(`${ranges.map((range) => `--mutate ${range}`).join('\n')}\n`);
