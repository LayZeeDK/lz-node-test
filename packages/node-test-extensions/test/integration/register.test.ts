import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { report, signatures } from '../reported.fixtures.ts';
import { lzTestEach } from '../../src/test-each.ts';
import { lzTestFor } from '../../src/test-for.ts';

describe('the options of lzTestEach and lzTestFor', () => {
  it('registers todo tests without a function, also when a timeout replaces the options', async (t) => {
    await t.assert.reports(() => {
      lzTestEach([1])('no function %s');
      lzTestFor([1])('options only %s', { timeout: 100 });
      // @ts-expect-error The types take no timeout after options, which untyped callers can still pass.
      lzTestEach([1])('options and a timeout %s', { skip: true }, 5000);
      lzTestEach([1])('a todo reason %s', { todo: 'later' });
      lzTestEach([1])('skipped %s', { skip: true });
    }, [
      { name: 'no function 1', outcome: 'pass', todo: true },
      { name: 'options only 1', outcome: 'pass', todo: true },
      { name: 'options and a timeout 1', outcome: 'pass', todo: true },
      { name: 'a todo reason 1', outcome: 'pass', todo: true },
      { name: 'skipped 1', outcome: 'pass', skip: true },
    ]);
  });

  it('applies a timeout given as a number or in the options, and passes node:test options through', async (t) => {
    await t.assert.reports(() => {
      lzTestEach([1])('number %s', () => new Promise((resolve) => setTimeout(resolve, 300)), 10);
      lzTestFor([1])('options %s', { timeout: 10 }, () => new Promise((resolve) => setTimeout(resolve, 300)));
      lzTestFor([1])('plan %s', { plan: 1 }, (n, t) => {
        // Stryker disable next-line LzNodeTestAssertCall: t.assert.reports allows only the names its cases list, so its callback may hold no Stryker code
        t.assert.equal(n, 1);
      });
    }, [
      { name: 'number 1', outcome: 'fail', error: 'test timed out after 10ms' },
      { name: 'options 1', outcome: 'fail', error: 'test timed out after 10ms' },
      { name: 'plan 1', outcome: 'pass' },
    ]);
  });

  it('lets a defined option override a modifier, and reads no options from a function', async (t) => {
    await t.assert.reports(() => {
      lzTestEach.skip([1])('undefined %s', { skip: undefined }, report);
      lzTestEach.skip([1])('false %s', { skip: false }, () => {});
      lzTestEach([1])(
        'own properties %s',
        Object.assign(() => {}, { skip: true }),
      );
      lzTestEach([1])('fails %s', { fails: true }, report);
    }, [
      { name: 'undefined 1', outcome: 'pass', skip: true },
      { name: 'false 1', outcome: 'pass' },
      { name: 'own properties 1', outcome: 'pass' },
      { name: 'fails 1', outcome: 'pass' },
    ]);
  });

  it('throws before registering a test for options after a function, two functions, or null options', () => {
    assert.throws(() => {
      // @ts-expect-error -- options after the function, which the types refuse and the check must catch
      lzTestEach([1])('x', () => {}, {});
    }, signatures);
    const second = () => {};
    assert.throws(() => {
      // @ts-expect-error -- a second function, which the types refuse and the check must catch
      lzTestFor([1])('x', () => {}, second);
    }, signatures);
    assert.throws(() => {
      // @ts-expect-error -- null options, which the types refuse and the check must catch
      lzTestEach([1])('x', null, () => {});
    }, signatures);
  });
});

describe('t.assert.reports', () => {
  it('rejects cases that use a name the test file it writes does not have', async (t) => {
    const captured = 1;

    await assert.rejects(
      t.assert.reports(() => {
        lzTestEach([captured])('captured %s', report);
      }, []),
      { message: 't.assert.reports cases can use only lzTestEach, lzTestFor, report and globals, not captured.' },
    );
  });
});
