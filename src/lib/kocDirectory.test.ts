import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountError, cccdError, channelSummary, cleanHandle, contractReadiness, dateError, directory, findDuplicates, inferLegalType, legalProfilesOf, placeError,
  ratingSummary, reviewSummary, upperNoAccent, type DirKoc,
} from './kocDirectory';
import { dupKey } from './listing';

const koc = (o: Partial<DirKoc> & { id: string; handle: string }): DirKoc => ({
  name: o.handle, nickname: null, platform: 'TikTok', avatarUrl: null, channelUrl: null, phone: null, zalo: null, email: null, niche: null, category: null,
  kl: null, klAuto: null, picName: null, statsAt: null, receiverName: null, address: null, blacklisted: false, tags: [], bookingCount: 0, jobs: 0,
  coopConfirmed: false, readiness: null, contactStatus: null, idNumber: null, bankAccount: null, bankHolder: null, bankName: null, rateCard: null,
  followers: null, avgViews: null, unitsSold: null, gmvRange: null, updatedAt: new Date(), lastBookingAt: null, saved: [], channels: [], aliases: [],
  reviews: [], ratings: [], lark: null, followUp: false, ...o,
});

test('channelSummary: @handle (+N TikTok · +N MXH)', () => {
  assert.equal(channelSummary('a', []), '@a');
  assert.equal(channelSummary('a', [{ platform: 'TikTok' }]), '@a (+1 TikTok)');
  assert.equal(channelSummary('a', [{ platform: 'TikTok' }, { platform: 'Shopee' }, { platform: 'Threads' }]), '@a (+1 TikTok · +2 MXH)');
  assert.equal(cleanHandle('https://www.instagram.com/Abc.Xyz/?hl=vi'), 'abc.xyz');
  assert.equal(cleanHandle('@Mai_Ha'), 'mai_ha');
});

test('ratingSummary: trung bình 1 chữ số, điểm thấp khi ≤ 2, 3 nhận định tiêu cực hay gặp', () => {
  const r = ratingSummary([{ stars: 2, tags: ['LATE', 'LATE', 'REPLY_SLOW'] }, { stars: 1, tags: ['LATE', 'ON_TIME'] }, { stars: 3, tags: ['OFF_BRIEF'] }]);
  assert.equal(r.average, 2);
  assert.equal(r.isLow, true);
  assert.deepEqual(r.negativeTags, ['Trễ hạn', 'Phản hồi chậm', 'Lệch brief']);
  assert.equal(ratingSummary([]).isLow, false);
});

test('reviewSummary: lượt mới nhất, đếm theo kết luận, kết luận mới nhất theo brand', () => {
  const d = (s: string) => new Date(s);
  const s = reviewSummary([
    { verdict: 'SUITABLE', brand: 'pH Care', createdAt: d('2026-11-01') },
    { verdict: 'NOT_SUITABLE', brand: 'ph care', createdAt: d('2026-11-03') },
    { verdict: 'CAUTION', brand: 'EUPC', createdAt: d('2026-11-02') },
  ])!;
  assert.equal(s.latest.verdict, 'NOT_SUITABLE');
  assert.deepEqual([s.total, s.suitable, s.caution, s.notSuitable], [3, 1, 1, 1]);
  assert.deepEqual(s.byBrand.map((b) => [b.brand, b.latest.verdict, b.count]), [['ph care', 'NOT_SUITABLE', 2], ['EUPC', 'CAUTION', 1]]);
});

test('Hồ sơ pháp lý: suy loại pháp nhân, dựng HSPL-01 từ cột cũ, kiểm tra đủ trường ký HĐ', () => {
  assert.equal(inferLegalType('CONG TY TNHH ABC', null), 'COMPANY');
  assert.equal(inferLegalType('NGUYEN VAN A', 'HKD xuất hóa đơn'), 'HOUSEHOLD');
  assert.equal(inferLegalType('NGUYEN VAN A', '(Thuế TNCN 10%) Tài khoản cá nhân'), 'INDIVIDUAL');
  assert.deepEqual(legalProfilesOf([], { idNumber: null, bankAccount: null, bankHolder: null, bankName: null }), []);
  const [p] = legalProfilesOf([], { idNumber: '0312345678', bankAccount: '123456', bankHolder: 'CONG TY ABC MEDIA', bankName: 'VCB' }, '(VAT 8%) Tài khoản doanh nghiệp');
  assert.equal(p.id, null);
  assert.equal(p.code, 'HSPL-01');
  assert.equal(p.legalType, 'COMPANY');
  assert.equal(p.taxCode, '0312345678');
  const r = contractReadiness(p, { phone: '0901234567', address: 'HN' });
  assert.deepEqual(r.missing, ['Người đại diện pháp luật', 'Chức vụ người đại diện']);
  const ind = contractReadiness({ id: 'x', code: 'HSPL-01', legalType: 'INDIVIDUAL', isDefault: true, holderName: 'A', cccd: '001099012345', cccdIssueDate: '15/05/2022', cccdIssuePlace: 'Cục Cảnh sát QLHC về TTXH', address: 'HN', bankName: 'MB', bankAccount: '123456', contactPhone: '0901234567' }, {});
  assert.equal(ind.ready, true);
  assert.equal(ind.total, 9);
});

