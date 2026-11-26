// Nạp dữ liệu cho Creator matching: bối cảnh đợt (Khối 1–4, benchmark) và hồ sơ ứng viên (số liệu + lịch sử với UpBase).
// Nguồn số liệu creator: kho dữ liệu (WarehouseCreator) nếu có, không thì số TikTok Shop đã lưu ở Danh bạ.
// Lịch sử: booking đồng bộ từ Lark (bảng Booking, giữ nguyên), job trong app, rating sao, đánh giá kênh, kết quả sau air.
import type { Koc, MatchBrief, Prisma, Product, Brand, WarehouseCreator } from '@prisma/client';
import { db } from '../db';
import { brandKey } from '../booking/listing';
import { profileInsights, USD_VND } from '../koc/kocInsights';
import type { Benchmark, Context, History, Metrics, PastBooking, Share, Subject, Video } from './engine';
import { CHANNEL_PLATFORMS, CHANNELS, parseRules, parseSlots, type Channel, type Outcome } from './spec';

// ponytail: pool từ kho giới hạn theo GMV / follower sau khi lọc ngành và follower tối thiểu; nâng khi kho đủ sạch và cần rộng hơn.
export const POOL_CAP = 3000;

export type BriefFull = MatchBrief & { brandRef: Brand | null; product: Product | null };
export const loadBrief = (id: string) => db.matchBrief.findUnique({ where: { id }, include: { brandRef: true, product: true } });

const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(String(v).replace(/[^\d.-]/g, ''))) ? null : Number(String(v).replace(/[^\d.-]/g, '')));
const normKl = (v: unknown) => { const m = String(v ?? '').match(/KL\s*([1-7])/i); return m ? `KL${m[1]}` : null; };
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const i = s.length >> 1; return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2; };

/** Benchmark GMV/video, view, CPV theo KL (I-38) từ booking đã air trên Lark: 2 tháng gần nhất, ít mẫu thì 6 tháng. */
export async function loadBenchmarks(): Promise<Record<string, Benchmark>> {
  const rows = await db.$queryRaw<{ kl: string | null; gmv30: string | null; views30: string | null; cost: number | null; air: Date }[]>`
    select extra->>'kl' kl, extra->>'gmv30' gmv30, extra->>'views30' views30, cost, "airDate" air
    from "Booking" where "airDate" >= now() - interval '182 days' and "airDate" <= now()`;
  const since2m = Date.now() - 61 * 86_400_000;
  const calc = (list: typeof rows): Benchmark => {
    const parsed = list.map((r) => ({ gmv: num(r.gmv30), views: num(r.views30), cost: r.cost }));
    return {
      gmvPerVideo: median(parsed.map((r) => r.gmv).filter((x): x is number => x != null && x > 0)),
      views: median(parsed.map((r) => r.views).filter((x): x is number => x != null && x > 0)),
      cpv: median(parsed.filter((r) => r.cost && r.views).map((r) => r.cost! / r.views!)),
      n: parsed.filter((r) => r.gmv != null || r.views != null).length,
    };
  };
  const pick = (list: typeof rows) => { const recent = calc(list.filter((r) => +r.air >= since2m)); return recent.n >= 5 ? recent : calc(list); };
  const out: Record<string, Benchmark> = { '*': pick(rows) };
  for (const kl of new Set(rows.map((r) => normKl(r.kl)).filter((x): x is string => !!x))) out[kl] = pick(rows.filter((r) => normKl(r.kl) === kl));
  return out;
}

/** Ngày air dự kiến của đợt: tháng + tuần (I-34); chỉ có tháng thì giữa tháng; chưa có thì hôm nay. */
export function airDateOf(month: string | null, week: number | null) {
  if (!month) return new Date();
  const day = week ? Math.min(28, (week - 1) * 7 + 4) : 15;
  return new Date(`${month}-${String(day).padStart(2, '0')}T00:00:00+07:00`);
}

