// Tab Dữ liệu: mỗi nguồn (Lark Base, TikTok Partner Center, TikTok Seller Center) có bao nhiêu creator, bao nhiêu
// KOL trong Danh bạ có mặt, và số liệu hiệu quả của họ. Nguồn TikTok đọc qua Trạm dữ liệu (POST /api/explore);
// bảng lớn mất ~10 giây nên phần tổng chạy nền (cron mỗi 6 giờ hoặc nút Làm mới) rồi lưu ở SyncState 'data-sources'.
import { Prisma } from '@prisma/client';
import { station } from './creatorStats';
import { db } from './db';

// Chỉ dùng phép gộp cộng được qua các lô handle (mỗi creator chỉ nằm ở một lô): sum, count, count_distinct theo
// trường của riêng creator, max. Không dùng avg vì không gộp đúng được.
type Agg = 'sum' | 'count' | 'count_distinct' | 'max';
export type Metric = { label: string; money?: boolean; field?: string; agg?: Agg };
// shop: cột để tách hiệu quả creator theo shop / brand / sản phẩm. target = mã tài khoản, Trạm trả tên đọc được kèm theo.
export type Source = {
  key: string; group: 'lark' | 'partner' | 'seller'; name: string; note: string; user?: string; date?: string; metrics: Metric[];
  shop?: { field: string; label: string; target?: boolean };
};
export type ShopRow = { key: string; shop: string; m: number[] };
export type SourceStats = { rows: number; creators: number; from: string | null; to: string | null; m: number[]; ours: { creators: number; m: number[] } };

const GMV: Metric = { field: 'gmv', agg: 'sum', label: 'GMV', money: true };
const ORDERS: Metric = { field: 'order_id', agg: 'count_distinct', label: 'Đơn' };
const QTY: Metric = { field: 'quantity', agg: 'sum', label: 'Sản phẩm bán' };
const ITEMS: Metric = { field: 'items', agg: 'sum', label: 'Sản phẩm bán' };
const SHOP = { field: 'target', label: 'Shop', target: true }; // 8 shop seller trên Trạm

export const LARK: Source = {
  key: 'lark', group: 'lark', name: '3.2 List duyệt book', note: 'Mỗi dòng là một booking; số video do team điền trên Lark',
  metrics: [{ label: 'Booking' }, { label: 'Chi phí', money: true }, { label: 'View 30 ngày' }, { label: 'GMV 30 ngày', money: true }, { label: 'Đơn 30 ngày' }],
  shop: { field: 'brand', label: 'Brand' },
};
export const MARKET: Source = {
  key: 'marketplace', group: 'seller', name: 'Creator Marketplace (Booking Hub tự tra)', note: 'Hồ sơ 30 ngày của KOL Danh bạ, tra mỗi giờ bằng token shop của Trạm',
  metrics: [{ label: 'Follower' }, { label: 'View TB / video' }, { label: 'View TB / LIVE' }, { label: 'Sản phẩm bán 30 ngày' }],
};

