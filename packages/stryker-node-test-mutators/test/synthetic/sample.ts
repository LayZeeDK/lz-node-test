// The code that the synthetic tests check.
import assert from 'node:assert/strict';
import type { Writable } from 'node:stream';

// fastify/lib/reply.js:1015
export function onSent(reply: { raw: Writable }, done: () => void): void {
  reply.raw.on('finish', done);
}

export function share(part: number, whole: number): number {
  assert.ok(whole > 0);

  return part / whole;
}

export function total(count: number, size: number): number {
  assert(Number.isInteger(count));

  return count * size;
}