export async function buildContext(b: BriefFull): Promise<Context> {
  const brand = b.brandRef;
  const rules = parseRules(brand?.rules);
  const p = b.product;
  const peerWhere: Prisma.BrandWhereInput[] = [
    ...(brand?.group ? [{ group: { equals: brand.group, mode: 'insensitive' as const } }] : []),
    ...(brand?.subCategory ? [{ subCategory: { equals: brand.subCategory, mode: 'insensitive' as const } }] : []),
  ];
  const [peers, benchmarks] = await Promise.all([
    brand && peerWhere.length ? db.brand.findMany({ where: { id: { not: brand.id }, OR: peerWhere }, select: { name: true } }) : [],
    loadBenchmarks(),
  ]);
  const channel = (CHANNELS as readonly string[]).includes(b.channel) ? (b.channel as Channel) : 'TikTok';
  const lower = (xs: string[]) => new Set(xs.map((h) => h.trim().replace(/^@/, '').toLowerCase()).filter(Boolean));
  return {
    brandName: brand?.name ?? b.brand, channel, objective: b.objective, gmvMax: b.gmvMax, expertClaim: b.expertClaim,
    category: brand?.category ?? b.category ?? null, competitors: brand?.competitors ?? [], bannedClaims: brand?.bannedClaims ?? [],
    groupKeys: new Set(peers.map((x) => brandKey(x.name))), rules,
    product: p ? {
      price: p.price, targetGender: p.targetGender, ageMin: p.ageMin, ageMax: p.ageMax, femaleMin: p.femaleMin, age18_34Min: p.age18_34Min,
      regions: p.regions, regionMin: p.regionMin, channelTypes: p.channelTypes, exclusions: p.exclusions, bannedWords: p.bannedWords,
    } : null,
    dealPrice: b.dealPrice, airAt: airDateOf(b.airMonth, b.airWeek), airMonth: b.airMonth, benchmarks,
    include: lower(b.includeHandles), exclude: lower(b.excludeHandles), neededKls: [...new Set(parseSlots(b.slots).map((s) => s.kl))], now: new Date(),
  };
}

const shares = (v: unknown): Share[] | null => (Array.isArray(v) ? (v as Share[]).filter((x) => x && typeof x.name === 'string' && typeof x.share === 'number') : null);

export function metricsFromWarehouse(w: WarehouseCreator): Metrics {
  return {
    source: 'Kho dữ liệu', at: (w.sourceAt ?? w.syncedAt).toISOString(),
    followers: w.followers, medianViews: w.medianViews, er: w.er, videos30: w.videos30, ecVideos: w.ecVideos, unitsSold: w.unitsSold,
    gmv: w.gmv, gpm: w.gpm, aov: w.aov, female: w.female, ages: (w.ages as Record<string, number> | null) ?? null,
    locations: shares(w.locations), categories: shares(w.categories), brandCount: w.brandCount, brands: w.brands, castFee: w.castFee,
    products: w.products, topVideos: (Array.isArray(w.topVideos) ? w.topVideos : []) as Video[],
  };
}

type KocRow = Pick<Koc, 'id' | 'handle' | 'platform' | 'name' | 'nickname' | 'avatarUrl' | 'followers' | 'avgViews' | 'unitsSold' | 'gpmUsd' | 'ttsProfile' | 'statsAt' | 'kl' | 'klAuto' | 'niche' | 'blacklisted' | 'blacklistReason' | 'rateCard'>;
/** Số TikTok Shop (Trạm dữ liệu) đã lưu ở Danh bạ: view là lượt xem TB video gắn giỏ, tỉnh thành chỉ có top 3. */
export function metricsFromKoc(k: KocRow): Metrics | null {
  if (!k.statsAt) return k.followers != null ? { ...EMPTY, source: 'Danh bạ', followers: k.followers } : null;
  const p = profileInsights(k.ttsProfile);
  const ages = p.age18_24 == null && p.age25_34 == null ? null : { '18-24': p.age18_24 ?? 0, '25-34': p.age25_34 ?? 0 };
  return {
    ...EMPTY, source: 'TikTok Shop (Danh bạ)', at: k.statsAt.toISOString(), followers: k.followers, medianViews: k.avgViews, er: p.engagement,
    unitsSold: k.unitsSold, gmv: p.gmvExactVnd, gpm: k.gpmUsd == null ? null : k.gpmUsd * USD_VND, aov: p.aovMid, female: p.female, ages,
    locations: p.locations.length ? p.locations : null, categories: p.categories.length ? p.categories : null, brandCount: p.brandCount,
  };
}
const EMPTY: Metrics = {
  source: '', at: null, followers: null, medianViews: null, er: null, videos30: null, ecVideos: null, unitsSold: null, gmv: null, gpm: null, aov: null,
  female: null, ages: null, locations: null, categories: null, brandCount: null, brands: [], castFee: null, products: null, topVideos: [],
};

