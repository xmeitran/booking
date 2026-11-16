import test from 'node:test';
import assert from 'node:assert/strict';
import { matchUser, people, platformOf } from './masterSync';

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

test('matchUser: open_id trước; theo tên chỉ khi duy nhất và user không thêm bằng open_id', () => {
  const users = [
    { id: 'a', larkUserId: 'ou_a', name: 'Trang' },
    { id: 'b', larkUserId: 'HN01', name: 'Nhi' },
    { id: 'c', larkUserId: 'HN02', name: 'Hà' }, { id: 'd', larkUserId: 'HN03', name: 'Hà' },
  ];
  assert.equal(matchUser(users, { id: 'ou_a', name: 'X' })?.id, 'a');
  assert.equal(matchUser(users, { id: 'ou_z', name: 'nhi ' })?.id, 'b');
  assert.equal(matchUser(users, { id: 'ou_z', name: 'Trang' }), undefined); // khác open_id = người khác
  assert.equal(matchUser(users, { id: 'ou_z', name: 'Hà' }), undefined); // trùng tên hai người
});
