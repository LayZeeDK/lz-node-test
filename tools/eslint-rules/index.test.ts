import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { rules } from './index.ts';
import noAssertionInIteration from './no-assertion-in-iteration.ts';
import requireWindowsHide from './require-windows-hide.ts';
import strykerDisableComment from './stryker-disable-comment.ts';

describe('rules', () => {
  it('maps each name that eslint.config.mjs configures as @nx/workspace-<name> to its rule', () => {
    assert.deepEqual(rules, {
      'no-assertion-in-iteration': noAssertionInIteration,
      'require-windows-hide': requireWindowsHide,
      'stryker-disable-comment': strykerDisableComment,
    });
  });
});
