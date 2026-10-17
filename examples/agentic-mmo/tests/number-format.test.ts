import assert from 'node:assert/strict';
import { test } from 'node:test';
import { numberPresentation, exactNumber } from '../web/number-format.ts';

void test('stocks are compact with grouped exact values and no invented sign or rate', () => {
  assert.deepEqual(numberPresentation(12345.67), { short: '12.3K', exact: '12,345.67' });
  assert.equal(numberPresentation(2706.8).short, '2.7K');
  assert.equal(exactNumber(1234567.89), '1,234,567.89');
});
void test('signed change and per-season rate keep their meaning separate from stock', () => {
  assert.deepEqual(numberPresentation(1234.5, 'change'), { short: '+1.2K', exact: '+1,234.5' });
  assert.deepEqual(numberPresentation(-12.25, 'rate'), { short: '−12.25 / season', exact: '−12.25 / season' });
  assert.equal(numberPresentation(0, 'change').short, '0');
});
void test('small nonzero amounts and invalid values never pretend to be zero', () => {
  assert.equal(numberPresentation(.004).short, '0.004');
  assert.equal(numberPresentation(-0).short, '0');
  assert.equal(numberPresentation(Number.NaN).exact, 'Unavailable');
  assert.equal(numberPresentation(Infinity).short, 'Unavailable');
  assert.equal(numberPresentation(999999).short, '1M');
});
