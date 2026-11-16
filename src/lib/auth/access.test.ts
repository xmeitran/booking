import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_PERMS, DEFAULT_POLICY, deptAllowed, normalizePolicy, permsOf } from './access';

test('normalizePolicy: chưa lưu → mặc định; bỏ mã quyền lạ, giữ danh sách rỗng đã lưu', () => {
  assert.deepEqual(normalizePolicy(null), DEFAULT_POLICY);
  const p = normalizePolicy({ perms: { LEADER: ['plan.edit', 'hack'], STAFF: [] }, loginDepts: [' Booking ', '', 3] });
  assert.deepEqual(p.perms, { LEADER: ['plan.edit'], STAFF: [] });
  assert.deepEqual(p.loginDepts, ['Booking']);
});

test('permsOf: Admin luôn đủ quyền, vai trò khác theo ma trận', () => {
  const p = normalizePolicy({ perms: { LEADER: [], STAFF: ['data.all'] } });
  assert.equal(permsOf('ADMIN', p).size, ALL_PERMS.length);
  assert.equal(permsOf('LEADER', p).size, 0);
  assert.ok(permsOf('STAFF', p).has('data.all'));
  assert.ok(!permsOf('STAFF', DEFAULT_POLICY).has('data.all')); // mặc định Nhân viên chỉ xem brand được giao
});

test('deptAllowed: khớp chứa, không phân biệt hoa thường; phòng ban trống thì chặn', () => {
  assert.ok(deptAllowed('Sub-Booking HN, Marketing B2C', ['booking']));
  assert.ok(!deptAllowed('Fulfillment HCM', ['Booking', 'Marketing B2C']));
  assert.ok(!deptAllowed(null, ['Booking']));
  assert.ok(!deptAllowed('Booking', []));
});
