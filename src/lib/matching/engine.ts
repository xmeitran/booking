// Creator matching: knock-out (bước 3, 6) và chấm điểm 6 nhóm (bước 5, 7) cho một KOC / creator. Hàm thuần, không đọc DB;
// số liệu và lịch sử được nạp sẵn ở data.ts. Quy ước: số liệu thiếu thì tiêu chí "chưa rõ" (không loại, không chấm),
// chỉ loại khi số liệu có và rõ ràng dưới ngưỡng.
import { CANCELLED } from '../booking/jobs';
import { brandKey } from '../booking/listing';
import {
  band, BANDS, criteriaFor, GROUP0, GROUPS, KL_LEVELS, MIN_COVERAGE, NO_DATA_TIER, tierOf, WEIGHTS, COMMON_BANNED,
  type BrandRules, type Channel, type Criterion, type Declare, type Group, type Manual,
} from './spec';

export type Share = { name: string; share: number };
export type Video = { title: string; url: string | null; views: number | null; date: string | null; products?: string | null };
export type Metrics = {
  source: string; at: string | null;
  followers: number | null; medianViews: number | null; er: number | null; videos30: number | null; ecVideos: number | null;
  unitsSold: number | null; gmv: number | null; gpm: number | null; aov: number | null; female: number | null;
  ages: Record<string, number> | null; locations: Share[] | null; categories: Share[] | null;
  brandCount: number | null; brands: string[]; castFee: number | null; products: number | null; topVideos: Video[];
};
export type PastBooking = { code: string; brand: string | null; airDate: Date | null; planAirDate: Date | null; planMonth: string | null; cost: number | null; slaLate: boolean; views30: number | null; gmv30: number | null };
export type PastJob = { brandKey: string; stage: string; deadline: Date | null; submittedAt: Date | null; createdAt: Date };
export type History = {
  bookings: PastBooking[]; jobs: PastJob[];
  ratings: { stars: number; tags: string[]; at: Date }[];
  reviews: { verdict: string; brand: string; at: Date }[];
  outcomes: { at: Date; kpiMet: boolean | null; onTime: boolean | null; contentError: string | null }[];
};
export type Subject = {
  platform: string; handle: string; name: string; kocId: string | null; avatarUrl: string | null;
  kl: string | null; niche: string | null; blacklisted: boolean; blacklistReason: string | null; rateCard: number | null;
  metrics: Metrics | null; history: History;
  kwHits?: string[]; // từ khoá của đợt khớp video / sản phẩm của creator (tìm thêm KOC ngoài ngành)
};
export type Benchmark = { gmvPerVideo: number | null; views: number | null; cpv: number | null; n: number };
export type Product = {
  price: number | null; targetGender: string | null; ageMin: number | null; ageMax: number | null; femaleMin: number | null; age18_34Min: number | null;
  regions: string[]; regionMin: number | null; channelTypes: string[]; exclusions: string[]; bannedWords: string[];
};
export type Context = {
  brandName: string | null; channel: Channel; objective: string; gmvMax: boolean; expertClaim: boolean;
  category: string | null; competitors: string[]; bannedClaims: string[];
  groupKeys: Set<string>; // brand khác cùng tập đoàn / ngành con (K7), dạng brandKey
  rules: BrandRules; product: Product | null; dealPrice: number | null;
  airAt: Date; airMonth: string | null; // "2026-12"
  benchmarks: Record<string, Benchmark>; // theo KL, "*" = mọi KL
  include: Set<string>; exclude: Set<string>; neededKls: string[]; now: Date;
  keywords: string[]; // từ khoá của đợt (chữ thường): tìm thêm creator có video / sản phẩm khớp
};
export type Finding = { code: string; detail: string };

