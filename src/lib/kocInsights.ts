// Số liệu dẫn xuất cho hồ sơ KOC và Listing: chân dung follower, tỷ trọng GMV, lịch sử hợp tác với UpBase,
// giá đã hợp tác, dự báo View / GMV Target. Định nghĩa theo sheet "[Booking] - Requirement Excel Listing (UpAI)".
import { db } from './db';

// Phí booking kèm thuế TNCN = giá / 0,9 (cách Lark đang tính). Kế toán chưa chốt giữa ÷0,9 và ×1,1.
export const FEE_DIVISOR = 0.9;
// TikTok trả GPM / GMV của creator VN bằng USD. Tỷ giá quy đổi: chỉnh USD_VND khi cần.
export const USD_VND = Number(process.env.USD_VND) || 26_000;

// Chỉ đặt tên cho mã ngành chắc chắn; mã khác hiện "Ngành #id" (app chưa có quyền đọc danh mục sản phẩm).
export const CATEGORY: Record<string, string> = { '601450': 'Làm đẹp & Chăm sóc cá nhân', '700645': 'Sức khỏe', '600001': 'Đồ gia dụng' };

type KV = { key?: string; value?: string };
type Profile = {
  follower_gender?: KV[];
  follower_age?: KV[];
  follower_location?: KV[];
  content_gmv_distribution?: { content_type?: string; value?: string }[];
  category_gmv_distribution?: { category_id?: string; value?: string }[];
  avg_gmv_per_buyer_range?: { formatted_range?: string };
  gmv?: { amount?: string; currency?: string };
  ec_video_engagement_rate?: string;
  brand_collaboration_count?: number;
};

const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** "257,4K ₫-386,1K ₫" → [257400, 386100]; "1M₫+" → [1000000, null]. */
export function parseVndRange(s: string | null | undefined): [number | null, number | null] {
  if (!s) return [null, null];
  const one = (t: string) => {
    const m = t.replace(/\s|₫|đ/gi, '').match(/^([\d.,]+)(K|N|M|Tr|B|T|tỷ)?/i);
    if (!m) return null;
    const n = Number(m[1].replace(/\./g, '').replace(',', '.'));
    const unit = (m[2] ?? '').toLowerCase();
    const mult = unit === 'k' || unit === 'n' ? 1e3 : unit === 'm' || unit === 'tr' ? 1e6 : unit === 'b' || unit === 't' || unit === 'tỷ' ? 1e9 : 1;
    return Number.isFinite(n) ? Math.round(n * mult) : null;
  };
  const [a, b] = s.split(/-(?=\s*\d)/);
  return [one(a), b ? one(b) : null];
}