// Bảng của Trạm dữ liệu. user = cột username creator, date = cột ngày (để biết dữ liệu phủ từ ngày nào tới ngày nào).
export const STATION: Source[] = [
  { key: 'cap_orders', group: 'partner', name: 'Đơn MCN (CAP)', note: 'Đơn của creator thuộc MCN, mọi shop trên sàn', user: 'creator_username', date: 'day', metrics: [GMV, ORDERS, QTY], shop: { field: 'shop_name', label: 'Shop' } },
  { key: 'live_sessions', group: 'partner', name: 'Phiên live MCN', note: 'Phiên live của creator thuộc MCN', user: 'creator_username', date: 'day',
    metrics: [{ field: 'session_id', agg: 'count', label: 'Phiên live' }, GMV, ITEMS] },
  { key: 'tap_orders', group: 'partner', name: 'Đơn chiến dịch TAP', note: 'Đơn thuộc chiến dịch TAP của partner', user: 'creator_username', date: 'day', metrics: [GMV, ORDERS, QTY], shop: { field: 'product_name', label: 'Sản phẩm' } },
  { key: 'tap_campaign_creators', group: 'partner', name: 'Creator nhận chiến dịch TAP', note: 'Creator đã nhận sản phẩm trong chiến dịch TAP', user: 'user_name', date: 'effective_start',
    metrics: [{ field: 'follower_num', agg: 'max', label: 'Follower (cao nhất)' }, { field: 'video_count', agg: 'sum', label: 'Video' }, { field: 'room_count', agg: 'sum', label: 'Phiên live' }, { field: 'paid_amount', agg: 'sum', label: 'Đã trả', money: true }] },
  { key: 'seller_creator_insights', group: 'partner', name: 'Hồ sơ creator MCN (30 ngày)', note: 'Creator MCN tra trên Creator Marketplace, chụp mỗi ngày', user: 'username', date: 'day',
    metrics: [{ field: 'follower_count', agg: 'max', label: 'Follower (cao nhất)' }, { field: 'avg_video_views', agg: 'max', label: 'View TB / video (cao nhất)' }, { field: 'units_sold', agg: 'max', label: 'Sản phẩm bán 30 ngày (cao nhất)' }] },
  { key: 'shop_creators', group: 'seller', name: 'Creator hợp tác với shop', note: 'Gộp đơn, video, LIVE theo creator của 8 shop', user: 'creator_username', date: 'day',
    metrics: [GMV, ITEMS, { field: 'video_views', agg: 'sum', label: 'Lượt xem video' }, { field: 'live_viewers', agg: 'sum', label: 'Người xem LIVE' }], shop: SHOP },
  { key: 'seller_orders', group: 'seller', name: 'Đơn affiliate của shop', note: 'Mọi đơn affiliate, của mọi creator bán cho shop', user: 'creator_username', date: 'day',
    metrics: [GMV, ORDERS, QTY, { field: 'est_paid_commission', agg: 'sum', label: 'Hoa hồng ước tính', money: true }], shop: SHOP },
  { key: 'shop_videos', group: 'seller', name: 'Video gắn sản phẩm shop', note: 'Hiệu quả từng video theo ngày', user: 'creator_username', date: 'day',
    metrics: [{ field: 'video_id', agg: 'count_distinct', label: 'Video' }, { field: 'views', agg: 'sum', label: 'Lượt xem' }, { field: 'attributed_gmv', agg: 'sum', label: 'GMV', money: true }, { field: 'items_sold', agg: 'sum', label: 'Sản phẩm bán' }], shop: SHOP },
  { key: 'shop_lives', group: 'seller', name: 'Phiên LIVE bán sản phẩm shop', note: 'Số của trọn phiên', user: 'creator_username', date: 'day',
    metrics: [{ field: 'live_id', agg: 'count_distinct', label: 'Phiên' }, { field: 'viewers', agg: 'sum', label: 'Người xem' }, GMV, { field: 'items_sold', agg: 'sum', label: 'Sản phẩm bán' }], shop: SHOP },
  { key: 'seller_samples', group: 'seller', name: 'Yêu cầu hàng mẫu', note: 'Creator xin mẫu sản phẩm của shop, mọi trạng thái', user: 'creator_username', date: 'first_seen_at',
    metrics: [{ field: 'application_id', agg: 'count', label: 'Yêu cầu mẫu' }], shop: SHOP },
];

export const sourceOf = (key: string) => [LARK, MARKET, ...STATION].find((s) => s.key === key);

const BATCH = 500; // Trạm nhận tối đa 500 giá trị cho phép lọc "in"
const PAGE = 1000; // Trạm trả tối đa 1000 dòng mỗi lần
const SHOPS_KEPT = 20; // ponytail: mỗi creator chỉ giữ 20 shop lớn nhất (creator MCN bán cho hàng trăm shop); cần đủ thì phân trang
const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
// Trạm trả 5xx khi đang bận (job khác chiếm kết nối DB): chờ 3 giây thử lại một lần. Chỉ đọc nên thử lại an toàn.
async function explore(body: object) {
  const call = () => station('/api/explore', { method: 'POST', body: JSON.stringify(body) });
  try {
    return await call();
  } catch (e) {
    if (!/HTTP 5\d\d/.test(String(e))) throw e;
    await new Promise((r) => setTimeout(r, 3000));
    return call();
  }
}
const metricsOf = (s: Source) => s.metrics.map(({ field, agg }) => ({ field, agg }));
const vals = (t: Record<string, unknown>, from: number, n: number) => Array.from({ length: n }, (_, i) => Number(t[`m${from + i}`] ?? 0));
export const mergeMetrics = (s: Source, a: number[], b: number[]) => a.map((v, i) => (s.metrics[i].agg === 'max' ? Math.max(v, b[i]) : v + b[i]));