const DAY = 86_400_000;
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d).replace('.', ',')}%`;
const vn = new Intl.NumberFormat('vi-VN');
const money = (n: number) => `${vn.format(Math.round(n))} ₫`;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase()
  .replace(/\b(thanh pho|tp|tinh|city|province)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** "Hồ Chí Minh" khớp "HO CHI MINH CITY", "TP. HCM" thì không (ghi đủ tên tỉnh). */
const nameMatch = (a: string, b: string) => { const x = fold(a), y = fold(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };

export const regionShare = (locs: Share[] | null, regions: string[]) =>
  !locs || !regions.length ? null : locs.filter((l) => regions.some((r) => nameMatch(l.name, r))).reduce((s, l) => s + l.share, 0);
/**
 * Tỷ trọng GMV ngành của brand. Danh sách ngành có thể chỉ là top 3 hoặc đặt tên khác (số TikTok Shop ở Danh bạ):
 * không khớp tên nào thì share = null (chưa rõ), max = phần còn lại chưa liệt kê (tỷ trọng ngành tối đa có thể có).
 */
export function categoryShare(cats: Share[] | null, category: string | null): { share: number | null; max: number | null } {
  if (!cats || !category) return { share: null, max: null };
  const hit = cats.filter((c) => nameMatch(c.name, category)).reduce((s, c) => s + c.share, 0);
  if (cats.some((c) => nameMatch(c.name, category))) return { share: hit, max: hit };
  const rest = Math.max(0, 1 - cats.reduce((s, c) => s + c.share, 0));
  return { share: rest < 0.02 ? 0 : null, max: rest };
}
const AGE_BUCKETS: [string, number, number][] = [['18-24', 18, 24], ['25-34', 25, 34], ['35-44', 35, 44], ['45-54', 45, 54], ['55+', 55, 200]];
/** Tỷ lệ follower trong khoảng tuổi (cộng các nhóm tuổi giao với khoảng). */
export function ageShare(ages: Record<string, number> | null, min: number, max: number) {
  if (!ages) return null;
  const hit = AGE_BUCKETS.filter(([k, lo, hi]) => ages[k] != null && hi >= min && lo <= max);
  return hit.length ? hit.reduce((s, [k]) => s + ages[k], 0) : null;
}

/** KL theo follower khi Danh bạ chưa có: KL cao nhất mà follower đạt ngưỡng follower tối thiểu brand đặt. */
export function inferKl(followers: number | null, rules: BrandRules) {
  if (followers == null) return null;
  return [...KL_LEVELS].reverse().find((lv) => rules.kl[lv]?.followersMin != null && followers >= rules.kl[lv]!.followersMin!) ?? null;
}

const bookingDate = (b: PastBooking) => b.airDate ?? b.planAirDate ?? (b.planMonth ? new Date(`${b.planMonth.replace('/', '-')}-01T00:00:00+07:00`) : null);
const sortedBookings = (h: History) => [...h.bookings].sort((a, b) => +(bookingDate(b) ?? 0) - +(bookingDate(a) ?? 0));
/** Giá booking gần nhất với UpBase (I-52). */
export const lastPrice = (h: History) => sortedBookings(h).find((b) => b.cost && b.cost > 0)?.cost ?? null;

/** Giá dùng tính CPV: giá KOC báo (bước 6) → giá chốt gần nhất → rate card ở Danh bạ → phí book gần nhất trong kho. */
export function priceOf(s: Subject, d: Declare) {
  if (d.quote) return { price: d.quote, source: 'Giá KOC báo' };
  const last = lastPrice(s.history);
  if (last) return { price: last, source: 'Giá chốt gần nhất' };
  if (s.rateCard) return { price: s.rateCard, source: 'Rate card Danh bạ' };
  if (s.metrics?.castFee) return { price: s.metrics.castFee, source: 'Phí book gần nhất (kho)' };
  return { price: null, source: null };
}

/** Lần trễ > 2 ngày, job huỷ, phản ánh thái độ (K15, E3). */
function conduct(h: History, now: Date) {
  const since6m = new Date(+now - 182 * DAY);
  const late = (b: PastBooking) => (b.airDate && b.planAirDate ? +b.airDate - +b.planAirDate > 2 * DAY : b.slaLate);
  const jobLate = (j: PastJob) => !!(j.submittedAt && j.deadline && +j.submittedAt - +j.deadline > 2 * DAY);
  const recent = [
    ...h.bookings.filter((b) => b.airDate || b.planAirDate).map((b) => ({ at: bookingDate(b)!, late: late(b) })),
    ...h.jobs.filter((j) => j.stage !== CANCELLED && j.submittedAt).map((j) => ({ at: j.submittedAt!, late: jobLate(j) })),
  ].sort((a, b) => +b.at - +a.at);
  return {
    lateIn3: recent.slice(0, 3).filter((x) => x.late).length,
    late6m: recent.filter((x) => x.at >= since6m && x.late).length,
    jobs6m: recent.filter((x) => x.at >= since6m).length,
    cancelled6m: h.jobs.filter((j) => j.stage === CANCELLED && j.createdAt >= since6m).length,
    attitude6m: h.ratings.filter((r) => r.at >= since6m && r.tags.includes('HARD_TO_WORK')).length,
    m3: h.outcomes.filter((o) => o.at >= since6m && o.contentError === 'M3').length,
    kpiMet: h.outcomes.filter((o) => o.at >= since6m && o.kpiMet === true).length,
    kpiFail: h.outcomes.filter((o) => o.at >= since6m && o.kpiMet === false).length,
  };
}

/** Bước 2: creator có khớp yêu cầu không (ngành của brand, cấp KOC cần book). Trả lý do nếu không. Brand chỉ định thì luôn vào;
 * creator khớp từ khoá của đợt thì bỏ qua điều kiện ngành. */
export function outOfPool(s: Subject, ctx: Context, kl: string | null): string | null {
  if (ctx.include.has(s.handle)) return null;
  const { max } = categoryShare(s.metrics?.categories ?? null, ctx.category);
  if (!s.kwHits?.length && max != null && max * 100 < ctx.rules.industryGmvMin) return `Hàng ngành ${ctx.category} chỉ chiếm tối đa ${pct(max)} GMV của kênh (cần từ ${ctx.rules.industryGmvMin}%)`;
  if (ctx.neededKls.length && kl && !ctx.neededKls.includes(kl)) return `Cấp ${kl} không nằm trong số KOC cần book`;
  return null;
}

/** Bước 3: knock-out bằng dữ liệu. ko = loại; flags = cảnh báo / thiếu số liệu (không loại). */
export function dataKnockouts(s: Subject, ctx: Context, kl: string | null, d: Declare): { ko: Finding[]; flags: Finding[] } {
  const ko: Finding[] = [];
  const flags: Finding[] = [];
  const m = s.metrics;
  if (s.blacklisted) ko.push({ code: 'BL', detail: s.blacklistReason ?? 'Không ghi lý do' });
  if (ctx.exclude.has(s.handle)) ko.push({ code: 'I36', detail: 'Brand cấm KOC này trong đợt' });
  const latest = ctx.brandName ? [...s.history.reviews].filter((r) => brandKey(r.brand) === brandKey(ctx.brandName)).sort((a, b) => +b.at - +a.at)[0] : null;
  if (latest?.verdict === 'NOT_SUITABLE') ko.push({ code: 'BR', detail: `Đánh giá ngày ${latest.at.toLocaleDateString('vi-VN')}` });

  // K6: lần book cùng brand gần nhất (Lark + job trong app) so với ngày air dự kiến.
  if (ctx.brandName) {
    const key = brandKey(ctx.brandName);
    const dates = [
      ...s.history.bookings.filter((b) => brandKey(b.brand) === key).map((b) => ({ at: bookingDate(b), what: b.code })),
      ...s.history.jobs.filter((j) => j.brandKey === key && j.stage !== CANCELLED).map((j) => ({ at: j.deadline ?? j.createdAt, what: 'job trong app' })),
    ].filter((x): x is { at: Date; what: string } => !!x.at);
    const near = dates.sort((a, b) => Math.abs(+a.at - +ctx.airAt) - Math.abs(+b.at - +ctx.airAt))[0];
    if (near) {
      const days = Math.round(Math.abs(+ctx.airAt - +near.at) / DAY);
      if (days < ctx.rules.cooldownDays) ko.push({ code: 'K6', detail: `Đã book ${ctx.brandName} ngày ${near.at.toLocaleDateString('vi-VN')} (${near.what}), chỉ cách ngày air ${days} ngày (cần từ ${ctx.rules.cooldownDays} ngày)` });
    }
  }
  // K7: booking cùng tháng air cho brand cùng tập đoàn / ngành con.
  if (ctx.groupKeys.size && ctx.airMonth) {
    const month = ctx.airMonth;
    const hit = [
      ...s.history.bookings.filter((b) => ctx.groupKeys.has(brandKey(b.brand)) && (b.planMonth?.replace('/', '-') === month || bookingDate(b)?.toISOString().slice(0, 7) === month)).map((b) => `${b.brand} (${b.code})`),
      ...s.history.jobs.filter((j) => ctx.groupKeys.has(j.brandKey) && j.stage !== CANCELLED && (j.deadline ?? j.createdAt).toISOString().slice(0, 7) === month).map(() => 'job trong app'),
    ];
    if (hit.length) ko.push({ code: 'K7', detail: `Tháng ${month} đang chạy cho ${hit.slice(0, 3).join(', ')}` });
  }
  // K9: ngưỡng theo KL (không áp Threads). Chỉ số Must dưới ngưỡng thì loại, Nice to have thì cảnh báo.
  if (ctx.channel !== 'Threads' && kl && ctx.rules.kl[kl]) {
    const r = ctx.rules.kl[kl]!;
    const must = new Set(r.must ?? ['followersMin', 'viewsMin']);
    const price = priceOf(s, d).price;
    const cpv = price && m?.medianViews ? price / m.medianViews : null;
    const tests: [keyof typeof r, string, number | null, (v: number, t: number) => boolean, (v: number) => string][] = [
      ['followersMin', 'Follower', m?.followers ?? null, (v, t) => v >= t, (v) => vn.format(v)],
      ['viewsMin', 'View trung vị', m?.medianViews ?? null, (v, t) => v >= t, (v) => vn.format(v)],
      ['unitsSoldMin', 'Lượt bán 30 ngày', m?.unitsSold ?? null, (v, t) => v >= t, (v) => vn.format(v)],
      ['cpvMax', 'CPV', cpv, (v, t) => v <= t, (v) => money(v)],
      ['castMax', 'Cast', price, (v, t) => v <= t, (v) => money(v)],
    ];
    for (const [k, label, v, ok, fmt] of tests) {
      const t = r[k] as number | undefined;
      if (t == null) continue;
      if (v == null) flags.push({ code: 'K9', detail: `${label}: chưa có số liệu để so ngưỡng ${kl}` });
      else if (!ok(v, t)) (must.has(k) ? ko : flags).push({ code: 'K9', detail: `${label} ${fmt(v)} ${k.endsWith('Max') ? '>' : '<'} ngưỡng ${kl} ${fmt(t)}${must.has(k) ? '' : ' (chỉ cảnh báo)'}` });
    }
  }
  // K10: tệp follower bắt buộc của SKU.
  const p = ctx.product;
  if (p) {
    const female = m?.female ?? null;
    const young = ageShare(m?.ages ?? null, 18, 34);
    const region = regionShare(m?.locations ?? null, p.regions);
    const tests: [number | null, number | null, string][] = [
      [p.femaleMin, female, 'Follower nữ'], [p.age18_34Min, young, 'Follower 18–34'], [p.regions.length ? p.regionMin : null, region, `Follower tại ${p.regions.join(', ')}`],
    ];
    for (const [min, v, label] of tests) {
      if (min == null) continue;
      if (v == null) flags.push({ code: 'K10', detail: `${label}: chưa có số liệu` });
      else if (v * 100 < min) ko.push({ code: 'K10', detail: `${label} ${pct(v)} < ${min}%` });
    }
  }
  // K13: chỉ khi mục tiêu Convert trên kênh có giỏ. Quyền gắn giỏ suy từ việc có video gắn giỏ / có bán trong 30 ngày.
  if (ctx.objective === 'Convert' && (ctx.channel === 'TikTok' || ctx.channel === 'Shopee')) {
    const signals = [m?.ecVideos, m?.unitsSold, m?.gmv, m?.products].filter((x): x is number => x != null);
    if (!signals.length) flags.push({ code: 'K13', detail: 'Chưa có số liệu video gắn giỏ / lượt bán' });
    else if (signals.every((x) => x === 0)) ko.push({ code: 'K13', detail: 'Không có video gắn giỏ, lượt bán, GMV trong 30 ngày (suy ra chưa có quyền gắn giỏ)' });
  }
  // K15: tác phong (nội bộ, không xuất cho brand).
  const c = conduct(s.history, ctx.now);
  const k15 = [
    c.lateIn3 >= 2 && `trễ > 2 ngày ${c.lateIn3}/3 job gần nhất`,
    c.cancelled6m >= 1 && `${c.cancelled6m} job bị huỷ trong 6 tháng`,
    c.attitude6m >= 1 && `${c.attitude6m} lần bị chấm "Khó phối hợp" trong 6 tháng`,
    c.m3 >= 1 && `${c.m3} lỗi content M3 trong 6 tháng`,
  ].filter(Boolean);
  if (k15.length) ko.push({ code: 'K15', detail: k15.join('; ') });

  // Gợi ý cho bước 4 từ tiêu đề video nổi bật (kho chỉ có tiêu đề, chưa có lời thoại).
  const titles = (m?.topVideos ?? []).map((v) => v.title.toLowerCase());
  const banned = [...COMMON_BANNED, ...ctx.bannedClaims, ...(p?.bannedWords ?? [])].map((w) => w.toLowerCase()).filter(Boolean);
  const words = banned.filter((w) => titles.some((t) => t.includes(w)));
  if (words.length) flags.push({ code: 'K4', detail: `Tiêu đề video nổi bật có từ cấm: ${[...new Set(words)].join(', ')}` });
  const sold = (m?.topVideos ?? []).map((v) => `${v.title} ${v.products ?? ''}`.toLowerCase()); // thêm tên sản phẩm gắn trong video
  const rivals = ctx.competitors.filter((r) => r && sold.some((t) => t.includes(r.toLowerCase())));
  if (rivals.length) flags.push({ code: 'K8', detail: `Video nổi bật (tiêu đề / sản phẩm gắn) nhắc đối thủ: ${rivals.join(', ')}` });
  if (ctx.include.has(s.handle)) flags.push({ code: 'I36', detail: 'Brand chỉ định KOC này: luôn giữ lại' });
  return { ko, flags };
}

/** Bước 6: loại theo KOC khai báo. */
export function declareKnockouts(ctx: Context, d: Declare): Finding[] {
  return [
    d.noCompetitor === false && { code: 'K8', detail: 'KOC không cam kết không đăng đối thủ sau air' },
    ctx.expertClaim && d.declared && !d.certificate?.trim() && { code: 'K12', detail: 'Nội dung có claim chuyên môn, KOC chưa có chứng chỉ hành nghề' },
    ctx.gmvMax && d.adsCode === false && { code: 'K14', detail: 'Brand chạy GMV Max, KOC không đồng ý ads code' },
  ].filter((x): x is Finding => !!x);
}

// ---------------------------------------------------------------- Chấm điểm
export type Part = { id: string; label: string; score: number | null; value: string | null; manual?: boolean; must?: boolean };
export type GroupResult = { group: Group; weight: number; score: number | null; parts: Part[]; note?: string };
export type ScoreResult = {
  groups: GroupResult[]; total: number | null; coverage: number; tier: string; tone: string; recommend: string | null; action: string;
  mustFail: string[]; strengths: string[]; weaknesses: string[];
};

/** Điểm tự động một tiêu chí: [điểm | null, giá trị hiển thị]. */
function autoScore(id: string, s: Subject, ctx: Context, kl: string | null, d: Declare): [number | null, string | null] {
  const m = s.metrics;
  const p = ctx.product;
  const bm = (kl && ctx.benchmarks[kl]?.n ? ctx.benchmarks[kl] : null) ?? ctx.benchmarks['*'];
  switch (id) {
    case 'A1': {
      if (!p) return [null, 'Đợt chưa chọn SKU'];
      const parts: [string, number | null][] = [];
      if (p.targetGender === 'Nữ' || (!p.targetGender && p.femaleMin != null)) parts.push(['nữ', m?.female ?? null]);
      else if (p.targetGender === 'Nam') parts.push(['nam', m?.female == null ? null : 1 - m.female]);
      if (p.ageMin != null || p.ageMax != null) parts.push([`${p.ageMin ?? 18}–${p.ageMax ?? 65} tuổi`, ageShare(m?.ages ?? null, p.ageMin ?? 18, p.ageMax ?? 200)]);
      else if (p.age18_34Min != null) parts.push(['18–34 tuổi', ageShare(m?.ages ?? null, 18, 34)]);
      if (p.regions.length) parts.push([p.regions.join(', '), regionShare(m?.locations ?? null, p.regions)]);
      if (!parts.length) return [null, 'SKU chưa khai TA (giới tính, tuổi, khu vực)'];
      const known = parts.filter(([, v]) => v != null) as [string, number][];
      const v = avg(known.map(([, x]) => x));
      return v == null ? [null, 'Chưa có chân dung follower'] : [band(v, BANDS.A1), `Khớp ${pct(v)} (${known.map(([k, x]) => `${k} ${pct(x)}`).join(', ')})`];
    }
    case 'A2': {
      const { share } = categoryShare(m?.categories ?? null, ctx.category);
      const typed = p?.channelTypes.length && s.niche ? (p.channelTypes.some((t) => nameMatch(t, s.niche!)) ? 5 : 1) : null;
      const scores = [share == null ? null : band(share, BANDS.A2), typed].filter((x): x is number => x != null);
      if (!scores.length) return [null, ctx.category ? 'Chưa có tỷ trọng GMV theo ngành' : 'Brand chưa khai ngành hàng'];
      const v = [share != null && `GMV ${ctx.category} ${pct(share)}`, typed != null && `tệp kênh ${s.niche}${typed === 5 ? ' khớp' : ' không khớp'} SKU`].filter(Boolean).join('; ');
      return [Math.round(avg(scores)!), v];
    }
    case 'B1': return m?.medianViews != null && m.followers ? [band(m.medianViews / m.followers, BANDS.B1), `${pct(m.medianViews / m.followers, 1)} (${vn.format(m.medianViews)} / ${vn.format(m.followers)})`] : [null, null];
    case 'B2': return m?.er != null ? [band(m.er, BANDS.B2), pct(m.er, 1)] : [null, null];
    case 'C1': {
      if (m?.gmv == null || !m.ecVideos) return [null, m?.ecVideos === 0 ? 'Không có video gắn giỏ' : null];
      const per = m.gmv / m.ecVideos;
      if (!bm?.gmvPerVideo) return [null, `${money(per)} / video (chưa có benchmark)`];
      return [band(per / bm.gmvPerVideo, BANDS.C1), `${money(per)} / video = ${pct(per / bm.gmvPerVideo)} benchmark ${kl ?? 'chung'}`];
    }
    case 'C2': {
      const aired = s.history.bookings.filter((b) => b.airDate);
      if (!aired.length) return [1, 'Chưa từng làm video cho UpBase'];
      if (aired.length <= 3) return [3, `${aired.length} video với UpBase`];
      const g = avg(aired.map((b) => b.gmv30).filter((x): x is number => x != null));
      const good = g != null && bm?.gmvPerVideo ? g >= bm.gmvPerVideo : null;
      return [good ? 5 : 4, `${aired.length} video với UpBase${g != null ? `, GMV 30 ngày TB ${money(g)}` : ''}${good === false ? ' (dưới benchmark)' : ''}`];
    }
    case 'E1': case 'TE1': {
      const { price, source } = priceOf(s, d);
      if (!price || !m?.medianViews) return [null, price ? 'Chưa có view trung vị' : 'Chưa có giá'];
      const cpv = price / m.medianViews;
      if (id === 'TE1') return [band(cpv, BANDS.TE1), `${money(cpv)} / view (${source})`];
      if (!bm?.cpv) return [null, `CPV ${money(cpv)} (chưa có benchmark)`];
      return [band(cpv / bm.cpv, BANDS.E1), `CPV ${money(cpv)} = ${(cpv / bm.cpv).toFixed(2).replace('.', ',')}× benchmark ${kl ?? 'chung'} (${source})`];
    }
    case 'E2': {
      const last3 = [...s.history.ratings].sort((a, b) => +b.at - +a.at).slice(0, 3);
      if (!last3.length) return [3, 'Chưa có rating, KOC mới tính 3 điểm'];
      const v = avg(last3.map((r) => r.stars))!;
      return [band(v, BANDS.E2), `${v.toFixed(1).replace('.', ',')} sao (${last3.length} job gần nhất)`];
    }
    case 'E3': {
      const c = conduct(s.history, ctx.now);
      if (!c.jobs6m && !c.kpiMet && !c.kpiFail) return [3, 'Chưa hợp tác trong 6 tháng'];
      const v = `${c.jobs6m} job 6 tháng, trễ ${c.late6m} lần, đạt KPI ${c.kpiMet}, không đạt ${c.kpiFail}`;
      if (c.late6m >= 2 || c.kpiFail >= 1) return [1, v];
      if (c.kpiMet >= 2) return [c.late6m === 0 ? 5 : 4, v];
      return [3, v];
    }
    case 'G0_LIFESTYLE': {
      if (!m?.videos30 || m.ecVideos == null) return [null, null];
      const cart = m.ecVideos / m.videos30;
      return cart > 0.7 ? [1, `Gắn giỏ ${pct(cart)} video`] : [null, `Gắn giỏ ${pct(cart)} video; Booker chấm % lifestyle`];
    }
    case 'G0_REGION': {
      const v = regionShare(m?.locations ?? null, p?.regions ?? []);
      return v == null ? [null, p?.regions.length ? 'Chưa có follower theo tỉnh' : 'SKU chưa khai khu vực'] : [band(v, BANDS.G0_REGION), pct(v)];
    }
    case 'G0_AFFORD': {
      const price = ctx.dealPrice ?? p?.price;
      if (!m?.aov || !price) return [null, !price ? 'Chưa có giá SKU' : null];
      return [band(m.aov / price, BANDS.G0_AFFORD), `AOV KOC ${money(m.aov)} = ${pct(m.aov / price)} giá SKU`];
    }
    case 'G0_FREQ': return m?.videos30 != null ? [band(m.videos30 / (30 / 7), BANDS.G0_FREQ), `${(m.videos30 / (30 / 7)).toFixed(1).replace('.', ',')} video / tuần`] : [null, null];
    case 'G0_ADS': {
      if (d.adsCode === undefined) return [null, null];
      if (!d.adsCode) return [1, 'Không đồng ý ads code'];
      if ((d.adsDays ?? 0) < ctx.rules.adsCodeDays) return [3, `Đồng ý ${d.adsDays ?? 0} / ${ctx.rules.adsCodeDays} ngày`];
      return [d.reup?.length ? 5 : 4, `Đủ ${d.adsDays} ngày${d.reup?.length ? `, reup ${d.reup.join(', ')}` : ', không reup'}`];
    }
    case 'G0_SCRIPT': return d.revisions == null ? [null, null] : [d.revisions >= 2 ? 5 : d.revisions === 1 ? 3 : 1, `Nhận ${d.revisions} vòng sửa`];
    default: return [null, null];
  }
}

function part(c: Criterion, s: Subject, ctx: Context, kl: string | null, d: Declare, manual: Manual): Part {
  const [auto, value] = c.auto ? autoScore(c.id, s, ctx, kl, d) : [null, null];
  const mm = manual[c.id];
  return mm ? { id: c.id, label: c.label, score: mm.score, value: mm.note ? `Booker: ${mm.note}` : 'Booker chấm', manual: true } : { id: c.id, label: c.label, score: auto, value };
}

export function scoreSubject(s: Subject, ctx: Context, kl: string | null, d: Declare, manual: Manual): ScoreResult {
  const weights = WEIGHTS[ctx.channel];
  const groups: GroupResult[] = [];
  const mean = (parts: Part[]) => { const v = avg(parts.map((p) => p.score).filter((x): x is number => x != null)); return v == null ? null : Math.round(v * 10) / 10; };
  for (const g of GROUPS) {
    if (g === 'G0') continue;
    const parts = criteriaFor(g, ctx.channel).map((c) => part(c, s, ctx, kl, d, manual));
    groups.push({ group: g, weight: weights[g], score: mean(parts), parts });
  }
  // Nhóm 0: brand chọn 3–5 tiêu chí (I-27); không chọn thì lấy điểm trung bình nhóm A.
  const a = groups.find((x) => x.group === 'A')!;
  const mustFail: string[] = [];
  if (ctx.rules.group0.length) {
    const parts = ctx.rules.group0.map((g) => ({ ...part(GROUP0.find((c) => c.id === g.id)!, s, ctx, kl, d, manual), must: g.mode === 'must' }));
    for (const p of parts) if (p.must && p.score != null && p.score < 3) mustFail.push(`${p.label} ${p.score}/5`);
    // Tiêu chí "Bắt buộc" chỉ dùng để lọc; điểm nhóm 0 = TB các tiêu chí "Cộng điểm" (doc: thư viện nhóm 0).
    const scored = parts.filter((p) => !p.must);
    groups.unshift({ group: 'G0', weight: weights.G0, score: scored.length ? mean(scored) : a.score, parts, note: scored.length ? undefined : 'Brand chỉ chọn tiêu chí bắt buộc: điểm nhóm lấy theo "Hợp brand & tệp khách"' });
  } else groups.unshift({ group: 'G0', weight: weights.G0, score: a.score, parts: [], note: 'Brand chưa chọn yêu cầu riêng: lấy điểm theo "Hợp brand & tệp khách"' });

  const filled = (gr: GroupResult) => {
    const ps = gr.parts.length ? gr.parts.filter((p) => !p.must) : a.parts;
    return ps.length ? ps.filter((p) => p.score != null).length / ps.length : 0;
  };
  const scored = groups.filter((g) => g.score != null);
  const wSum = scored.reduce((x, g) => x + g.weight, 0);
  const total = wSum ? Math.round((scored.reduce((x, g) => x + (g.score! / 5) * g.weight, 0) / wSum) * 1000) / 10 : null;
  const coverage = Math.round(groups.reduce((x, g) => x + g.weight * filled(g), 0)) / 100;
  const tier = mustFail.length || total == null ? null : coverage < MIN_COVERAGE ? NO_DATA_TIER : tierOf(total);
  const fail = { label: 'Không hợp tác', tone: 'bg-critical-soft text-critical', recommend: null, action: 'Ghi lý do (mã K hoặc nhóm điểm thấp) vào lịch sử KOC' };
  const t = mustFail.length ? fail : tier ?? NO_DATA_TIER;
  const all = groups.flatMap((g) => g.parts).filter((p) => p.score != null && !p.must);
  return {
    groups, total, coverage, tier: t.label, tone: t.tone, recommend: t.recommend, action: t.action, mustFail,
    strengths: all.filter((p) => p.score! >= 4).sort((x, y) => y.score! - x.score!).slice(0, 3).map((p) => `${p.label} ${p.score}/5`),
    weaknesses: all.filter((p) => p.score! <= 2).sort((x, y) => x.score! - y.score!).slice(0, 3).map((p) => `${p.label} ${p.score}/5`),
  };
}

export type Evaluation = { kl: string | null; klSource: string | null; outOfPool: string | null; ko: Finding[]; flags: Finding[]; declKo: Finding[]; score: ScoreResult; price: number | null; priceSource: string | null };

/** Toàn bộ đánh giá một ứng viên với khai báo và điểm tay hiện có. */
export function evaluate(s: Subject, ctx: Context, d: Declare = {}, manual: Manual = {}): Evaluation {
  const inferred = s.kl ? null : inferKl(s.metrics?.followers ?? null, ctx.rules);
  const kl = s.kl ?? inferred;
  const { ko, flags } = dataKnockouts(s, ctx, kl, d);
  const score = scoreSubject(s, ctx, kl, d, manual);
  const { price, source } = priceOf(s, d);
  return { kl, klSource: s.kl ? 'Danh bạ' : inferred ? 'Suy theo follower' : null, outOfPool: outOfPool(s, ctx, kl), ko, flags, declKo: declareKnockouts(ctx, d), score, price, priceSource: source };
}
