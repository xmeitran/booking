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
export type Source = { key: string; group: 'lark' | 'partner' | 'seller'; name: string; note: string; user?: string; date?: string; metrics: Metric[] };
export type SourceStats = { rows: number; creators: number; from: string | null; to: string | null; m: number[]; ours: { creators: number; m: number[] } };

const GMV: Metric = { field: 'gmv', agg: 'sum', label: 'GMV', money: true };
const ORDERS: Metric = { field: 'order_id', agg: 'count_distinct', label: 'Đơn' };
const QTY: Metric = { field: 'quantity', agg: 'sum', label: 'Sản phẩm bán' };
const ITEMS: Metric = { field: 'items', agg: 'sum', label: 'Sản phẩm bán' };

export const LARK: Source = {
  key: 'lark', group: 'lark', name: '3.2 List duyệt book', note: 'Mỗi dòng là một booking; số video do team điền trên Lark',
  metrics: [{ label: 'Booking' }, { label: 'Chi phí', money: true }, { label: 'View 30 ngày' }, { label: 'GMV 30 ngày', money: true }, { label: 'Đơn 30 ngày' }],
};
export const MARKET: Source = {
  key: 'marketplace', group: 'seller', name: 'Creator Marketplace (Booking Hub tự tra)', note: 'Hồ sơ 30 ngày của KOL Danh bạ, tra mỗi giờ bằng token shop của Trạm',
  metrics: [{ label: 'Follower' }, { label: 'View TB / video' }, { label: 'View TB / LIVE' }, { label: 'Sản phẩm bán 30 ngày' }],
};

// Bảng của Trạm dữ liệu. user = cột username creator, date = cột ngày (để biết dữ liệu phủ từ ngày nào tới ngày nào).
export const STATION: Source[] = [
  { key: 'cap_orders', group: 'partner', name: 'Đơn MCN (CAP)', note: 'Đơn của creator thuộc MCN', user: 'creator_username', date: 'day', metrics: [GMV, ORDERS, QTY] },
  { key: 'live_sessions', group: 'partner', name: 'Phiên live MCN', note: 'Phiên live của creator thuộc MCN', user: 'creator_username', date: 'day',
    metrics: [{ field: 'session_id', agg: 'count', label: 'Phiên live' }, GMV, ITEMS] },
  { key: 'tap_orders', group: 'partner', name: 'Đơn chiến dịch TAP', note: 'Đơn thuộc chiến dịch TAP của partner', user: 'creator_username', date: 'day', metrics: [GMV, ORDERS, QTY] },
  { key: 'tap_campaign_creators', group: 'partner', name: 'Creator nhận chiến dịch TAP', note: 'Creator đã nhận sản phẩm trong chiến dịch TAP', user: 'user_name', date: 'effective_start',
    metrics: [{ field: 'follower_num', agg: 'max', label: 'Follower (cao nhất)' }, { field: 'video_count', agg: 'sum', label: 'Video' }, { field: 'room_count', agg: 'sum', label: 'Phiên live' }, { field: 'paid_amount', agg: 'sum', label: 'Đã trả', money: true }] },
  { key: 'seller_creator_insights', group: 'partner', name: 'Hồ sơ creator MCN (30 ngày)', note: 'Creator MCN tra trên Creator Marketplace, chụp mỗi ngày', user: 'username', date: 'day',
    metrics: [{ field: 'follower_count', agg: 'max', label: 'Follower (cao nhất)' }, { field: 'avg_video_views', agg: 'max', label: 'View TB / video (cao nhất)' }, { field: 'units_sold', agg: 'max', label: 'Sản phẩm bán 30 ngày (cao nhất)' }] },
  { key: 'shop_creators', group: 'seller', name: 'Creator hợp tác với shop', note: 'Gộp đơn, video, LIVE theo creator của 8 shop', user: 'creator_username', date: 'day',
    metrics: [GMV, ITEMS, { field: 'video_views', agg: 'sum', label: 'Lượt xem video' }, { field: 'live_viewers', agg: 'sum', label: 'Người xem LIVE' }] },
  { key: 'seller_orders', group: 'seller', name: 'Đơn affiliate của shop', note: 'Mọi đơn affiliate, của mọi creator bán cho shop', user: 'creator_username', date: 'day',
    metrics: [GMV, ORDERS, QTY, { field: 'est_paid_commission', agg: 'sum', label: 'Hoa hồng ước tính', money: true }] },
  { key: 'shop_videos', group: 'seller', name: 'Video gắn sản phẩm shop', note: 'Hiệu quả từng video theo ngày', user: 'creator_username', date: 'day',
    metrics: [{ field: 'video_id', agg: 'count_distinct', label: 'Video' }, { field: 'views', agg: 'sum', label: 'Lượt xem' }, { field: 'attributed_gmv', agg: 'sum', label: 'GMV', money: true }, { field: 'items_sold', agg: 'sum', label: 'Sản phẩm bán' }] },
  { key: 'shop_lives', group: 'seller', name: 'Phiên LIVE bán sản phẩm shop', note: 'Số của trọn phiên', user: 'creator_username', date: 'day',
    metrics: [{ field: 'live_id', agg: 'count_distinct', label: 'Phiên' }, { field: 'viewers', agg: 'sum', label: 'Người xem' }, GMV, { field: 'items_sold', agg: 'sum', label: 'Sản phẩm bán' }] },
  { key: 'seller_samples', group: 'seller', name: 'Yêu cầu hàng mẫu', note: 'Creator xin mẫu sản phẩm của shop, mọi trạng thái', user: 'creator_username', date: 'first_seen_at',
    metrics: [{ field: 'application_id', agg: 'count', label: 'Yêu cầu mẫu' }] },
];

