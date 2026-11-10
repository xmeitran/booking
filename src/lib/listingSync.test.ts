import test from 'node:test';
import assert from 'node:assert/strict';
import { emailOf, handleOf, phoneOf } from './kocLarkSync';
import { batchIdOf, collapseRepeat, toDraft } from './listingSync';

test('Liên hệ từ Lark: chỉ nhận SĐT VN / email hợp lệ, handle từ link trước rồi tới ID kênh', () => {
  assert.equal(phoneOf('0325154072'), '0325154072');
  assert.equal(phoneOf('0'), null);
  assert.equal(phoneOf('zl'), null);
  assert.equal(emailOf('Mail: An.Nguyen@Gmail.com, khác'), 'an.nguyen@gmail.com');
  assert.equal(emailOf('chưa có'), null);
  assert.equal(handleOf('https://www.tiktok.com/@Sooi.Unbox?lang=vi', 'khac'), 'sooi.unbox');
  assert.equal(handleOf(null, '@MeSayLamDep'), 'mesaylamdep');
});

test('Listing Lark: id đợt ổn định theo brand + gian hàng + tháng + đợt, gộp chữ lặp ở cột sản phẩm', () => {
  assert.equal(batchIdOf('2026-11', 'pH Care', 'PH care_TikTok', 'Đợt 1'), batchIdOf('2026-11', 'PHCARE', 'ph care_tiktok', 'đợt 1'));
  assert.notEqual(batchIdOf('2026-11', 'pH Care', 'A', 'Đợt 1'), batchIdOf('2026-11', 'pH Care', 'B', 'Đợt 1'));
  assert.equal(collapseRepeat('PomeloPomeloPomelo'), 'Pomelo');
  assert.equal(collapseRepeat('Dầu gội Bạch Dương'), 'Dầu gội Bạch Dương');
});

test('toDraft: map cột Lark, thiếu tháng / brand thì bỏ', () => {
  const r = (fields: Record<string, unknown>) => ({ record_id: 'rec1', last_modified_time: 1, fields });
  const d = toDraft(r({
    'Tháng': '2026/11', Brand: 'Kutieskin Mama', '🎃 Đợt': 'Đợt 2', Store_text: 'Kutieskin Mama_TikTok', '🎃 ID kênh': '@hanvilamdau',
    '🎃 Giá net video': 2000000, 'Đề xuất từ UpBase': 'Must have', '🎃 Brand duyệt': 'Cân nhắc', 'Định dạng booking': 'Booking Livestream KOC', Zalo: '0912345678',
  }))!;
  assert.equal(d.id, 'lark-rec1');
  assert.equal(d.month, '2026-11');
  assert.equal(d.handle, 'hanvilamdau');
  assert.equal(d.price, 2000000);
  assert.equal(d.recommendation, 'Must Have');
  assert.equal(d.brandChoice, 'Cân nhắc');
  assert.equal(d.priceType, 'Phiên livestream');
  assert.equal(d.contact.phone, '0912345678');
  assert.equal(toDraft(r({ Brand: 'X' })), null);
  assert.equal(toDraft(r({ 'Tháng': '2026/11' })), null);
});
