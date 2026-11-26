// Tab Dữ liệu: mỗi nguồn có bao nhiêu creator, bao nhiêu KOL trong Danh bạ có mặt, và số liệu hiệu quả của họ.
// Nguồn TikTok đọc từ kho dữ liệu UpBase (ClickHouse qua Metabase, src/lib/warehouse/query.ts): đơn affiliate, video,
// phiên LIVE của các shop UpBase quản lý, và hồ sơ creator (bảng WarehouseCreator, đồng bộ mỗi sáng). Bảng video ~42 triệu
// dòng (~30 giây một lượt gộp) nên job data-sources (6 giờ / lần hoặc nút Làm mới) gộp sẵn mọi creator × shop vào
// CreatorMetric (mọi creator, không chỉ Danh bạ) và SourceCache (theo shop, top creator từng shop); trang chỉ đọc DB.
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { configured } from '../integrations';
import { warehouseQuery } from '../warehouse/query';

// agg 'max': khi gộp nhiều shop / nhiều creator thì lấy số lớn nhất thay vì cộng (follower, view trung bình...).
export type Metric = { label: string; hint?: string; money?: boolean; agg?: 'max' }; // hint: cách tính, hiện cho người xem
// Bảng trong kho: table (upbase_prod), user = cột username creator, date = cột ngày, m = biểu thức gộp theo thứ tự metrics.
// parts: chia truy vấn theo creator để mỗi phần chạy dưới ~60 giây (proxy trước Metabase trả 504 nếu lâu hơn) và giữ bộ nhớ thấp.
type Wh = { table: string; user: string; date: string; where?: string; m: string[]; parts?: number };
// shop: tách hiệu quả creator theo shop / brand. field chỉ dùng cho Lark (cột brand của Booking).
export type Source = {
  key: string; group: 'lark' | 'seller'; name: string; note: string; metrics: Metric[]; from?: string[];
  shop?: { label: string; field?: string }; wh?: Wh;
};
export type ShopRow = { key: string; shop: string; m: number[] };
// lastError: lượt tổng hợp gần nhất lỗi, đang giữ số của lượt thành công trước.
export type SourceStats = { rows: number; creators: number; from: string | null; to: string | null; m: number[]; ours: { creators: number; m: number[] }; lastError?: string };
export type TopRow = { handle: string; m: number[]; shops?: ShopRow[] };

// Số lấy từ đâu (chỉ ghi tên nơi), ai tạo ra số, bao lâu cập nhật: hiện ở tab Dữ liệu và trang creator để người xem tin số.
export const ORIGIN = {
  lark: { name: 'Lark Base', kind: 'Team tự điền', schedule: 'mỗi giờ' },
  seller: { name: 'Kho UpBase · TikTok Seller Center', kind: 'Số TikTok trả về', schedule: '6 giờ / lần' },
  marketplace: { name: 'Kho UpBase · hồ sơ creator', kind: 'Số TikTok trả về', schedule: 'mỗi sáng 9:30' },
} as const;
export const originOf = (s: Source) => ORIGIN[s.key === 'marketplace' ? 'marketplace' : s.group];
/** Nơi lấy số của một bảng; nhiều nơi thì ghi đủ. */
export const placesOf = (s: Source) => (s.from ?? [originOf(s).name]).join(', ');

export const LARK: Source = {
  key: 'lark', group: 'lark', name: '3.2 List duyệt book', note: 'Mỗi dòng là một booking; số video do team điền trên Lark',
  metrics: [
    { label: 'Booking', hint: 'Số dòng booking' }, { label: 'Chi phí', money: true, hint: 'Cột chi phí booking trên Lark' },
    { label: 'View 30 ngày', hint: 'Team điền trên Lark (cột 🌸 Views 30 ngày), không phải số TikTok trả' },
    { label: 'GMV 30 ngày', money: true, hint: 'Team điền trên Lark (cột 🌸 GMV 30 ngày)' }, { label: 'Đơn 30 ngày', hint: 'Team điền trên Lark (cột 🌸 Số đơn hàng 30 ngày)' },
  ],
  shop: { field: 'brand', label: 'Brand' },
};
const MARKET_COLS = ['followers', 'medianViews', 'ecViews', 'gmv', 'unitsSold'] as const;
export const MARKET: Source = {
  key: 'marketplace', group: 'seller', name: 'Hồ sơ creator TikTok', note: 'Hồ sơ 30 ngày của ~62 nghìn creator TikTok trong kho, mọi shop trên sàn',
  metrics: [
    { label: 'Follower', agg: 'max', hint: 'Số follower lúc kho chụp hồ sơ' },
    { label: 'View trung vị', agg: 'max', hint: 'Trung vị lượt xem mọi video của kênh' },
    { label: 'View TB / video bán hàng', agg: 'max', hint: 'Lượt xem trung bình video gắn sản phẩm, 30 ngày' },
    { label: 'GMV 30 ngày', money: true, hint: 'GMV affiliate 30 ngày trên toàn sàn; creator ẩn GMV thì lấy giữa khoảng TikTok trả' },
    { label: 'Sản phẩm bán 30 ngày', hint: 'Mọi shop trên TikTok Shop, không riêng shop UpBase' },
  ],
};

