import type { NodePath, types } from '@babel/core';

/** The members of the Babel types that the mutators may call; the install checks the instrumenter's for each. */
export const mutatorBuilders = Object.freeze([
  'arrowFunctionExpression',
  'binaryExpression',
  'blockStatement',
  'booleanLiteral',
  'callExpression',
  'cloneNode',
  'conditionalExpression',
  'emptyStatement',
  'identifier',
  'memberExpression',
  'newExpression',
  'numericLiteral',
  'parenthesizedExpression',
  'stringLiteral',
  'throwStatement',
  'unaryExpression',
] satisfies (keyof typeof types)[]);

export type LzBabelTypes = Pick<typeof types, (typeof mutatorBuilders)[number]>;

/** A mutator, free of Stryker: it maps a Babel path to replacement nodes. */
export interface LzMutator<TName extends string = string> {
  /**
   * Letters only, as Stryker's directives match no other character; PascalCase, like Stryker's own mutators. Reports
   * show it, and `excludedMutations` and `// Stryker disable` comments select the mutator by it.
   */
  readonly name: TName;
  /** A TypeScript module in which the mutator makes a mutant; the install's self-check instruments it. */
  readonly sample: string;
  readonly mutate: (path: NodePath, t: LzBabelTypes) => Iterable<types.Node>;
  /**
   * Stryker's mutator filter: once the instrumenter leaves a node this mutator mutated, it passes every mutant made in
   * that node, and `false` drops this mutator's mutants of the node.
   */
  readonly filter?: (mutantsInScope: readonly unknown[]) => boolean;
}

/** The shape of Stryker's `NodeMutator`, which the instrumenter's exports keep out of reach. */
export interface LzNodeMutatorLike {
  readonly name: string;
  mutate(path: NodePath, context: { readonly isExpressionContext: boolean }): Iterable<types.Node>;
  readonly filter?: ((mutantsInScope: readonly unknown[]) => boolean) | undefined;
}

/**
 * Marks the mutators of every package that installs through this one, in every copy of it, with the name of the package
 * that installed each.
 */
export const own = Symbol.for('@layzee/stryker-mutator-core');

interface OwnMutator extends LzNodeMutatorLike {
  readonly [own]: string;
}

/** Yields nothing where Stryker's instrumenter allows no statement, such as a Vue template's expression. */
export function lzToNodeMutator(mutator: LzMutator, t: LzBabelTypes, packageName: string): OwnMutator {
  return {
    name: mutator.name,
    [own]: packageName,
    filter: mutator.filter,
    *mutate(path, { isExpressionContext }) {
      if (!isExpressionContext) {
        yield* mutator.mutate(path, t);
      }
    },
  };
}

export function lzIsOwn(mutator: object): boolean {
  return own in mutator;
}

/** The package that installed `mutator`, or `undefined` for one of Stryker's. */
export function ownerOf(mutator: object): unknown {
  return Reflect.get(mutator, own);
}