const KOC_SELECT = {
  id: true, handle: true, platform: true, name: true, nickname: true, avatarUrl: true, followers: true, avgViews: true, unitsSold: true, gpmUsd: true,
  ttsProfile: true, statsAt: true, kl: true, klAuto: true, niche: true, blacklisted: true, blacklistReason: true, rateCard: true,
} as const;

/** Lịch sử với UpBase theo handle TikTok chính (booking Lark) và kocId (job, rating, đánh giá kênh, kết quả sau air). */
async function loadHistories(handles: string[], kocIds: string[]) {
  const [bookings, jobs, ratings, reviews, outcomes] = await Promise.all([
    handles.length ? db.$queryRaw<(Omit<PastBooking, 'views30' | 'gmv30'> & { h: string; extra: Record<string, unknown> })[]>`
      select lower(channel) h, code, brand, "airDate", "planAirDate", "planMonth", cost, "slaLate", extra from "Booking" where lower(channel) = any(${handles})` : [],
    kocIds.length ? db.job.findMany({ where: { kocId: { in: kocIds } }, select: { kocId: true, stage: true, deadline: true, submittedAt: true, createdAt: true, brand: { select: { name: true } } } }) : [],
    kocIds.length ? db.kocRating.findMany({ where: { kocId: { in: kocIds } }, select: { kocId: true, stars: true, tags: true, evaluatedAt: true } }) : [],
    kocIds.length ? db.kocReview.findMany({ where: { kocId: { in: kocIds } }, select: { kocId: true, verdict: true, brand: true, createdAt: true } }) : [],
    handles.length ? db.$queryRaw<{ handle: string; outcome: Outcome; updatedAt: Date }[]>`
      select handle, outcome, "updatedAt" from "MatchCandidate" where outcome is not null and handle = any(${handles})` : [],
  ]);
  const by = <T, K>(xs: T[], key: (x: T) => K) => { const m = new Map<K, T[]>(); for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]); return m; };
  const bk = by(bookings, (b) => b.h), jb = by(jobs, (j) => j.kocId), rt = by(ratings, (r) => r.kocId), rv = by(reviews, (r) => r.kocId), oc = by(outcomes, (o) => o.handle);
  return (handle: string, kocId: string | null): History => ({
    bookings: (bk.get(handle) ?? []).map((b) => ({ code: b.code, brand: b.brand, airDate: b.airDate, planAirDate: b.planAirDate, planMonth: b.planMonth, cost: b.cost, slaLate: b.slaLate, views30: num(b.extra?.views30), gmv30: num(b.extra?.gmv30) })),
    jobs: (kocId ? jb.get(kocId) ?? [] : []).map((j) => ({ brandKey: brandKey(j.brand?.name), stage: j.stage, deadline: j.deadline, submittedAt: j.submittedAt, createdAt: j.createdAt })),
    ratings: (kocId ? rt.get(kocId) ?? [] : []).map((r) => ({ stars: r.stars, tags: r.tags, at: r.evaluatedAt })),
    reviews: (kocId ? rv.get(kocId) ?? [] : []).map((r) => ({ verdict: r.verdict, brand: r.brand, at: r.createdAt })),
    outcomes: (oc.get(handle) ?? []).map((o) => ({ at: o.outcome.at ? new Date(o.outcome.at) : o.updatedAt, kpiMet: o.outcome.kpiMet ?? null, onTime: o.outcome.onTime ?? null, contentError: o.outcome.contentError ?? null })),
  });
}

