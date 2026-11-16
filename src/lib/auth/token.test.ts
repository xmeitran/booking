import test from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from './token';

process.env.AUTH_SECRET = 'test-secret'; // token.ts đọc secret lúc gọi hàm

test('token hợp lệ trả về uid', () => {
  assert.equal(verifyToken(signToken('u1', 1000, 0), 500), 'u1');
});

test('từ chối token hết hạn, bị sửa, hoặc rỗng', () => {
  const t = signToken('u1', 1000, 0);
  assert.equal(verifyToken(t, 1000), null);
  const forged = Buffer.from(JSON.stringify({ uid: 'admin', exp: 9e15 })).toString('base64url') + '.' + t.split('.')[1];
  assert.equal(verifyToken(forged, 500), null);
  assert.equal(verifyToken(undefined), null);
  assert.equal(verifyToken('abc'), null);
});
