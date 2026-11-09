import test from 'node:test';
import assert from 'node:assert/strict';
import { people, platformOf } from './masterSync';

test('platformOf: theo cột Platform, trống thì đoán từ tên gian', () => {
  assert.equal(platformOf('TikTok', 'X'), 'TikTok Shop');
  assert.equal(platformOf('Shopee', 'X'), 'Shopee');
  assert.equal(platformOf('Website', 'X'), 'Website');
  assert.equal(platformOf(null, 'Vitabiotics_Shopee_E2E-S'), 'Shopee');
  assert.equal(platformOf(null, 'EUPC _TikTok_E2E-C'), 'TikTok Shop');
  assert.equal(platformOf(null, 'Kênh nội bộ'), null);
});

test('people đọc cột User và Lookup', () => {
  assert.deepEqual(people([{ id: 'ou_1', name: 'A' }]), [{ id: 'ou_1', name: 'A' }]);
  assert.deepEqual(people({ type: 11, value: [{ id: 'ou_2', name: 'B' }] }), [{ id: 'ou_2', name: 'B' }]);
  assert.deepEqual(people(null), []);
});
