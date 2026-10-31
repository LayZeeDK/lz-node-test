/** NODE_OPTIONS split as node splits it: at whitespace outside double quotes, which stay in each argument. */
export function lzNodeOptionArgs(nodeOptions: string | undefined): string[] {
  return nodeOptions?.match(/(?:[^\s"]|"(?:[^"\\]|\\.)*")+/g) ?? [];
}

/**
 * Whether node runs with --test-only, from its NODE_OPTIONS and then `execArgv`, which takes precedence. The last of
 * `--test-only`, `--test-only=<value>` and `--no-test-only` wins; node reads any value as on, `false` too.
 */
export function lzTestOnly(execArgv: readonly string[], nodeOptions: string | undefined): boolean {
  let testOnly = false;

  for (const arg of [...lzNodeOptionArgs(nodeOptions), ...execArgv]) {
    const option = arg.replaceAll('"', '');

    if (option === '--no-test-only') {
      testOnly = false;
    } else if (/^--test-only(?:=|$)/.test(option)) {
      testOnly = true;
    }
  }

  return testOnly;
}
