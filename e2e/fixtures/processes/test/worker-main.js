import { parentPort } from 'node:worker_threads';

import { workerValue } from '../src/worker-only.js';

parentPort.postMessage(workerValue());
