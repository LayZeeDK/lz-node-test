import type { NodePath, types } from '@babel/core';

import { lzPackageName } from './package-name.ts';

/** The members of the Babel types that the operators may call; the install checks the instrumenter's for each. */
export const operatorBuilders = Object.freeze([
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
] satisfies (keyof typeof types)[]);

export type BabelTypes = Pick<typeof types, (typeof operatorBuilders)[number]>;

/** A mutation operator, free of Stryker: it maps a Babel path to replacement nodes. */
export interface Operator {
  /**
   * Letters only, as Stryker's directives match no other character; PascalCase, like Stryker's own mutators. Reports
   * show it, and `excludedMutations` and `// Stryker disable` comments select the operator by it.
   */
  readonly name: string;
  /** A TypeScript module in which the operator makes a mutant; the install's self-check instruments it. */
  readonly sample: string;
  mutate(path: NodePath, t: BabelTypes): Iterable<types.Node>;
  /**
   * Stryker's mutator filter: once the instrumenter leaves a node this operator mutated, it passes every mutant made in
   * that node, and `false` drops this operator's mutants of the node.
   */
  readonly filter?: (mutantsInScope: readonly unknown[]) => boolean;
}

/** The shape of Stryker's `NodeMutator`, which the instrumenter's exports keep out of reach. */
export interface NodeMutatorLike {
  readonly name: string;
  mutate(path: NodePath, context: { readonly isExpressionContext: boolean }): Iterable<types.Node>;
  readonly filter?: ((mutantsInScope: readonly unknown[]) => boolean) | undefined;
}

export const own = Symbol.for(lzPackageName);

interface OwnMutator extends NodeMutatorLike {
  readonly [own]: true;
}

/** Yields nothing where Stryker's instrumenter allows no statement, such as a Vue template's expression. */
export function toNodeMutator(operator: Operator, t: BabelTypes): OwnMutator {
  return {
    name: operator.name,
    [own]: true,
    filter: operator.filter,
    *mutate(path, { isExpressionContext }) {
      if (!isExpressionContext) {
        yield* operator.mutate(path, t);
      }
    },
  };
}

export function isOwn(mutator: object): boolean {
  return own in mutator;
}
