// Code that exists to be mutated: the shapes the production operators match that no other file here has.
export const latest = { id: '' };

export function remember(id: string): void {
  latest.id = id;
}

export function firstTwo<T>(rows: readonly T[]): readonly T[] {
  return rows.slice(0, 2);
}