type Labels = { target?: Record<string, string> };
const toShop = (s: Source, x: Record<string, unknown>, labels: Labels | undefined, from: number): ShopRow => {
  const key = x[s.shop!.field] == null ? '' : String(x[s.shop!.field]);
  return { key, shop: (s.shop!.target ? labels?.target?.[key] : null) ?? (key || '(trống)'), m: vals(x, from, s.metrics.length) };
};

/** Hiệu quả từng creator tách theo shop của nguồn, cho một danh sách handle. Key của Map là handle chữ thường. */
async function shopRows(s: Source, handles: string[]): Promise<Map<string, ShopRow[]>> {
  const out = new Map<string, ShopRow[]>();
  if (!s.shop || !handles.length) return out;
  if (s.key === 'lark') {
    const rows = await db.$queryRaw<{ h: string; key: string | null; m: number[] }[]>`
      select lower(channel) h, brand key, array[${LARK_COLS}] m from "Booking" where lower(channel) = any(${handles}) group by 1, 2 order by 3 desc`;
    for (const r of rows) out.set(r.h, [...(out.get(r.h) ?? []), { key: r.key ?? '', shop: r.key ?? '(trống)', m: r.m }].slice(0, SHOPS_KEPT));
    return out;
  }
  for (const part of chunks(handles, BATCH)) {
    for (let offset = 0; ; offset += PAGE) {
      const r = await explore({
        dataset: s.key, groupBy: [{ field: s.user }, { field: s.shop.field }], metrics: metricsOf(s),
        filters: [{ field: s.user, op: 'in', value: part }], sort: [{ by: 'm0', dir: 'desc' }], limit: PAGE, offset,
      });
      for (const x of r.rows as Record<string, unknown>[]) {
        const h = String(x[s.user!]).toLowerCase();
        const list = out.get(h) ?? [];
        if (list.length < SHOPS_KEPT) list.push(toShop(s, x, r.labels, 0));
        out.set(h, list);
      }
      if (r.rows.length < PAGE) break;
    }
  }
  return out;
}

export const ourHandles = async () => (await db.koc.findMany({ where: { platform: 'TikTok' }, select: { handle: true } })).map((k) => k.handle);

async function stationStats(s: Source, handles: string[]): Promise<SourceStats> {
  const user = s.user!;
  const t = (await explore({
    dataset: s.key, limit: 1,
    metrics: [{ field: '*', agg: 'count' }, { field: user, agg: 'count_distinct' }, { field: s.date, agg: 'min' }, { field: s.date, agg: 'max' }, ...metricsOf(s)],
  })).totals;
  // Số của từng KOL Danh bạ: nhóm theo creator, lọc theo lô 500 handle (một lô trả đủ, vì mỗi handle tối đa một dòng).
  const mine: TopRow[] = [];
  for (const part of chunks(handles, BATCH)) {
    const r = await explore({ dataset: s.key, groupBy: [{ field: user }], metrics: metricsOf(s), filters: [{ field: user, op: 'in', value: part }], limit: BATCH });
    mine.push(...r.rows.map((x: Record<string, unknown>) => ({ handle: String(x[user]).toLowerCase(), m: vals(x, 0, s.metrics.length) })));
  }
  const shops = await shopRows(s, mine.map((r) => r.handle));
  await db.$transaction([
    db.creatorMetric.deleteMany({ where: { source: s.key } }),
    db.creatorMetric.createMany({ data: mine.map((r) => ({ source: s.key, ...r, shops: shops.get(r.handle) })), skipDuplicates: true }),
  ]);
  const ours = { creators: mine.length, m: mine.reduce((acc, r) => mergeMetrics(s, acc, r.m), s.metrics.map(() => 0)) };
  return { rows: Number(t.m0), creators: Number(t.m1), from: t.m2 ?? null, to: t.m3 ?? null, m: vals(t, 4, s.metrics.length), ours };
}

