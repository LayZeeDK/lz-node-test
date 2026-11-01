import { lzMerge } from './merge.ts';
import { lzOssUsage, lzParseMergeOptions, lzWantsHelp } from './options.ts';

const args = process.argv.slice(2);

if (lzWantsHelp(args)) {
  process.stdout.write(`${lzOssUsage}\n`);
} else if (args.some((arg) => arg === '--merge' || arg.startsWith('--merge='))) {
  const { merge, out } = lzParseMergeOptions(args);

  process.stdout.write(`Wrote ${lzMerge(merge, out)}\n`);
} else {
  await import('./run.ts');
}
