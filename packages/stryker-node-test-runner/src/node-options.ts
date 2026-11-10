/** NODE_OPTIONS split as node splits it: at whitespace outside double quotes, which stay in each argument. */
export function lzNodeOptionArgs(nodeOptions: string | undefined): string[] {
  return nodeOptions?.match(/(?:[^\s"]|"(?:[^"\\]|\\.)*")+/g) ?? [];
}

/**
 * What follows the option `name` in `arg`: `''` for the bare flag, `=` and its value for one with a value, or nothing
 * when `arg` is another option. An argument may be quoted, as in NODE_OPTIONS, and node reads `_` in an option's name
 * as `-`.
 */
function optionRest(arg: string, name: string): string | undefined {
  const option = arg.replaceAll('"', '').replace(/[^=]*/, (optionName) => optionName.replaceAll('_', '-'));

  return option === name || option.startsWith(`${name}=`) ? option.slice(name.length) : undefined;
}

// Stryker disable next-line StringLiteral: equivalent, as any default but a bare reporter option keeps the first argument
const reporterOption = (arg = '') =>
  optionRest(arg, '--test-reporter') ?? optionRest(arg, '--test-reporter-destination');

/** Whether `arg` adds a node:test reporter or a reporter destination, or is the value of a bare one before it. */
function isReporterArg(arg: string, index: number, args: readonly string[]): boolean {
  return reporterOption(arg) !== undefined || reporterOption(args[index - 1]) === '';
}

/**
 * Leaves out node's options that add a node:test reporter or a reporter destination, with their values, so the
 * runner's reporter is the only one; node refuses more reporters than destinations.
 */
export function withoutReporters(args: readonly string[]): string[] {
  return args.filter((arg, index) => !isReporterArg(arg, index, args));
}

/** The options, with their values, that `withoutReporters` leaves out of `args`. */
export function lzReporterArgs(args: readonly string[]): string[] {
  return args.filter(isReporterArg);
}

/** The arguments of NODE_OPTIONS in `base` that a test file runs with, after the runner's hook. */
export function lzConsumerNodeOptions(base: NodeJS.ProcessEnv): string[] {
  return withoutReporters(lzNodeOptionArgs(base['NODE_OPTIONS']));
}

/**
 * Whether node runs with --test-only, from its NODE_OPTIONS and then `execArgv`, which takes precedence. The last of
 * `--test-only`, `--test-only=<value>` and `--no-test-only` wins; node reads any value as on, `false` too.
 */
export function lzTestOnly(execArgv: readonly string[], nodeOptions: string | undefined): boolean {
  let testOnly = false;

  for (const arg of [...lzNodeOptionArgs(nodeOptions), ...execArgv]) {
    if (optionRest(arg, '--no-test-only') === '') {
      testOnly = false;
    } else if (optionRest(arg, '--test-only') !== undefined) {
      testOnly = true;
    }
  }

  return testOnly;
}
