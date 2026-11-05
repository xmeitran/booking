import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linePicker } from './jobs';

test('linePicker: cùng tier, lấp tuần sớm trước, đầy thì dòng cuối, không khớp thì null', () => {
  const pick = linePicker([
    { id: 'w2-KL2', tier: 'KL2', quantity: 1, used: 0 },
    { id: 'w3-KL2', tier: 'KL2', quantity: 2, used: 1 },
    { id: 'w2-KL7', tier: 'KL7', quantity: 1, used: 0 },
  ]);
  assert.deepEqual(['KL2', 'KL2', 'KL2', 'KL7', 'KL6'].map((t) => pick(t)?.id ?? null), ['w2-KL2', 'w3-KL2', 'w3-KL2', 'w2-KL7', null]);
  assert.equal(linePicker([{ id: 'any', tier: null, quantity: 1, used: 0 }])('KL5')?.id, 'any');
});