export const sourceOf = (key: string) => [LARK, MARKET, ...STATION].find((s) => s.key === key);

const BATCH = 500; // Trạm nhận tối đa 500 giá trị cho phép lọc "in"
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
  await db.$transaction([
    db.creatorMetric.deleteMany({ where: { source: s.key } }),
    db.creatorMetric.createMany({ data: mine.map((r) => ({ source: s.key, ...r })), skipDuplicates: true }),
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

export type TopRow = { handle: string; m: number[] };

/** Top creator của một nguồn theo chỉ số thứ `by`. onlyOurs: KOL Danh bạ, đọc từ bảng job đã lưu (hỏi Trạm theo lô mất ~1 phút). */
export async function topCreators(s: Source, onlyOurs: boolean, by: number, limit = 100): Promise<TopRow[]> {
  if (s.key === 'lark') {
    return db.$queryRaw<TopRow[]>`
      select * from (select lower(channel) handle, array[${LARK_COLS}] m from "Booking" where channel is not null and channel <> '' group by 1) t
      order by m[${by + 1}] desc limit ${limit}`;
  }
  if (s.key === 'marketplace') {
    const cols = ['followers', 'avgViews', 'avgLiveViews', 'unitsSold'] as const;
    const kocs = await db.koc.findMany({ where: { platform: 'TikTok', statsAt: { not: null } }, orderBy: { [cols[by]]: { sort: 'desc', nulls: 'last' } }, take: limit });
    return kocs.map((k) => ({ handle: k.handle, m: cols.map((c) => k[c] ?? 0) }));
  }
  if (onlyOurs) {
    const rows = await db.creatorMetric.findMany({ where: { source: s.key }, select: { handle: true, m: true } });
    return rows.sort((a, b) => b.m[by] - a.m[by]).slice(0, limit);
  }
  const user = s.user!;
  const r = await explore({
    dataset: s.key, groupBy: [{ field: user }], metrics: metricsOf(s), sort: [{ by: `m${by}`, dir: 'desc' }], limit,
    filters: [{ field: user, op: 'not_empty' }],
  });
  return r.rows.map((x: Record<string, unknown>) => ({ handle: String(x[user]), m: vals(x, 0, s.metrics.length) }));
}

/** Hiệu quả của một KOL ở từng bảng Trạm dữ liệu (hồ sơ KOC). */
export async function creatorSources(handle: string) {
  const rows = await db.creatorMetric.findMany({ where: { handle } });
  return STATION.flatMap((s) => {
    const r = rows.find((x) => x.source === s.key);
    return r ? [{ s, m: r.m, at: r.updatedAt }] : [];
  });
}
