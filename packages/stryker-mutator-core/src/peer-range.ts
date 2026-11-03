export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Warns once for each version below `floor` or in a later major, the versions a caret range leaves out. */
export function lzWarnOutsidePeerRange(
  packageName: string,
  floor: Version,
  versions: readonly string[],
  warn: (message: string) => void,
): void {
  const { major, minor, patch } = floor;

  [...new Set(versions)]
    .filter((version) => !inPeerRange(version, floor))
    .forEach((version) => {
      warn(
        `${packageName} accepts @stryker-mutator/instrumenter ${major}.${minor}.${patch} or a later ` +
          `${major}.x, not ${version}. Its install check passed, but it sees only this process, so mutants ` +
          'of its mutators may be missing.',
      );
    });
}

/** The first release of a caret range such as `^10.1.1`; `packageName`, whose range it is, starts the error. */
export function parseCaretFloor(range: string, packageName: string): Version {
  const floor = range.startsWith('^') ? parseVersion(range.slice(1)) : undefined;

  if (floor === undefined) {
    throw new Error(`${packageName}: ${range} is no caret range of a release.`);
  }

  return floor;
}

/** A release only: a prerelease or build suffix gives `undefined`. */
function parseVersion(text: string): Version | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);

  return match === null ? undefined : { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Whether the caret range from `floor` takes `version`; as with npm's caret ranges, it takes no prerelease. */
export function inPeerRange(version: string, floor: Version): boolean {
  const parsed = parseVersion(version);

  if (parsed === undefined) {
    return false;
  }

  return (
    parsed.major === floor.major &&
    (parsed.minor > floor.minor || (parsed.minor === floor.minor && parsed.patch >= floor.patch))
  );
}
