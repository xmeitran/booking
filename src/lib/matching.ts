// Creator matching: chấm KOL trong Danh bạ theo bộ tiêu chí của brief / best practice ngành hàng.
// Tiêu chí thiếu số liệu (KOL chưa có số TikTok) tính là "chưa rõ", không loại; sai tiêu chí rõ ràng thì loại.
import { Prisma } from '@prisma/client';
import { db } from './db';
import { CATEGORY, profileInsights, USD_VND } from './kocInsights';

export type Criteria = {
  niches?: string[]; kl?: string[];
  followersMin?: number; followersMax?: number; avgViewsMin?: number; unitsSoldMin?: number; gpmMin?: number;
  femaleMin?: number; age18_34Min?: number; category?: string; categoryMin?: number; priceMax?: number;
  collab?: 'yes' | 'no';
};

// Ô số của form, theo thứ tự hiển thị. % nhập dạng 0–100.
export const NUM_FIELDS = [
  ['followersMin', 'Follower từ'], ['followersMax', 'Follower đến'], ['avgViewsMin', 'View TB / video từ'],
  ['unitsSoldMin', 'Số món bán 30 ngày từ'], ['gpmMin', 'GPM từ (₫)'], ['priceMax', 'Giá booking gần nhất tối đa (₫)'],
  ['femaleMin', 'Follower nữ từ (%)'], ['age18_34Min', 'Follower 18–34 tuổi từ (%)'], ['categoryMin', 'GMV ngành hàng từ (%)'],
] as const satisfies readonly (readonly [keyof Criteria, string])[];
export const TIKTOK_CATEGORIES = Object.values(CATEGORY);
const PERCENT_FIELDS = new Set<string>(['femaleMin', 'age18_34Min', 'categoryMin']);

/** Đọc bộ tiêu chí từ form. Trả về chuỗi lỗi nếu ô số sai. */
export function parseCriteria(fd: FormData): Criteria | string {
  const c: Criteria = {};
  const list = (k: string) => fd.getAll(k).map(String).filter(Boolean);
  if (list('niches').length) c.niches = list('niches');
  if (list('kl').length) c.kl = list('kl');
  for (const [k, label] of NUM_FIELDS) {
    const raw = String(fd.get(k) ?? '').trim();
    // Ô % có thể có phần thập phân ("55,5"); các ô còn lại bỏ dấu phân cách hàng nghìn ("10.000").
    const s = PERCENT_FIELDS.has(k) ? raw.replace(',', '.') : raw.replace(/[.,\s]/g, '');
    if (!s) continue;
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return `${label}: nhập số ≥ 0.`;
    (c as Record<string, number>)[k] = n;
  }
  const cat = String(fd.get('ttCategory') ?? ''); // 'category' là ngành hàng của brief
  if (TIKTOK_CATEGORIES.includes(cat)) c.category = cat;
  const collab = String(fd.get('collab') ?? '');
  if (collab === 'yes' || collab === 'no') c.collab = collab;
  return c;
}

const short = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const range = (min?: number, max?: number) => (min != null && max != null ? `${short.format(min)}–${short.format(max)}` : min != null ? `≥ ${short.format(min)}` : `≤ ${short.format(max!)}`);

/** Tóm tắt bộ tiêu chí thành các nhãn ngắn. */
export function describe(c: Criteria): string[] {
  return [
    c.niches?.length && `Tệp: ${c.niches.join(', ')}`,
    c.kl?.length && `Cấp: ${c.kl.join(', ')}`,
    (c.followersMin != null || c.followersMax != null) && `Follower ${range(c.followersMin, c.followersMax)}`,
    c.avgViewsMin != null && `View TB ≥ ${short.format(c.avgViewsMin)}`,
    c.unitsSoldMin != null && `Bán ≥ ${short.format(c.unitsSoldMin)} món`,
    c.gpmMin != null && `GPM ≥ ${short.format(c.gpmMin)} ₫`,
    c.priceMax != null && `Giá ≤ ${short.format(c.priceMax)} ₫`,
    c.femaleMin != null && `Nữ ≥ ${c.femaleMin}%`,
    c.age18_34Min != null && `18–34 tuổi ≥ ${c.age18_34Min}%`,
    c.category && `${c.category}${c.categoryMin != null ? ` ≥ ${c.categoryMin}% GMV` : ''}`,
    c.collab === 'yes' && 'Đã hợp tác với UpBase',
    c.collab === 'no' && 'Chưa hợp tác với UpBase',
  ].filter(Boolean) as string[];
}

export type MatchKoc = {
  id: string; handle: string; name: string; nickname: string | null; avatarUrl: string | null; niche: string | null;
  kl: string | null; klAuto: string | null; followers: number | null; avgViews: number | null; unitsSold: number | null;
  gpmUsd: number | null; ttsProfile: Prisma.JsonValue; bookingCount: number; statsAt: Date | null; gmvRange: string | null;
};
export type Check = { label: string; ok: boolean | null };