test('Kiểm tra dữ liệu hồ sơ (nguyên văn b2c)', () => {
  assert.equal(cccdError('001099012345'), null);
  assert.equal(cccdError('12345'), 'Số CCCD phải gồm đúng 12 chữ số (hiện có 5 số)');
  assert.equal(dateError('31/02/2022'), 'Tháng 2/2022 chỉ có tối đa 28 ngày');
  assert.equal(dateError('01/01/2999'), 'Ngày cấp CCCD không được lớn hơn ngày hiện tại');
  assert.equal(placeError('123'), 'Nơi cấp CCCD phải là chữ, điền số là sai');
  assert.equal(accountError('12 34'), 'Số tài khoản phải từ 6 chữ số trở lên');
  assert.equal(upperNoAccent('Nguyễn Đức  Anh'), 'NGUYEN DUC ANH');
});

test('findDuplicates: trùng kênh theo khoá ID kênh, chung chủ theo SĐT / email / CCCD', () => {
  const m = findDuplicates([
    { id: '1', handle: '_lee.ella_', phone: null, email: null, idNumber: '001099012345' },
    { id: '2', handle: 'lee.ella', phone: null, email: null, idNumber: null },
    { id: '3', handle: 'khac', phone: null, email: null, idNumber: '001099012345' },
  ], dupKey);
  assert.deepEqual(m.get('1')?.get('2'), ['kênh']);
  assert.deepEqual(m.get('1')?.get('3'), ['CCCD / MST']);
  assert.equal(m.has('2') && !m.get('2')!.has('3'), true);
});

test('directory: 2 bảng, chip đếm theo bộ lọc, Trùng kênh luôn hiện, lọc PIC theo booking Lark', () => {
  const lark = (pic: string) => ({ n: 1, paid: 1, foc: 0, minCost: 1, maxCost: 1, lastVideo: 1, lastCost: 1, brands: 1, brand: 'B', month: '2026/11', code: 'BO1', pic, pics: pic, accountType: null });
  const all = [
    koc({ id: 'a', handle: 'a', bookingCount: 2, lark: lark('Lan, Huệ'), idNumber: '001099012345', bankAccount: '123456' }),
    koc({ id: 'b', handle: 'b', bookingCount: 1, phone: '0901234567', reviews: [{ verdict: 'SUITABLE', brand: 'B', createdAt: new Date() }] }),
    koc({ id: 'c', handle: 'c', coopConfirmed: true }),
    koc({ id: 'n', handle: 'n', readiness: 'SẴN_SÀNG_BOOKING', contactStatus: 'ĐÃ_LIÊN_HỆ' }),
    koc({ id: 'm', handle: 'm' }),
  ];
  const d = directory(all, {}, dupKey);
  assert.deepEqual(d.counts, { coop: 3, new: 2 });
  assert.deepEqual(d.issueChips.map((c) => [c.key, c.count]), [['MISSING', 2], ['NO_CONTACT', 2], ['DUPLICATE', 0], ['SUITABLE', 1]]);
  assert.deepEqual(d.options.pic, ['Lan']);
  assert.deepEqual(directory(all, { pic: 'Lan' }, dupKey).rows.map((k) => k.id), ['a']);
  assert.deepEqual(directory(all, { issue: 'MISSING' }, dupKey).rows.map((k) => k.id), ['b', 'c']);
  const n = directory(all, { tab: 'new' }, dupKey);
  assert.deepEqual(n.readinessChips.map((c) => c.count), [2, 1, 0, 0, 1]);
  assert.deepEqual(directory(all, { tab: 'new', contact: 'NOT_CONTACTED' }, dupKey).rows.map((k) => k.id), ['m']);
  assert.deepEqual(directory(all, { q: '099012' }, dupKey).rows.map((k) => k.id), ['a']);
  assert.deepEqual(directory(all, { q: 'zz' }, dupKey, new Set(['b'])).rows.map((k) => k.id), ['b']);
});