const GMV_HINT = 'Giá × số lượng, tính cả đơn sau đó hoàn / huỷ / không đủ điều kiện hoa hồng';
// Kho UpBase: bảng TikTok Seller Center của các shop UpBase quản lý (cột store_id). Creator khớp Danh bạ theo username.
export const WAREHOUSE: Source[] = [
  {
    key: 'aff_orders', group: 'seller', name: 'Đơn affiliate của shop', note: 'Mọi đơn affiliate creator bán cho shop UpBase (từ video, LIVE, showcase, link)',
    metrics: [
      { label: 'GMV', money: true, hint: GMV_HINT }, { label: 'Đơn', hint: 'Số mã đơn khác nhau' }, { label: 'Sản phẩm bán', hint: 'Tổng số lượng trong các đơn' },
      { label: 'Hoa hồng ước tính', money: true, hint: 'Hoa hồng chuẩn + hoa hồng Shop Ads ước tính lúc đặt đơn; có thể đổi khi quyết toán' },
    ],
    shop: { label: 'Shop' },
    wh: {
      table: 'report_public_tiktok_affiliate_order', user: 'creator_username', date: 't.created_at', parts: 2,
      m: ['sum(toFloat64(t.price) * t.sale_quantity)', 'uniqExact(t.order_id)', 'sum(t.sale_quantity)',
        'sum(toFloat64(ifNull(t.est_std_commission_amount, 0)) + toFloat64(ifNull(t.est_shop_ads_commission_payment_amount, 0)))'],
    },
  },
  {
    key: 'videos', group: 'seller', name: 'Video gắn sản phẩm shop', note: 'Video của creator affiliate gắn sản phẩm shop UpBase, số theo từng ngày',
    metrics: [
      { label: 'Video', hint: 'Số video khác nhau gắn sản phẩm của shop' }, { label: 'Lượt xem', hint: 'Cộng lượt xem từng ngày của các video' },
      { label: 'GMV', money: true, hint: 'GMV trực tiếp + gián tiếp TikTok tính cho video' }, { label: 'Sản phẩm bán', hint: 'Sản phẩm bán trực tiếp + gián tiếp từ video' },
    ],
    shop: { label: 'Shop' },
    wh: {
      // ponytail: ~42 triệu dòng, quét FINAL ~25 giây mỗi phần dù chia bao nhiêu; bảng lớn gấp đôi thì lọc theo khoảng ngày gần đây.
      table: 'report_public_tiktok_video_performance', user: 'creator_name', date: 't.report_date', where: "t.channel_type = 'AFFILIATE_ACCOUNTS'", parts: 3,
      // video_attributed_items_sold trong kho trống: cộng bán trực tiếp + gián tiếp cho khớp GMV attributed.
      m: ['uniqExact(t.video_id)', 'sum(t.video_views)', 'sum(toFloat64(t.video_attributed_gmv))', 'sum(ifNull(t.video_items_sold, 0) + ifNull(t.video_indirect_items_sold, 0))'],
    },
  },
  {
    key: 'lives', group: 'seller', name: 'Phiên LIVE bán sản phẩm shop', note: 'Phiên LIVE affiliate trên TikTok bán sản phẩm shop UpBase',
    metrics: [
      { label: 'Phiên', hint: 'Số phiên LIVE khác nhau' }, { label: 'Người xem', hint: 'Cộng người xem từng dòng (ngày) của các phiên' },
      { label: 'GMV', money: true, hint: 'GMV của phiên cho sản phẩm shop' }, { label: 'Đơn', hint: 'Số đơn của phiên' },
    ],
    shop: { label: 'Shop' },
    wh: {
      table: 'report_public_report_live_koc_daily', user: 'creator_handle', date: 't.report_date', where: "t.type = 'live_affiliate' AND t.connector_channel_code = 'tiktok'",
      m: ['uniqExact(t.id_live_koc)', 'sum(toFloat64(t.live_koc_view))', 'sum(toFloat64(t.gmv_live_koc))', 'sum(toFloat64(t.live_koc_order))'],
    },
  },
];