/** Chạy nền: tổng từng bảng của Trạm + phần của KOL Danh bạ. Tuần tự để không dồn tải lên Trạm (~1–2 phút). */
export async function refreshDataSources() {
  const handles = await ourHandles();
  const data: Record<string, SourceStats | { error: string }> = {};
  for (const s of STATION) {
    try {
      data[s.key] = await stationStats(s, handles);
    } catch (e) {
      data[s.key] = { error: e instanceof Error ? e.message : String(e) };
    }
  }
  const failed = Object.values(data).filter((d) => 'error' in d).length;
  await db.syncState.update({ where: { id: 'data-sources' }, data: { data } });
  return `${STATION.length - failed}/${STATION.length} bảng · đối chiếu ${handles.length} KOL Danh bạ${failed ? ` · ${failed} lỗi` : ''}`;
}

// Số trong Booking.extra là chuỗi; ô gõ tay có thể lẫn chữ nên chỉ ép kiểu khi đúng dạng số.
export const extraNum = (k: string) => Prisma.raw(`case when extra->>'${k}' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (extra->>'${k}')::float end`);
const LARK_COLS = Prisma.sql`count(*)::int, coalesce(sum(cost), 0)::float, coalesce(sum(${extraNum('views30')}), 0)::float, coalesce(sum(${extraNum('gmv30')}), 0)::float, coalesce(sum(${extraNum('orders30')}), 0)::float`;

export async function larkStats(): Promise<SourceStats> {
  const [r] = await db.$queryRaw<{ creators: number; from: Date | null; to: Date | null; m: number[] }[]>`
    select count(distinct lower(channel))::int creators, min(coalesce("airDate", "planAirDate")) "from", max(coalesce("airDate", "planAirDate")) "to",
      array[${LARK_COLS}] m
    from "Booking"`;
  const ours = await db.koc.count({ where: { platform: 'TikTok', bookingCount: { gt: 0 } } });
  // Mọi kênh trong booking đều tự vào Danh bạ, nên hiệu quả "KOL Danh bạ" chính là toàn bảng.
  return { rows: r.m[0], creators: r.creators, from: r.from?.toISOString() ?? null, to: r.to?.toISOString() ?? null, m: r.m, ours: { creators: ours, m: r.m } };
}

export async function marketStats(): Promise<SourceStats & { checked: number }> {
  const where = { platform: 'TikTok', statsAt: { not: null } };
  const [checked, a, range] = await Promise.all([
    db.koc.count({ where: { platform: 'TikTok', ttsCheckedAt: { not: null } } }),
    db.koc.aggregate({ where, _count: true, _max: { followers: true, avgViews: true, avgLiveViews: true }, _sum: { unitsSold: true } }),
    db.koc.aggregate({ where, _min: { statsAt: true }, _max: { statsAt: true } }),
  ]);
  const m = [a._max.followers ?? 0, a._max.avgViews ?? 0, a._max.avgLiveViews ?? 0, a._sum.unitsSold ?? 0];
  return { checked, rows: a._count, creators: a._count, from: range._min.statsAt?.toISOString() ?? null, to: range._max.statsAt?.toISOString() ?? null, m, ours: { creators: a._count, m } };
}

export type TopRow = { handle: string; m: number[]; shops?: ShopRow[] };

/**
 * Top creator của một nguồn theo chỉ số thứ `by`, kèm hiệu quả theo từng shop. onlyOurs: KOL Danh bạ, đọc từ bảng job
 * đã lưu (hỏi Trạm theo lô mất ~1 phút). shop: chỉ tính phần của một shop / brand.
 */
