import timers from 'node:timers/promises';

export async function later(value: string): Promise<string> {
  await timers.setTimeout(10);

  return value;
}
