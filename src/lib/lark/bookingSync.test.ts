import test from 'node:test';
import assert from 'node:assert/strict';
import { toBooking, toText } from './bookingSync';

const opts = new Map([['optGXWDtSt', 'Gửi hàng'], ['optzGH1Npl', 'TikTok']]);

test('toText đọc được các kiểu giá trị của Lark Base', () => {
  assert.equal(toText([{ record_ids: ['r1'], text: 'Po.tran77', text_arr: ['Po.tran77'], type: 'text' }], opts), 'Po.tran77');
  assert.equal(toText([{ text: 'pHCare', type: 'text' }], opts), 'pHCare');
  assert.equal(toText([{ id: 'ou_1', name: 'A' }, { id: 'ou_2', name: 'B' }], opts), 'A, B');
  assert.equal(toText({ users: [{ name: 'Trinh' }] }, opts), 'Trinh');
  assert.equal(toText(['optGXWDtSt'], opts), 'Gửi hàng');
  assert.equal(toText({ type: 2, value: [1500] }, opts), '1500');
  assert.equal(toText([{ record_ids: null, text: null, text_arr: [], type: 'text' }], opts), null);
  assert.equal(toText(null, opts), null);
});

test('toBooking lấy đúng cột chính', () => {
  const b = toBooking({
    record_id: 'recA',
    last_modified_time: 1791885424000,
    fields: {
      'Mã Booking': 'BO260133902',
      '🎃 id kênh': [{ text: 'Po.tran77', text_arr: ['Po.tran77'], type: 'text' }],
      'Link kênh': [{ link: 'https://www.tiktok.com/@Po.tran77', text: 'https://www.tiktok.com/@Po.tran77', type: 'url' }],
      'Pipeline_text': ['optGXWDtSt'],
      '🎃Chi phí thanh toán Booking': '45000000',
      '🎃 Ngày air/live real': 1791885424000,
      'Nền tảng': ['optzGH1Npl'],
    },
  }, opts);
  assert.equal(b.code, 'BO260133902');
  assert.equal(b.channel, 'Po.tran77');
  assert.equal(b.channelUrl, 'https://www.tiktok.com/@Po.tran77');
  assert.equal(b.pipeline, 'Gửi hàng');
  assert.equal(b.cost, 45000000);
  assert.equal(b.airDate?.getTime(), 1791885424000);
  assert.equal(b.planAirDate, null);
  assert.equal(b.extra.platform, 'TikTok');
});

test('cột liên kết từ API search (chỉ có record_id) tra ra chữ', () => {
  const o = new Map([['recA', 'Po.tran77']]);
  assert.equal(toText({ link_record_ids: ['recA'] }, o), 'Po.tran77');
  assert.equal(toText({ link_record_ids: null }, o), null);
});