export const sourceOf = (key: string) => [LARK, MARKET, ...WAREHOUSE].find((s) => s.key === key);

const TOP = 200; // top creator mỗi shop tính sẵn
const SHOPS_KEPT = 20; // mỗi creator giữ 20 shop lớn nhất
const METABASE_MAX = 1_048_575; // Metabase cắt kết quả export ở số dòng này
const zeros = (s: Source) => s.metrics.map(() => 0);
export const mergeMetrics = (s: Source, a: number[], b: number[]) => a.map((v, i) => (s.metrics[i].agg === 'max' ? Math.max(v, b[i]) : v + b[i]));

// Tên shop: tên trên sàn, kèm tên brand trên Lark khi khác.
const STORE = `(SELECT id, any(concat(name, if(lark_brand_name != '' AND lark_brand_name != name, concat(' · ', lark_brand_name), ''))) AS label
  FROM dbt_prod.ecom_dim_store GROUP BY id)`;
/** Gộp theo `group` (creator × shop, hoặc shop của một creator): số dòng gốc, khoảng ngày, các chỉ số. */
const aggSql = (w: Wh, n: number, group: string, filter: string) => `
SELECT ${group === 'u, k' ? 'lower(t.' + w.user + ') AS u, ' : ''}toString(t.store_id) AS k, any(s.label) AS shop, count() AS n, toString(min(${w.date})) AS d0, toString(max(${w.date})) AS d1,
       ${w.m.slice(0, n).map((x, i) => `toFloat64(${x}) AS m${i}`).join(', ')}
FROM upbase_prod.${w.table} AS t FINAL LEFT JOIN ${STORE} AS s ON s.id = t.store_id
WHERE t._peerdb_is_deleted = 0 AND t.${w.user} != ''${w.where ? ` AND ${w.where}` : ''}${filter}
GROUP BY ${group}`;
const pairsSql = (w: Wh, n: number, part: number) => aggSql(w, n, 'u, k', w.parts ? ` AND cityHash64(lower(t.${w.user})) % ${w.parts} = ${part}` : '');
// Username TikTok chỉ gồm chữ thường, số, "." và "_": kiểm tra rồi mới ghép vào SQL.
const userIs = (w: Wh, handle: string) => {
  if (!/^[a-z0-9._]{1,64}$/.test(handle)) throw new Error('Username không hợp lệ');
  return ` AND lower(t.${w.user}) = '${handle}'`;
};

export const ourHandles = async () => (await db.koc.findMany({ where: { platform: 'TikTok' }, select: { handle: true } })).map((k) => k.handle.toLowerCase());

/**
 * Gộp một bảng kho: lưu mọi creator (CreatorMetric), danh sách shop và top creator từng shop (SourceCache).
 * Mỗi phần (parts) là một nhóm creator riêng nên ghi xong phần nào giải phóng phần đó: bộ nhớ ~1/parts (server dùng chung 8 GB).
 * Trong lúc chạy trang có thể thấy số cũ lẫn mới; creator không còn trong kho bị xoá cuối lượt.
 */