export async function topCreators(s: Source, onlyOurs: boolean, by: number, limit = 100, shop?: string): Promise<TopRow[]> {
  const sortBy = (rows: TopRow[]) => rows.sort((a, b) => b.m[by] - a.m[by]).slice(0, limit);
  if (s.key === 'marketplace') {
    const cols = ['followers', 'avgViews', 'avgLiveViews', 'unitsSold'] as const;
    const kocs = await db.koc.findMany({ where: { platform: 'TikTok', statsAt: { not: null } }, orderBy: { [cols[by]]: { sort: 'desc', nulls: 'last' } }, take: limit });
    return kocs.map((k) => ({ handle: k.handle, m: cols.map((c) => k[c] ?? 0) }));
  }
  let rows: TopRow[];
  if (s.key === 'lark') {
    rows = await db.$queryRaw<TopRow[]>`
      select * from (select lower(channel) handle, array[${LARK_COLS}] m from "Booking"
        where channel is not null and channel <> '' ${shop !== undefined ? Prisma.sql`and brand is not distinct from ${shop || null}` : Prisma.empty} group by 1) t
      order by m[${by + 1}] desc limit ${limit}`;
  } else if (onlyOurs) {
    const saved = await db.creatorMetric.findMany({ where: { source: s.key }, select: { handle: true, m: true, shops: true } });
    const all = saved.map((r) => ({ handle: r.handle, m: r.m, shops: (r.shops ?? []) as ShopRow[] }));
    // Lọc một shop: lấy phần số của shop đó trong danh sách đã lưu (20 shop lớn nhất mỗi KOL).
    return sortBy(shop === undefined ? all : all.flatMap((r) => r.shops.filter((x) => x.key === shop).map((x) => ({ ...r, m: x.m }))));
  } else {
    const user = s.user!;
    const r = await explore({
      dataset: s.key, groupBy: [{ field: user }], metrics: metricsOf(s), sort: [{ by: `m${by}`, dir: 'desc' }], limit,
      filters: [{ field: user, op: 'not_empty' }, ...(shop !== undefined && s.shop ? [{ field: s.shop.field, op: 'eq', value: shop }] : [])],
    });
    rows = r.rows.map((x: Record<string, unknown>) => ({ handle: String(x[user]), m: vals(x, 0, s.metrics.length) }));
  }
  const shops = await shopRows(s, rows.map((r) => r.handle));
  return rows.map((r) => ({ ...r, shops: shops.get(r.handle.toLowerCase()) }));
}

/** Hiệu quả theo từng shop / brand của nguồn: mỗi shop bao nhiêu creator và số liệu. */
export async function byShop(s: Source, by: number, limit = 300): Promise<{ rows: (ShopRow & { creators: number })[]; total: number }> {
  if (!s.shop) return { rows: [], total: 0 };
  if (s.key === 'lark') {
    const rows = await db.$queryRaw<{ key: string | null; creators: number; m: number[] }[]>`
      select * from (select brand key, count(distinct lower(channel))::int creators, array[${LARK_COLS}] m from "Booking" group by 1) t
      order by m[${by + 1}] desc limit ${limit}`;
    return { rows: rows.map((r) => ({ key: r.key ?? '', shop: r.key ?? '(trống)', creators: r.creators, m: r.m })), total: rows.length };
  }
  const r = await explore({
    dataset: s.key, groupBy: [{ field: s.shop.field }], metrics: [{ field: s.user, agg: 'count_distinct' }, ...metricsOf(s)],
    sort: [{ by: `m${by + 1}`, dir: 'desc' }], limit,
  });
  return { rows: r.rows.map((x: Record<string, unknown>) => ({ ...toShop(s, x, r.labels, 1), creators: Number(x.m0) })), total: Number(r.total) };
}

/** Hiệu quả của một KOL ở từng bảng Trạm dữ liệu, kèm từng shop (hồ sơ KOC). */
export async function creatorSources(handle: string) {
  const rows = await db.creatorMetric.findMany({ where: { handle } });
  return STATION.flatMap((s) => {
    const r = rows.find((x) => x.source === s.key);
    return r ? [{ s, m: r.m, shops: (r.shops ?? []) as ShopRow[], at: r.updatedAt }] : [];
  });
}
