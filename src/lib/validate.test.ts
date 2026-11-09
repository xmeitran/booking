import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bankAccount, idNumber, phoneVN, TIKTOK_USERNAME } from './validate';

test('phoneVN chuẩn hoá và chặn số sai', () => {
  assert.equal(phoneVN(''), null);
  assert.equal(phoneVN('0912 345 678'), '0912345678');
  assert.equal(phoneVN('+84 912.345.678'), '0912345678');
  assert.equal(phoneVN('84912345678'), '0912345678');
  assert.equal(phoneVN('091234567'), undefined);
  assert.equal(phoneVN('zalo 0912345678'), undefined);
});

test('idNumber nhận CCCD, CMND, MST', () => {
  assert.equal(idNumber('001 203 004 567'), '001203004567');
  assert.equal(idNumber('123456789'), '123456789');
  assert.equal(idNumber('0101234567-001'), '0101234567-001');
  assert.equal(idNumber('0101234567001'), '0101234567001');
  assert.equal(idNumber('12345'), undefined);
});

test('bankAccount và username TikTok', () => {
  assert.equal(bankAccount('1903 4567 8901'), '190345678901');
  assert.equal(bankAccount('abc123'), undefined);
  assert.ok(TIKTOK_USERNAME.test('vickiee.bae'));
  assert.ok(!TIKTOK_USERNAME.test('VJ Minh Thuý'));
});