async function refreshSource(s: Source, ours: Set<string>): Promise<SourceStats> {
  const started = new Date();
  const n = s.metrics.length;
  const byM0 = (a: { m: number[] }, b: { m: number[] }) => b.m[0] - a.m[0];
  const shops = new Map<string, ShopRow & { creators: number; top: TopRow[] }>();
  const all = { creators: 0, m: zeros(s) }, mine = { creators: 0, m: zeros(s) };
  let rows = 0;
  let from: string | null = null, to: string | null = null;
  for (let part = 0; part < (s.wh!.parts ?? 1); part++) {
    const creators = new Map<string, { m: number[]; shops: ShopRow[] }>();
    const fresh: { key: string; handle: string; m: number[] }[] = [];
    // Proxy trước Metabase trả 504 khi kho bận (> ~60 giây). Chưa nhận dòng nào thì chờ 60 giây chạy lại phần đó, tối đa 3 lần.
    for (let attempt = 1; ; attempt++) {
      try {
        for await (const r of warehouseQuery(pairsSql(s.wh!, n, part))) {
          const m = Array.from({ length: n }, (_, i) => Number(r[`m${i}`] ?? 0));
          const h = String(r.u), key = String(r.k), shop = String(r.shop || `Shop #${key}`);
          const c = creators.get(h) ?? { m: zeros(s), shops: [] };
          c.m = mergeMetrics(s, c.m, m);
          c.shops.push({ key, shop, m });
          creators.set(h, c);
          const sh = shops.get(key) ?? { key, shop, creators: 0, m: zeros(s), top: [] };
          sh.creators++;
          sh.m = mergeMetrics(s, sh.m, m);
          shops.set(key, sh);
          fresh.push({ key, handle: h, m });
          rows += Number(r.n);
          if (r.d0 && (!from || String(r.d0) < from)) from = String(r.d0);
          if (r.d1 && (!to || String(r.d1) > to)) to = String(r.d1);
        }
        break;
      } catch (e) {
        if (fresh.length || attempt >= 3 || !/504|Gateway|time-?out/i.test(String(e))) throw e;
        await new Promise((r) => setTimeout(r, 60_000));
      }
    }
    if (fresh.length >= METABASE_MAX) throw new Error(`Bảng ${s.name} vượt ${METABASE_MAX.toLocaleString('vi-VN')} dòng creator × shop một lượt (giới hạn Metabase): tăng parts`);
    for (const c of creators.values()) c.shops = c.shops.sort(byM0).slice(0, SHOPS_KEPT);
    for (const f of fresh) shops.get(f.key)!.top.push({ handle: f.handle, m: f.m, shops: creators.get(f.handle)!.shops });
    for (const sh of shops.values()) sh.top = sh.top.sort(byM0).slice(0, TOP);
    const list = [...creators].map(([handle, c]) => ({ handle, m: c.m, shops: c.shops }));
    for (let i = 0; i < list.length; i += 5000) {
      await db.$executeRaw`
        insert into "CreatorMetric" (source, handle, m, shops, "updatedAt")
        select ${s.key}, x.handle, x.m, x.shops, now() from jsonb_to_recordset(${JSON.stringify(list.slice(i, i + 5000))}::jsonb) as x(handle text, m float8[], shops jsonb)
        on conflict (source, handle) do update set m = excluded.m, shops = excluded.shops, "updatedAt" = excluded."updatedAt"`;
    }
    for (const c of list) {
      all.creators++;
      all.m = mergeMetrics(s, all.m, c.m);
      if (ours.has(c.handle)) { mine.creators++; mine.m = mergeMetrics(s, mine.m, c.m); }
    }
  }
  const caches = [
    { kind: 'shops', data: { rows: [...shops.values()].map(({ top: _, ...x }) => x).sort(byM0), total: shops.size } },
    ...[...shops.values()].map((sh) => ({ kind: `shop:${sh.key}`, data: sh.top })),
  ];
  await db.creatorMetric.deleteMany({ where: { source: s.key, updatedAt: { lt: started } } });
  await db.$transaction([
    db.sourceCache.deleteMany({ where: { source: s.key } }),
    db.sourceCache.createMany({ data: caches.map((c) => ({ source: s.key, kind: c.kind, data: c.data as unknown as Prisma.InputJsonValue })) }),
  ]);
  return { rows, creators: all.creators, from, to, m: all.m, ours: mine };
}

