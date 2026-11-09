import test from 'node:test';
import assert from 'node:assert/strict';
import { toLines } from './planSync';

const rec = (fields: Record<string, unknown>) => ({ record_id: 'recA', last_modified_time: 0, fields });
const base = {
  'Tháng': [{ text: '2026/11', type: 'text' }],
  'Gian hàng': [{ text: 'EUPC _TikTok_E2E-C', type: 'text' }],
  'Brand': [{ text: 'EUPC ', type: 'text' }],
  'B2C phụ trách': true,
  'Booking PIC': { type: 11, value: [{ id: 'ou_1', name: 'Nhung' }] },
};

test('toLines tách video trả phí (trừ freecast), self channel, livestream; ngân sách net', () => {
  const lines = toLines(rec({
    ...base,
    'Số video affiliate': 380, '(sau điều chỉnh) Số video affliate': 377, 'TAP UpAffiliate': 290,
    'Chi phí booking video affiliate': 419601600,
    'Booking - Số video self channel': 45, 'Booking - Chi phí video self channel': 37897200,
    'Số phiên livestream affiliate': 1, 'Chi phí booking livestream affiliate': 253800000,
  }));
  assert.deepEqual(lines.map((l) => [l.id, l.contentType, l.quantity, l.budget]), [
    ['lark-recA-video', 'Video', 87, 353200000],
    ['lark-recA-self', 'Video self channel', 45, 31900000],
    ['lark-recA-live', 'Phiên livestream', 1, 213636364],
  ]);
  assert.equal(lines[0].month, '2026-11');
  assert.equal(lines[0].brand, 'EUPC');
  assert.deepEqual(lines[0].pic, { id: 'ou_1', name: 'Nhung' });
  assert.equal(lines[0].note, 'EUPC _TikTok_E2E-C · Freecast (TAP) 290 video, không tính vào SL');
  assert.equal(lines[1].note, 'EUPC _TikTok_E2E-C');
});

test('toLines chia theo KL khi Lark có số tier; bỏ dòng trống và dòng không có tháng', () => {
  const lines = toLines(rec({ ...base, 'B2C phụ trách': false, 'Số video affiliate': 10, 'KL3': 4, 'KL5': 6, 'Chi phí booking video affiliate': 1188 }));
  assert.deepEqual(lines.map((l) => [l.id, l.tier, l.quantity, l.budget]), [
    ['lark-recA-KL3', 'KL3', 4, null],
    ['lark-recA-KL5', 'KL5', 6, null],
    ['lark-recA-video', null, 0, 1000], // hết SL cho KL, dòng chỉ giữ ngân sách
  ]);
  assert.equal(lines[0].note, 'EUPC _TikTok_E2E-C · B2C không phụ trách');
  assert.deepEqual(toLines(rec({ ...base, 'Số video affiliate': 0 })), []);
  assert.deepEqual(toLines(rec({ ...base, 'Tháng': null, 'Số video affiliate': 5 })), []);
});