/** Chân dung follower và tỷ trọng GMV từ hồ sơ TikTok. Tỉ lệ trả về dạng 0..1. */
export function profileInsights(raw: unknown) {
  const p = (raw ?? {}) as Profile;
  const pick = (list: KV[] | undefined, key: string) => num(list?.find((x) => x.key?.toLowerCase() === key)?.value);
  const share = (t: string) => num(p.content_gmv_distribution?.find((x) => x.content_type === t)?.value);
  const [aovLow, aovHigh] = parseVndRange(p.avg_gmv_per_buyer_range?.formatted_range);
  return {
    male: pick(p.follower_gender, 'male'),
    female: pick(p.follower_gender, 'female'),
    age18_24: pick(p.follower_age, '18-24'),
    age25_34: pick(p.follower_age, '25-34'),
    // Tỉnh thành tính theo phần vạn (3077 = 30,77%), khác giới tính / tuổi (số thập phân).
    locations: (p.follower_location ?? []).slice(0, 3).map((l) => ({ name: titleCase(l.key ?? ''), share: (num(l.value) ?? 0) / 10_000 })),
    gmvVideo: share('video_gmv'),
    gmvLive: share('live_gmv'),
    gmvShowcase: share('showcase_gmv'),
    categories: (p.category_gmv_distribution ?? [])
      .filter((c) => c.category_id && c.category_id !== '-1')
      .slice(0, 3)
      .map((c) => ({ name: CATEGORY[c.category_id!] ?? `Ngành #${c.category_id}`, share: num(c.value) ?? 0 })),
    aovText: p.avg_gmv_per_buyer_range?.formatted_range ?? null,
    aovMid: aovLow && aovHigh ? Math.round((aovLow + aovHigh) / 2) : aovLow,
    gmvExactVnd: p.gmv?.amount && num(p.gmv.amount) != null ? Math.round(num(p.gmv.amount)! * (p.gmv.currency === 'USD' ? USD_VND : 1)) : null,
    engagement: num(p.ec_video_engagement_rate) == null ? null : num(p.ec_video_engagement_rate)! / 10_000,
    brandCount: p.brand_collaboration_count ?? null,
  };
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

export type KocStats = { kl: string | null; avgViews: number | null; gpmUsd: number | null; unitsSold: number | null };

// < KL6: view TB video 30 ngày. KL6–KL7 (Branding): TB top 5 video KHÔNG gắn giỏ, TikTok Shop API không có → nhập tay.
export function defaultViewTarget(k: KocStats) {
  return k.kl && /KL[67]/i.test(k.kl) ? null : k.avgViews;
}

/**
 * GMV Target = View Target × CTR × CR × AOV, với CTR = (GPM/1000) / (CR × AOV).
 * Thế vào thì CR và AOV triệt tiêu: GMV Target = View Target × GPM / 1000. CR, AOV chỉ dùng để hiện CTR.
 */
export function forecast(o: { viewTarget: number | null; gpmUsd: number | null; cr: number | null; aov: number | null; price: number | null }) {
  const gpm = o.gpmUsd == null ? null : o.gpmUsd * USD_VND;
  return {
    gpmVnd: gpm,
    gmvTarget: o.viewTarget != null && gpm != null ? Math.round((o.viewTarget * gpm) / 1000) : null,
    ctr: gpm != null && o.cr && o.aov ? gpm / 1000 / (o.cr * o.aov) : null,
    cpv: o.price != null && o.viewTarget ? o.price / o.viewTarget : null,
    fee: o.price == null ? null : Math.round(o.price / FEE_DIVISOR),
  };
}

export type BookingRow = {
  code: string; brand: string | null; store: string | null; pipeline: string | null; planMonth: string | null;
  airDate: Date | null; cost: number | null; linkAir: string | null; channel: string | null;
  extra: { product?: string | null; format?: string | null; kl?: string | null; views30?: string | null; gmv30?: string | null };
};

/** Booking trên Lark của các kênh (so khớp không phân biệt hoa thường), mới nhất trước. */
export async function bookingsOf(handles: string[]) {
  if (!handles.length) return new Map<string, BookingRow[]>();
  const rows = await db.$queryRaw<BookingRow[]>`
    select code, brand, store, pipeline, "planMonth", "airDate", cost, "linkAir", channel, extra
    from "Booking" where lower(channel) = any(${handles})
    order by coalesce("airDate", "planAirDate", "larkUpdatedAt") desc`;
  const out = new Map<string, BookingRow[]>();
  for (const r of rows) {
    const h = r.channel!.toLowerCase();
    out.set(h, [...(out.get(h) ?? []), r]);
  }
  return out;
}

/** Tóm tắt hợp tác với UpBase. priceType "Video" / "Phiên livestream" → giá booking gần nhất cùng hình thức. */
export function collabSummary(bookings: BookingRow[], priceType = 'Video') {
  const want = /live/i.test(priceType) ? /live/i : /video/i;
  const lastSame = bookings.find((b) => b.cost && want.test(b.extra?.format ?? ''));
  const best = bookings.reduce<BookingRow | null>((a, b) => ((num(b.extra?.gmv30) ?? -1) > (num(a?.extra?.gmv30) ?? -1) ? b : a), null);
  return {
    count: bookings.length,
    totalCost: bookings.reduce((s, b) => s + (b.cost ?? 0), 0),
    brands: [...new Set(bookings.map((b) => b.brand).filter(Boolean))] as string[],
    lastPrice: lastSame?.cost ?? bookings.find((b) => b.cost)?.cost ?? null,
    lastPriceNote: lastSame ? `${lastSame.brand ?? ''} ${lastSame.planMonth ?? ''}`.trim() : null,
    kl: bookings.find((b) => b.extra?.kl)?.extra.kl ?? null,
    best: best && num(best.extra?.gmv30) ? { code: best.code, brand: best.brand, gmv30: num(best.extra.gmv30)!, views30: num(best.extra.views30) } : null,
  };
}

const compactVnd = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
/** GMV TikTok để hiển thị: số chính xác lưu dạng "3.064 USD" → "~79,7 Tr ₫"; khoảng như "1M₫+" giữ nguyên. */
export function gmvLabel(s: string | null | undefined) {
  if (!s) return null;
  const m = s.match(/^([\d.,]+)\s*USD$/);
  return m ? `~${compactVnd.format(Number(m[1].replace(/[.,]/g, '')) * USD_VND)} ₫` : s;
}