/** Chạy nền: gộp từng bảng kho. Tuần tự để không dồn tải lên kho; một bảng lỗi không chặn bảng khác. */
export async function refreshDataSources() {
  if (!(await configured('warehouse'))) return 'Chưa cấu hình kho dữ liệu (Phân quyền → Tích hợp), bỏ qua.';
  const ours = new Set(await ourHandles());
  const prev = ((await db.syncState.findUnique({ where: { id: 'data-sources' } }))?.data ?? {}) as Record<string, SourceStats | { error: string }>;
  const data: Record<string, SourceStats | { error: string }> = {};
  for (const s of WAREHOUSE) {
    try {
      data[s.key] = await refreshSource(s, ours);
    } catch (e) {
      // Lỗi (thường là kho bận, Metabase cắt sau 60 giây): bảng vẫn còn số lượt trước thì giữ, chỉ ghi chú lỗi.
      const msg = (e instanceof Error ? e.message : String(e)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      const p = prev[s.key];
      data[s.key] = p && !('error' in p) ? { ...p, lastError: `${new Date().toISOString()} ${msg}` } : { error: msg };
    }
  }
  await db.syncState.update({ where: { id: 'data-sources' }, data: { data } });
  return WAREHOUSE.map((s) => {
    const d = data[s.key];
    return 'error' in d ? `${s.name}: lỗi` : `${s.name}: ${d.creators.toLocaleString('vi-VN')} creator${d.lastError ? ' (lượt này lỗi, giữ số lần trước)' : ''}`;
  }).join(' · ');
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

const MARKET_M = Prisma.sql`array[coalesce(max(w.followers), 0), coalesce(max(w."medianViews"), 0), coalesce(max(w."ecViews"), 0), coalesce(sum(w.gmv), 0), coalesce(sum(w."unitsSold"), 0)]::float[]`;
const IN_BOOK = Prisma.sql`exists (select 1 from "Koc" k where k.platform = 'TikTok' and lower(k.handle) = w.handle)`;

export async function marketStats(): Promise<SourceStats> {
  const [[all], [mine]] = await Promise.all([
    db.$queryRaw<{ n: number; from: Date | null; to: Date | null; m: number[] }[]>`
      select count(*)::int n, min(coalesce(w."sourceAt", w."syncedAt")) "from", max(coalesce(w."sourceAt", w."syncedAt")) "to", ${MARKET_M} m
      from "WarehouseCreator" w where w.platform = 'TikTok'`,
    db.$queryRaw<{ n: number; m: number[] }[]>`select count(*)::int n, ${MARKET_M} m from "WarehouseCreator" w where w.platform = 'TikTok' and ${IN_BOOK}`,
  ]);
  return { rows: all.n, creators: all.n, from: all.from?.toISOString() ?? null, to: all.to?.toISOString() ?? null, m: all.m, ours: { creators: mine.n, m: mine.m } };
}

type Ranked = { rows: TopRow[]; at: Date | null };

/** Top creator của một nguồn theo chỉ số thứ `by`, kèm hiệu quả theo từng shop. onlyOurs: KOL Danh bạ. shop: chỉ phần một shop. */
export async function topCreators(s: Source, onlyOurs: boolean, by: number, limit = 100, shop?: string): Promise<Ranked> {
  if (s.key === 'marketplace') {
    const col = Prisma.raw(`w."${MARKET_COLS[by]}"`);
    const rows = await db.$queryRaw<{ handle: string; m: number[] }[]>`
      select w.handle, array[${Prisma.join(MARKET_COLS.map((c) => Prisma.raw(`coalesce(w."${c}", 0)`)))}]::float[] m
      from "WarehouseCreator" w where w.platform = 'TikTok' ${onlyOurs ? Prisma.sql`and ${IN_BOOK}` : Prisma.empty}
      order by ${col} desc nulls last limit ${limit}`;
    return { rows, at: null };
  }
  if (s.key === 'lark') {
    const rows = await db.$queryRaw<TopRow[]>`
      select * from (select lower(channel) handle, array[${LARK_COLS}] m from "Booking"
        where channel is not null and channel <> '' ${shop !== undefined ? Prisma.sql`and brand is not distinct from ${shop || null}` : Prisma.empty} group by 1) t
      order by m[${by + 1}] desc limit ${limit}`;
    const shops = await larkShops(rows.map((r) => r.handle));
    return { rows: rows.map((r) => ({ ...r, shops: shops.get(r.handle) })), at: null };
  }
  const ours = onlyOurs ? Prisma.sql`and exists (select 1 from "Koc" k where k.platform = 'TikTok' and lower(k.handle) = c.handle)` : Prisma.empty;
  if (shop !== undefined) {
    // Phần số của một shop: KOL Danh bạ lấy từ danh sách shop đã lưu của từng KOL; mọi creator đọc top 200 tính sẵn của shop.
    if (onlyOurs) {
      const rows = await db.$queryRaw<(TopRow & { at: Date })[]>`
        select c.handle, array(select jsonb_array_elements_text(e->'m')::float) m, c.shops, c."updatedAt" at
        from "CreatorMetric" c, jsonb_array_elements(c.shops) e
        where c.source = ${s.key} and e->>'key' = ${shop} ${ours}
        order by (e->'m'->>${by}::int)::float desc limit ${limit}`;
      return { rows, at: rows[0]?.at ?? null };
    }
    const c = await db.sourceCache.findUnique({ where: { source_kind: { source: s.key, kind: `shop:${shop}` } } });
    return { rows: c ? (c.data as unknown as TopRow[]).sort((a, b) => b.m[by] - a.m[by]).slice(0, limit) : [], at: c?.updatedAt ?? null };
  }
  const rows = await db.$queryRaw<(TopRow & { at: Date })[]>`
    select c.handle, c.m, c.shops, c."updatedAt" at from "CreatorMetric" c where c.source = ${s.key} ${ours}
    order by c.m[${by + 1}] desc limit ${limit}`;
  return { rows, at: rows[0]?.at ?? null };
}

async function larkShops(handles: string[]): Promise<Map<string, ShopRow[]>> {
  const out = new Map<string, ShopRow[]>();
  if (!handles.length) return out;
  const rows = await db.$queryRaw<{ h: string; key: string | null; m: number[] }[]>`
    select lower(channel) h, brand key, array[${LARK_COLS}] m from "Booking" where lower(channel) = any(${handles}) group by 1, 2 order by 3 desc`;
  for (const r of rows) out.set(r.h, [...(out.get(r.h) ?? []), { key: r.key ?? '', shop: r.key ?? '(trống)', m: r.m }].slice(0, SHOPS_KEPT));
  return out;
}

type ShopList = { rows: (ShopRow & { creators: number })[]; total: number };

/** Hiệu quả theo từng shop / brand của nguồn: mỗi shop bao nhiêu creator và số liệu. Nguồn kho đọc bản tính sẵn. */
export async function byShop(s: Source, by: number, limit = 300): Promise<ShopList & { at: Date | null }> {
  if (!s.shop) return { rows: [], total: 0, at: null };
  if (s.key === 'lark') {
    const rows = await db.$queryRaw<{ key: string | null; creators: number; m: number[] }[]>`
      select * from (select brand key, count(distinct lower(channel))::int creators, array[${LARK_COLS}] m from "Booking" group by 1) t
      order by m[${by + 1}] desc limit ${limit}`;
    return { rows: rows.map((r) => ({ key: r.key ?? '', shop: r.key ?? '(trống)', creators: r.creators, m: r.m })), total: rows.length, at: null };
  }
  const c = await db.sourceCache.findUnique({ where: { source_kind: { source: s.key, kind: 'shops' } } });
  if (!c) return { rows: [], total: 0, at: null };
  const d = c.data as unknown as ShopList;
  return { rows: d.rows.sort((a, b) => b.m[by] - a.m[by]).slice(0, limit), total: d.total, at: c.updatedAt };
}

/** Hiệu quả của một creator ở từng bảng kho, kèm từng shop (hồ sơ KOC). */
export async function creatorSources(handle: string) {
  const rows = await db.creatorMetric.findMany({ where: { handle: handle.toLowerCase() } });
  return WAREHOUSE.flatMap((s) => {
    const r = rows.find((x) => x.source === s.key);
    return r ? [{ s, m: r.m, shops: (r.shops ?? []) as ShopRow[], at: r.updatedAt }] : [];
  });
}

export type CreatorSource = { s: Source; m: number[] | null; shops: ShopRow[]; at: Date | null };

/** Một creator ở từng bảng kho. Job gộp mọi creator nên không có dòng = creator không có ở bảng đó. */
export async function creatorStation(handle: string): Promise<CreatorSource[]> {
  const saved = await db.creatorMetric.findMany({ where: { handle: handle.toLowerCase() } });
  return WAREHOUSE.map((s): CreatorSource => {
    const a = saved.find((x) => x.source === s.key);
    return a ? { s, m: a.m, shops: (a.shops ?? []) as ShopRow[], at: a.updatedAt } : { s, m: null, shops: [], at: null };
  });
}

// ------------------------------------------------------------------ Hỏi thẳng kho cho một creator (trang creator)

/** Bảng hỏi thẳng kho lúc mở trang creator: đơn, LIVE ~1–2 giây. Video ~12 giây nên đọc bản tổng hợp sẵn. */
export const LIVE_SOURCES = ['aff_orders', 'lives'];

/** Số của một creator ở một bảng kho, hỏi thẳng lúc mở trang, kèm từng shop. m = null: creator không có ở bảng này. */
export async function liveCreator(s: Source, handle: string): Promise<CreatorSource> {
  const n = s.metrics.length;
  const shops: ShopRow[] = [];
  let m = zeros(s);
  for await (const r of warehouseQuery(aggSql(s.wh!, n, 'k', userIs(s.wh!, handle.toLowerCase())))) {
    const x = Array.from({ length: n }, (_, i) => Number(r[`m${i}`] ?? 0));
    shops.push({ key: String(r.k), shop: String(r.shop || `Shop #${r.k}`), m: x });
    m = mergeMetrics(s, m, x);
  }
  return { s, m: shops.length ? m : null, shops: shops.sort((a, b) => b.m[0] - a.m[0]).slice(0, SHOPS_KEPT), at: new Date() };
}

export type RawColumn = { id: string; label: string; type: 'ts' | 'date' | 'money' | 'int' | 'text' | 'video' };
// Cột dữ liệu gốc từng bảng: [id, nhãn, kiểu, biểu thức]. Dòng mới nhất trước.
const RAW: Record<string, { cols: [string, string, RawColumn['type'], string][]; order: string }> = {
  aff_orders: {
    order: 't.created_at DESC',
    cols: [
      ['at', 'Thời gian đặt', 'ts', 'toString(t.created_at)'], ['order', 'Mã đơn', 'text', 't.order_id'], ['shop', 'Shop', 'text', 's.label'],
      ['product', 'Sản phẩm', 'text', 't.product_name'], ['qty', 'SL', 'int', 't.sale_quantity'], ['gmv', 'GMV', 'money', 'toFloat64(t.price) * t.sale_quantity'],
      ['kind', 'Nguồn đơn', 'text', 't.content_type'], ['status', 'Trạng thái', 'text', 't.order_status'],
      ['cms', 'Hoa hồng ƯT', 'money', 'toFloat64(ifNull(t.est_std_commission_amount, 0)) + toFloat64(ifNull(t.est_shop_ads_commission_payment_amount, 0))'],
    ],
  },
  videos: {
    order: 't.report_date DESC',
    cols: [
      ['day', 'Ngày', 'date', 'toString(t.report_date)'], ['video', 'Video', 'video', 't.video_id'], ['shop', 'Shop', 'text', 's.label'],
      ['views', 'Lượt xem', 'int', 't.video_views'], ['gmv', 'GMV', 'money', 'toFloat64(t.video_attributed_gmv)'],
      ['items', 'Sản phẩm bán', 'int', 'ifNull(t.video_items_sold, 0) + ifNull(t.video_indirect_items_sold, 0)'], ['posted', 'Ngày đăng', 'ts', 'toString(t.posted_time)'],
    ],
  },
  lives: {
    order: 't.report_date DESC',
    cols: [
      ['day', 'Ngày', 'date', 'toString(t.report_date)'], ['live', 'Mã phiên', 'text', 't.id_live_koc'], ['title', 'Tên phiên', 'text', 't.room_title'],
      ['shop', 'Shop', 'text', 's.label'], ['viewers', 'Người xem', 'int', 'toFloat64(t.live_koc_view)'], ['gmv', 'GMV', 'money', 'toFloat64(t.gmv_live_koc)'],
      ['orders', 'Đơn', 'int', 'toFloat64(t.live_koc_order)'], ['start', 'Bắt đầu', 'ts', 'toString(t.live_koc_start_date)'],
    ],
  },
};

/** Dòng gốc mới nhất của creator ở một bảng kho (đơn, video theo ngày, phiên LIVE), để người xem tự đối chiếu số tổng. */
export async function rawRows(s: Source, handle: string, limit = 50) {
  const w = s.wh!, r = RAW[s.key];
  const sql = `SELECT ${r.cols.map(([id, , , e]) => `${e} AS ${id}`).join(', ')}
FROM upbase_prod.${w.table} AS t FINAL LEFT JOIN ${STORE} AS s ON s.id = t.store_id
WHERE t._peerdb_is_deleted = 0${w.where ? ` AND ${w.where}` : ''}${userIs(w, handle.toLowerCase())}
ORDER BY ${r.order} LIMIT ${limit}`;
  const rows: Record<string, unknown>[] = [];
  for await (const x of warehouseQuery(sql)) rows.push(x);
  return { columns: r.cols.map(([id, label, type]): RawColumn => ({ id, label, type })), rows };
}
