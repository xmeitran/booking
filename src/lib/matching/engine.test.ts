import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageShare, evaluate, inferKl, outOfPool, regionShare, type Context, type Metrics, type Subject } from './engine';
import { band, BANDS, DEFAULT_RULES, parseRules } from './spec';
import { brandKey } from '../booking/listing';
import { stageAfterRun } from './run';

const day = (s: string) => new Date(`${s}T00:00:00+07:00`);
const metrics = (m: Partial<Metrics> = {}): Metrics => ({
  source: 'test', at: null, followers: 100_000, medianViews: 15_000, er: 0.05, videos30: 12, ecVideos: 6, unitsSold: 300, gmv: 60_000_000,
  gpm: 200_000, aov: 250_000, female: 0.8, ages: { '18-24': 0.4, '25-34': 0.35, '35-44': 0.15, '45-54': 0.07, '55+': 0.03 },
  locations: [{ name: 'HO CHI MINH', share: 0.3 }, { name: 'Hà Nội', share: 0.2 }], categories: [{ name: 'Beauty & Personal Care', share: 0.7 }],
  brandCount: 5, brands: [], castFee: null, products: 20, topVideos: [], ...m,
});
const subject = (s: Partial<Subject> = {}): Subject => ({
  platform: 'TikTok', handle: 'abc', name: 'ABC', kocId: 'k1', avatarUrl: null, kl: 'KL3', niche: 'Beauty', blacklisted: false, blacklistReason: null,
  rateCard: null, metrics: metrics(), history: { bookings: [], jobs: [], ratings: [], reviews: [], outcomes: [] }, ...s,
});
const ctx = (c: Partial<Context> = {}): Context => ({
  brandName: 'pH Care', channel: 'TikTok', objective: 'Convert', gmvMax: false, expertClaim: false, category: 'Beauty', competitors: [], bannedClaims: [],
  groupKeys: new Set(), rules: { ...DEFAULT_RULES }, product: null, dealPrice: null, airAt: day('2026-12-10'), airMonth: '2026-12',
  benchmarks: { '*': { gmvPerVideo: 8_000_000, views: 10_000, cpv: 200, n: 20 } }, include: new Set(), exclude: new Set(), neededKls: [], now: day('2026-11-26'), keywords: [], ...c,
});
const codes = (e: ReturnType<typeof evaluate>) => e.ko.map((k) => k.code);

test('bậc điểm: mốc doc 1/3/5, khoảng giữa 2/4', () => {
  assert.equal(band(0.04, BANDS.B1), 1);
  assert.equal(band(0.07, BANDS.B1), 2);
  assert.equal(band(0.15, BANDS.B1), 3);
  assert.equal(band(0.3, BANDS.B1), 5);
  assert.equal(band(0.6, BANDS.E1), 5); // CPV thấp hơn benchmark là tốt
  assert.equal(band(2, BANDS.E1), 1);
});

test('tỷ lệ theo tuổi / tỉnh không phân biệt dấu', () => {
  assert.equal(ageShare(metrics().ages, 18, 34), 0.75);
  assert.equal(regionShare(metrics().locations, ['Hồ Chí Minh']), 0.3);
  assert.equal(regionShare(null, ['Hà Nội']), null);
});

test('K6 theo cửa sổ chống trùng, K7 theo nhóm brand trong tháng air', () => {
  const booked = (date: string, brand = 'PH CARE') => subject({ history: { bookings: [{ code: 'BO1', brand, airDate: day(date), planAirDate: null, planMonth: date.slice(0, 7).replace('-', '/'), cost: 5e6, slaLate: false, views30: null, gmv30: null }], jobs: [], ratings: [], reviews: [], outcomes: [] } });
  assert.deepEqual(codes(evaluate(booked('2026-10-20'), ctx())), ['K6']);
  assert.deepEqual(codes(evaluate(booked('2026-07-01'), ctx())), []);
  assert.deepEqual(codes(evaluate(booked('2026-10-20'), ctx({ rules: { ...DEFAULT_RULES, cooldownDays: 30 } }))), []);
  assert.deepEqual(codes(evaluate(booked('2026-12-03', 'Dạ Hương'), ctx({ groupKeys: new Set([brandKey('Dạ Hương')]) }))), ['K7']);
});

test('K9 Must loại, Nice to have chỉ cảnh báo; KL suy theo follower', () => {
  const rules = parseRules({ kl: { KL3: { followersMin: 50_000, viewsMin: 20_000, unitsSoldMin: 1000, must: ['followersMin', 'viewsMin'] }, KL4: { followersMin: 200_000 } } });
  const e = evaluate(subject(), ctx({ rules }));
  assert.deepEqual(codes(e), ['K9']); // view 15K < 20K
  assert.ok(e.flags.some((f) => f.code === 'K9' && f.detail.includes('chỉ cảnh báo')));
  assert.equal(inferKl(120_000, rules), 'KL3');
  assert.equal(inferKl(250_000, rules), 'KL4');
  assert.equal(inferKl(1_000, rules), null);
  assert.equal(evaluate(subject({ kl: null }), ctx({ rules })).klSource, 'Suy theo follower');
});

test('K10 tệp follower của SKU; thiếu số liệu không loại', () => {
  const product = { price: 300_000, targetGender: 'Nữ', ageMin: 18, ageMax: 34, femaleMin: 85, age18_34Min: 70, regions: [], regionMin: null, channelTypes: [], exclusions: [], bannedWords: [] };
  assert.deepEqual(codes(evaluate(subject(), ctx({ product }))), ['K10']); // nữ 80% < 85%
  const e = evaluate(subject({ metrics: metrics({ female: null, ages: null }) }), ctx({ product }));
  assert.deepEqual(codes(e), []);
  assert.equal(e.flags.filter((f) => f.code === 'K10').length, 2);
});