/**
 * Hồ sơ ứng viên của đợt. Không truyền handles: cả pool (bước 2) = mọi KOC Danh bạ trên nền tảng của kênh + creator trong kho
 * (lọc ngành, follower tối thiểu, tối đa POOL_CAP). Có handles: chỉ các ứng viên đó (chấm lại một KOC).
 */
export async function loadSubjects(ctx: Context, handles?: string[]): Promise<Subject[]> {
  const platforms = CHANNEL_PLATFORMS[ctx.channel];
  const onlyThese = handles ? { handle: { in: handles } } : {};
  const [kocs, channels] = await Promise.all([
    db.koc.findMany({ where: { platform: { in: platforms }, ...onlyThese }, select: KOC_SELECT }),
    // Kênh phụ trên nền tảng khác (Shopee, FB, IG, Threads) của KOC Danh bạ.
    ctx.channel === 'TikTok' ? [] : db.kocChannel.findMany({ where: { platform: { in: platforms }, ...onlyThese }, select: { platform: true, handle: true, koc: { select: KOC_SELECT } } }),
  ]);
  const dir = new Map<string, { platform: string; handle: string; koc: KocRow }>();
  for (const k of kocs) dir.set(`${k.platform}|${k.handle}`, { platform: k.platform, handle: k.handle, koc: k });
  for (const c of channels) if (!dir.has(`${c.platform}|${c.handle}`)) dir.set(`${c.platform}|${c.handle}`, { platform: c.platform, handle: c.handle, koc: c.koc });

  // Creator trong kho: số liệu cho KOC Danh bạ + pool ngoài Danh bạ.
  const dirHandles = [...dir.values()].map((d) => d.handle);
  let wh: WarehouseCreator[] = [];
  if (handles) wh = await db.warehouseCreator.findMany({ where: { platform: { in: platforms }, handle: { in: handles } } });
  else {
    const mins = ctx.neededKls.map((kl) => ctx.rules.kl[kl]?.followersMin);
    const minF = mins.length && mins.every((x) => x != null) ? Math.min(...(mins as number[])) : 0;
    const cat = ctx.category ? `%${ctx.category.toLowerCase()}%` : null;
    const [pool, known] = await Promise.all([
      db.$queryRaw<WarehouseCreator[]>`
        select * from "WarehouseCreator" w where w.platform = any(${platforms}) and coalesce(w.followers, 0) >= ${minF}
          and (${cat}::text is null or w.categories is null or exists (
            select 1 from jsonb_array_elements(w.categories) e where lower(e->>'name') like ${cat} and (e->>'share')::float * 100 >= ${ctx.rules.industryGmvMin}))
        order by w.gmv desc nulls last, w.followers desc nulls last limit ${POOL_CAP}`,
      dirHandles.length ? db.warehouseCreator.findMany({ where: { platform: { in: platforms }, handle: { in: dirHandles } } }) : [],
    ]);
    wh = [...new Map([...pool, ...known].map((w) => [`${w.platform}|${w.handle}`, w])).values()];
  }
  const whBy = new Map(wh.map((w) => [`${w.platform}|${w.handle}`, w]));
  const keys = [...new Set([...dir.keys(), ...whBy.keys()])];
  // Booking Lark ghi theo ID kênh TikTok chính của KOC.
  const historyKey = (key: string) => dir.get(key)?.koc.handle ?? key.split('|')[1];
  const hist = await loadHistories([...new Set(keys.map(historyKey))], [...new Set([...dir.values()].map((d) => d.koc.id))]);
  return keys.map((key) => {
    const d = dir.get(key);
    const w = whBy.get(key);
    const k = d?.koc;
    const [platform, handle] = key.split('|');
    return {
      platform, handle, name: k?.nickname ?? k?.name ?? w?.nickname ?? handle, kocId: k?.id ?? null, avatarUrl: k?.avatarUrl ?? w?.avatarUrl ?? null,
      kl: k?.kl ?? k?.klAuto ?? null, niche: k?.niche ?? null, blacklisted: k?.blacklisted ?? false, blacklistReason: k?.blacklistReason ?? null,
      rateCard: k?.rateCard ?? null, metrics: w ? metricsFromWarehouse(w) : k ? metricsFromKoc(k) : null,
      history: hist(historyKey(key), k?.id ?? null),
    };
  });
}