const atLeast = (v: number | null | undefined, min?: number) => (min == null ? undefined : v == null ? null : v >= min);

/** Từng tiêu chí: true đạt, false không đạt, null chưa có số liệu. Tiêu chí không đặt thì bỏ qua. */
export function evaluate(c: Criteria, k: MatchKoc, lastPrice: number | null): Check[] {
  const p = profileInsights(k.ttsProfile);
  const hasProfile = k.ttsProfile != null;
  const kl = k.kl ?? k.klAuto;
  const pct = (x: number | null) => (x == null ? null : x * 100);
  const age = p.age18_24 == null && p.age25_34 == null ? null : ((p.age18_24 ?? 0) + (p.age25_34 ?? 0)) * 100;
  const catShare = !c.category ? null : hasProfile ? (p.categories.find((x) => x.name === c.category)?.share ?? 0) * 100 : null;
  const out: [string, boolean | null | undefined][] = [
    ['Tệp kênh', c.niches?.length ? (k.niche ? c.niches.includes(k.niche) : null) : undefined],
    ['Cấp KOL', c.kl?.length ? (kl ? c.kl.includes(kl) : null) : undefined],
    ['Follower từ', atLeast(k.followers, c.followersMin)],
    ['Follower đến', c.followersMax == null ? undefined : k.followers == null ? null : k.followers <= c.followersMax],
    ['View TB', atLeast(k.avgViews, c.avgViewsMin)],
    ['Số món bán', atLeast(k.unitsSold, c.unitsSoldMin)],
    ['GPM', atLeast(k.gpmUsd == null ? null : k.gpmUsd * USD_VND, c.gpmMin)],
    ['Giá', c.priceMax == null ? undefined : lastPrice == null ? null : lastPrice <= c.priceMax],
    ['Follower nữ', atLeast(pct(p.female), c.femaleMin)],
    ['18–34 tuổi', atLeast(age, c.age18_34Min)],
    ['Ngành hàng', c.category ? (catShare == null ? null : catShare >= (c.categoryMin ?? 0.01)) : undefined],
    ['Hợp tác UB', c.collab ? (c.collab === 'yes') === k.bookingCount > 0 : undefined],
  ];
  return out.filter(([, ok]) => ok !== undefined).map(([label, ok]) => ({ label, ok: ok as boolean | null }));
}

export type Match = { koc: MatchKoc; checks: Check[]; passed: number; unknown: number; lastPrice: number | null; brandBookings: number; brandLastMonth: string | null };

/** KOL TikTok trong Danh bạ không trượt tiêu chí nào, xếp: đạt nhiều tiêu chí → bán nhiều → follower. */
export async function matchKocs(c: Criteria, brand?: string | null): Promise<Match[]> {
  const norm = (brand ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const [kocs, prices, booked] = await Promise.all([
    db.koc.findMany({
      where: { platform: 'TikTok', blacklisted: false }, // KOC blacklist không bao giờ được gợi ý
      select: {
        id: true, handle: true, name: true, nickname: true, avatarUrl: true, niche: true, kl: true, klAuto: true, followers: true,
        avgViews: true, unitsSold: true, gpmUsd: true, ttsProfile: true, bookingCount: true, statsAt: true, gmvRange: true,
      },
    }),
    db.$queryRaw<{ h: string; cost: number }[]>`
      select distinct on (lower(channel)) lower(channel) h, cost from "Booking" where cost > 0 and channel is not null
      order by lower(channel), coalesce("airDate", "planAirDate", "larkUpdatedAt") desc`,
    norm
      ? db.$queryRaw<{ h: string; n: number; m: string | null }[]>`
          select lower(channel) h, count(*)::int n, max("planMonth") m from "Booking"
          where channel is not null and lower(regexp_replace(coalesce(brand, ''), '[^[:alnum:]]+', '', 'g')) = ${norm} group by 1`
      : Promise.resolve([]),
  ]);
  const price = new Map(prices.map((r) => [r.h, r.cost]));
  const brandOf = new Map(booked.map((r) => [r.h, r]));
  return kocs
    .map((koc) => {
      const lastPrice = price.get(koc.handle) ?? null;
      const checks = evaluate(c, koc, lastPrice);
      const b = brandOf.get(koc.handle);
      return {
        koc, checks, lastPrice, passed: checks.filter((x) => x.ok).length, unknown: checks.filter((x) => x.ok === null).length,
        brandBookings: b?.n ?? 0, brandLastMonth: b?.m ?? null,
      };
    })
    .filter((m) => m.checks.every((x) => x.ok !== false))
    .sort((a, b) => b.passed - a.passed || (b.koc.unitsSold ?? -1) - (a.koc.unitsSold ?? -1) || (b.koc.followers ?? -1) - (a.koc.followers ?? -1));
}