test('K13 chỉ khi Convert; K15 trễ 2/3 job gần nhất', () => {
  const noCart = subject({ metrics: metrics({ ecVideos: 0, unitsSold: 0, gmv: 0, products: 0 }) });
  assert.deepEqual(codes(evaluate(noCart, ctx())), ['K13']);
  assert.deepEqual(codes(evaluate(noCart, ctx({ objective: 'Awareness' }))), []);
  const late = (d: string) => ({ code: d, brand: 'X', airDate: day(d), planAirDate: new Date(+day(d) - 5 * 86_400_000), planMonth: null, cost: null, slaLate: true, views30: null, gmv30: null });
  const s = subject({ history: { bookings: [late('2026-11-01'), late('2026-10-01')], jobs: [], ratings: [], reviews: [], outcomes: [] } });
  assert.deepEqual(codes(evaluate(s, ctx({ brandName: null }))), ['K15']);
});

test('chấm điểm: quy về 100 trên phần có dữ liệu, nhóm 0 lấy TB nhóm A, Bắt buộc dưới 3 thì loại', () => {
  const e = evaluate(subject(), ctx());
  const g = Object.fromEntries(e.score.groups.map((x) => [x.group, x.score]));
  assert.equal(g.D, 3); // nhóm D chưa chấm: ô trống tạm tính 3
  assert.deepEqual(e.score.missingRequired, ['Tone khớp brand']); // Tone bắt buộc B2C chấm
  assert.equal(g.G0, g.A);
  assert.ok(e.score.total! > 0 && e.score.total! <= 100);
  assert.ok(e.score.coverage < 1);
  // Mục công thức thiếu số liệu: tạm tính 3, không tính vào độ phủ
  const noAud = evaluate(subject({ metrics: metrics({ female: null, ages: null, locations: null, er: null }) }), ctx());
  const b2 = noAud.score.groups.find((x) => x.group === 'B')!.parts.find((p) => p.id === 'B2')!;
  assert.equal(b2.score, 3); assert.equal(b2.assumed, true); assert.equal(b2.gap, true);
  assert.ok(noAud.score.dataGaps > 0 && e.score.dataGaps < noAud.score.dataGaps);
  assert.ok(noAud.score.coverage < e.score.coverage);
  // Booker chấm đủ nhóm D → độ phủ tăng
  const full = evaluate(subject(), ctx(), {}, { D1: { score: 5 }, D2: { score: 5 }, D3: { score: 5 }, A3: { score: 5 }, B3: { score: 5 } });
  assert.ok(full.score.coverage > e.score.coverage);
  assert.deepEqual(full.score.missingRequired, []);
  // Điểm AI chỉ là gợi ý: Tone vẫn thiếu
  assert.deepEqual(evaluate(subject(), ctx(), {}, { A3: { score: 5, by: 'AI' } }).score.missingRequired, ['Tone khớp brand']);
  const must = evaluate(subject(), ctx({ rules: { ...DEFAULT_RULES, group0: [{ id: 'G0_PORTRAIT', mode: 'must' }, { id: 'G0_FREQ', mode: 'score' }] } }), {}, { G0_PORTRAIT: { score: 1 } });
  assert.deepEqual(must.score.mustFail, ['Chân dung khớp brand 1/5']);
  assert.equal(must.score.tier, 'Không hợp tác');
});

test('bước 6: K8, K12, K14 theo khai báo; CPV dùng giá KOC báo', () => {
  const c = ctx({ gmvMax: true, expertClaim: true });
  const e = evaluate(subject(), c, { declared: true, quote: 3_000_000, adsCode: false, noCompetitor: false });
  assert.deepEqual(e.declKo.map((k) => k.code), ['K8', 'K12', 'K14']);
  assert.equal(e.priceSource, 'Giá KOC báo');
  const cpv = e.score.groups.find((x) => x.group === 'E')!.parts.find((p) => p.id === 'E1')!;
  assert.equal(cpv.score, 3); // 3 tr ÷ 15.000 view = 200 ₫ = 1× benchmark
});

test('lượt chạy không xoá KOC: ngoài pool / bị loại chỉ đổi trạng thái, đã qua bước 5 giữ nguyên', () => {
  assert.equal(stageAfterRun(undefined, { outOfPool: 'KL1 không cần' }, false, false), 'OUT');
  assert.equal(stageAfterRun(undefined, { outOfPool: null }, true, false), 'KO');
  assert.equal(stageAfterRun({ stage: 'KO', exception: 'Lead duyệt' }, { outOfPool: null }, true, false), 'POOL');
  assert.equal(stageAfterRun({ stage: 'OUT', exception: null }, { outOfPool: null }, false, false), 'POOL');
  assert.equal(stageAfterRun({ stage: 'SHORTLIST', exception: null }, { outOfPool: 'x' }, true, false), 'SHORTLIST');
  assert.equal(stageAfterRun(undefined, { outOfPool: 'x' }, true, true), 'POOL'); // brand chỉ định
});

test('tìm KOC: creator khớp từ khoá của đợt không bị loại vì sai ngành, nhưng vẫn theo cấp KOC cần book', () => {
  const offCategory = subject({ metrics: metrics({ categories: [{ name: 'Đồ gia dụng', share: 0.9 }, { name: 'Beauty', share: 0.1 }] }) });
  assert.match(outOfPool(offCategory, ctx(), 'KL3') ?? '', /Beauty/);
  assert.equal(outOfPool({ ...offCategory, kwHits: ['kem chống nắng'] }, ctx(), 'KL3'), null);
  assert.match(outOfPool({ ...offCategory, kwHits: ['kem chống nắng'] }, ctx({ neededKls: ['KL5'] }), 'KL3') ?? '', /KL3/);
});
