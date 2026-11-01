import { lzMerge } from './merge.ts';
import { lzOssUsage, lzParseCommand } from './options.ts';
import { lzRunDriver } from './run.ts';

const command = lzParseCommand(process.argv.slice(2));

switch (command.kind) {
  case 'help': {
    process.stdout.write(`${lzOssUsage}\n`);
    break;
  }
  case 'merge': {
    process.stdout.write(`Wrote ${lzMerge(command.options.merge, command.options.out)}\n`);
    break;
  }
  case 'run': {
    await lzRunDriver(command.options);
    break;
  }
}
