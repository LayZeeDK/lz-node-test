// A transform stream sees the events as node:test reports them; an async generator would see them later, after more
// tests have run.
import { Transform } from 'node:stream';

import { reporting, type GlobalSlots, type TestEvent } from './hook-core.ts';

const global: GlobalSlots = globalThis;

export default new Transform({
  writableObjectMode: true,
  transform(event: TestEvent, _encoding, callback) {
    // Processes the test file starts inherit the reporter, even one started on the test file itself, but the hook hides
    // the test file from them, so only the test file's own process records.
    global[reporting]?.(event);
    callback();
  },
});
