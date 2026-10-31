import { lzOssUsage, lzWantsHelp } from './options.ts';

if (lzWantsHelp(process.argv.slice(2))) {
  process.stdout.write(`${lzOssUsage}\n`);
} else {
  await import('./run.ts');
}
