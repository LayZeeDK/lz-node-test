import { createRequire } from 'node:module';

import { isObject, isString, member } from './guards.ts';
import { lzPackageName } from './operator.ts';

const ownPackageJson = '@layzee/lz-stryker-node-test-mutators/package.json';

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** Warns once for each version outside this package's peer range of @stryker-mutator/core. */
export function lzWarnOutsidePeerRange(versions: readonly string[], warn: (message: string) => void): void {
  const range = corePeerRange();
  const { major, minor, patch } = parseCaretFloor(range);

  [...new Set(versions)]
    .filter((version) => !inPeerRange(version, range))
    .forEach((version) => {
      warn(
        `${lzPackageName} accepts @stryker-mutator/instrumenter ${major}.${minor}.${patch} or a later ` +
          `${major}.x, not ${version}. Its install check passed, but it sees only this process, so mutants ` +
          'of its mutators may be missing.',
      );
    });
}

function corePeerRange(): string {
  const packageJson: unknown = createRequire(import.meta.url)(ownPackageJson);
  const peers = member(packageJson, 'peerDependencies', isObject, ownPackageJson);

  return member(peers, '@stryker-mutator/core', isString, ownPackageJson);
}

/** The first release of a caret range such as `^10.1.1`, the form of this package's peer range. */
export function parseCaretFloor(range: string): Version {
  const floor = range.startsWith('^') ? parseVersion(range.slice(1)) : undefined;

  if (floor === undefined) {
    throw new Error(`${lzPackageName}: ${range} is no caret range of a release.`);
  }

  return floor;
}

/** A release only: a prerelease or build suffix gives `undefined`. */
function parseVersion(text: string): Version | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);

  return match === null ? undefined : { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Whether the caret `range` takes `version`; as with npm's caret ranges, it takes no prerelease. */
export function inPeerRange(version: string, range: string): boolean {
  const floor = parseCaretFloor(range);
  const parsed = parseVersion(version);

  if (parsed === undefined) {
    return false;
  }

  return (
    parsed.major === floor.major &&
    (parsed.minor > floor.minor || (parsed.minor === floor.minor && parsed.patch >= floor.patch))
  );
}
