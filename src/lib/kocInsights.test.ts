import test from 'node:test';
import assert from 'node:assert/strict';
import { collabSummary, defaultViewTarget, forecast, parseVndRange, profileInsights, USD_VND, type BookingRow } from './kocInsights';

test('parseVndRange đọc khoảng tiền TikTok', () => {
  assert.deepEqual(parseVndRange('257,4K ₫-386,1K ₫'), [257400, 386100]);
  assert.deepEqual(parseVndRange('1M₫+'), [1000000, null]);
  assert.deepEqual(parseVndRange(null), [null, null]);
});

// Rút gọn từ hồ sơ thật (mesaylamdep, 04/11/2026).
test('profileInsights: giới tính / tuổi là thập phân, tỉnh thành là phần vạn', () => {
  const p = profileInsights({
    follower_gender: [{ key: 'male', value: '0.2415' }, { key: 'female', value: '0.5771' }],
    follower_age: [{ key: '25-34', value: '0.4988' }, { key: '18-24', value: '0.3436' }],
    follower_location: [{ key: 'HO CHI MINH', value: '3077' }, { key: 'HA NOI', value: '1766' }],
    content_gmv_distribution: [{ content_type: 'video_gmv', value: '0.8323' }, { content_type: 'live_gmv', value: '0.1660' }],
    category_gmv_distribution: [{ category_id: '601450', value: '0.9713' }, { category_id: '999', value: '0.02' }, { category_id: '-1', value: '0.0002' }],
    avg_gmv_per_buyer_range: { formatted_range: '257,4K ₫-386,1K ₫' },
  });
  assert.equal(p.female, 0.5771);
  assert.equal(p.age25_34, 0.4988);
  assert.deepEqual(p.locations[0], { name: 'Ho Chi Minh', share: 0.3077 });
  assert.equal(p.gmvVideo, 0.8323);
  assert.equal(p.gmvShowcase, null);
  assert.deepEqual(p.categories.map((c) => c.name), ['Làm đẹp & Chăm sóc cá nhân', 'Ngành #999']);
  assert.equal(p.aovMid, 321750);
});

test('forecast: GMV Target = View × GPM / 1000, CTR suy ngược từ GPM', () => {
  const f = forecast({ viewTarget: 10_000, gpmUsd: 10, cr: 0.05, aov: 200_000, price: 2_000_000 });
  const gpm = 10 * USD_VND;
  assert.equal(f.gmvTarget, Math.round((10_000 * gpm) / 1000));
  assert.ok(Math.abs(f.ctr! * 0.05 * 200_000 - gpm / 1000) < 1e-9); // View × CTR × CR × AOV khớp GMV Target
  assert.equal(f.cpv, 200);
  assert.equal(f.fee, Math.round(2_000_000 / 0.9));
  assert.equal(forecast({ viewTarget: null, gpmUsd: 10, cr: null, aov: null, price: null }).gmvTarget, null);
});

test('defaultViewTarget: KL6–KL7 phải nhập tay', () => {
  assert.equal(defaultViewTarget({ kl: 'KL7', avgViews: 5000, gpmUsd: 1, unitsSold: 1 }), null);
  assert.equal(defaultViewTarget({ kl: 'KL3', avgViews: 5000, gpmUsd: 1, unitsSold: 1 }), 5000);
});

test('collabSummary: giá gần nhất cùng hình thức, booking GMV tốt nhất', () => {
  const b = (o: Partial<BookingRow>): BookingRow => ({ code: 'BO', brand: null, store: null, pipeline: null, planMonth: null, airDate: null, cost: null, linkAir: null, channel: 'x', extra: {}, ...o });
  const s = collabSummary([
    b({ code: 'BO3', brand: 'A', cost: 3_000_000, extra: { format: 'Booking Livestream KOC', kl: 'KL4' } }),
    b({ code: 'BO2', brand: 'B', cost: 2_000_000, planMonth: '2026/10', extra: { format: 'Booking Video KOC', gmv30: '5000000' } }),
    b({ code: 'BO1', brand: 'A', cost: 1_000_000, extra: { format: 'Booking Video KOC', gmv30: '9000000' } }),
  ]);
  assert.equal(s.lastPrice, 2_000_000);
  assert.equal(s.lastPriceNote, 'B 2026/10');
  assert.equal(s.kl, 'KL4');
  assert.deepEqual(s.brands, ['A', 'B']);
  assert.equal(s.best?.code, 'BO1');
  assert.equal(collabSummary([b({ cost: 1, extra: { format: 'Booking Video KOC' } })], 'Phiên livestream').lastPrice, 1);
});

test('parseHandle nhận @username, username, link kênh / link video', async () => {
  const { parseHandle } = await import('./listing');
  assert.equal(parseHandle('@Mesaylamdep'), 'mesaylamdep');
  assert.equal(parseHandle('sooi.unbox'), 'sooi.unbox');
  assert.equal(parseHandle('https://www.tiktok.com/@_thanhthuy.hhvn_/video/7687586402111933716?q=_'), '_thanhthuy.hhvn_');
  assert.equal(parseHandle('CTV Tuấn Anh'), null);
});

test('gmvLabel quy USD ra ₫, giữ nguyên khoảng', async () => {
  const { gmvLabel } = await import('./kocInsights');
  assert.equal(gmvLabel('1M₫+'), '1M₫+');
  assert.equal(gmvLabel(null), null);
  assert.match(gmvLabel('3.064 USD')!, /^~79,7\sTr ₫$/);
});

test('dupKey gom các ID kênh viết khác của cùng KOC, không gom KOC khác tên', async () => {
  const { dupKey } = await import('./listing');
  assert.equal(dupKey('chengtom02'), 'chengtom');
  assert.equal(dupKey('chengtom2'), dupKey('Cheng Tôm'));
  assert.equal(dupKey('kimchungphan20'), dupKey('kimchungphan'));
  assert.notEqual(dupKey('cheng_review'), dupKey('chengtom02'));
});
