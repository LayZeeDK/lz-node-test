import { lzAllMutators, type LzMutatorSets } from '@layzee/stryker-mutator-core';
import { nodeAssertStatement } from './node-assert-statement.ts';
import { nodeAwaitStatement } from './node-await-statement.ts';
import { nodeByteLength } from './node-byte-length.ts';
import { nodeCallbackError } from './node-callback-error.ts';
import { nodeEventName } from './node-event-name.ts';
import { nodeExitCode } from './node-exit-code.ts';
import { nodeListenerOnce } from './node-listener-once.ts';
import { nodeReturnAwait } from './node-return-await.ts';
import { nodeTimerDelay } from './node-timer-delay.ts';

export const nodeMutatorSets = {
  defaults: [nodeTimerDelay, nodeEventName, nodeAwaitStatement, nodeReturnAwait, nodeExitCode],
  optIn: [nodeAssertStatement, nodeListenerOnce],
  experimental: [nodeByteLength, nodeCallbackError],
} satisfies LzMutatorSets;

export const nodeMutators = lzAllMutators(nodeMutatorSets);
