// Đồng bộ số liệu creator từ kho dữ liệu UpBase (ClickHouse, bảng kol-connector connector_creator_public_* trong
// upbase_prod) vào bảng WarehouseCreator: pool "Marketplace" ở bước 2 của Creator matching và nguồn số liệu cho KOC Danh bạ
// cùng handle. Đọc kho qua Metabase của DX (SQL native trên database "clickhouse"), vì ClickHouse chỉ mở trong VPN.
// Bảng PeerDB (ReplacingMergeTree): đọc FINAL, bỏ dòng _peerdb_is_deleted = 1 và dòng xoá mềm (deleted_at khác 1970-01-01).
// Cấu hình ở Phân quyền → Tích hợp → Kho dữ liệu; thiếu thì job không chạy và phần giao diện liên quan không hiện.
import { db } from '../db';
import { configured, requireCfg, cfg } from '../integrations';

const PLATFORM: Record<string, string> = { tiktok: 'TikTok', shopee: 'Shopee', facebook: 'Facebook', instagram: 'Instagram', threads: 'Threads', youtube: 'YouTube' };
const ALIVE = (t = '') => `${t}_peerdb_is_deleted = 0 AND (${t}deleted_at IS NULL OR toYear(${t}deleted_at) = 1970)`;

export const CREATOR_SQL = `
WITH
  ch AS (SELECT id, channel_code, lower(username) AS handle, nickname, avatar_url, marketplace_url, latest_cast_fee, score, mcn, last_synced_at
         FROM upbase_prod.connector_creator_public_creator_channel FINAL WHERE ${ALIVE()} AND username != ''),
  p AS (SELECT * FROM upbase_prod.connector_creator_public_creator_channel_performance_latest FINAL WHERE ${ALIVE()}),
  cat AS (SELECT cc.creator_channel_id AS cid, groupArray(tuple(c.name, toFloat64(cc.gmv_rate))) AS cats
          FROM upbase_prod.connector_creator_public_creator_channel_categories AS cc FINAL
          INNER JOIN (SELECT id, name FROM upbase_prod.connector_creator_public_categories FINAL WHERE ${ALIVE()}) AS c ON c.id = cc.category_id
          WHERE ${ALIVE('cc.')} GROUP BY cc.creator_channel_id),
  -- Video nổi bật: bảng giữ nhiều lượt chụp (rank 1..3 mỗi lượt), lấy lượt mới nhất của mỗi video rồi 5 video rank cao nhất.
  -- Không lấy url (link CDN có hạn) và JSON sản phẩm (nặng): giữ mã video + tên sản phẩm.
  top AS (SELECT cid, arraySort(x -> (x.1, -x.4), groupArray(tuple(rank, title, ref, views, likes, d, prods))) AS vids FROM (
            SELECT creator_channel_id AS cid, rank, leftUTF8(name, 200) AS title, if(ref_id != '', ref_id, url) AS ref, view_count AS views,
                   like_count AS likes, toString(toDate(release_date)) AS d,
                   leftUTF8(arrayStringConcat(arrayMap(j -> JSONExtractString(j, 'name'), JSONExtractArrayRaw(video_products)), '; '), 200) AS prods
            FROM (SELECT * FROM upbase_prod.connector_creator_public_creator_channel_top_content FINAL WHERE ${ALIVE()}
                  ORDER BY creator_channel_id, updated_at DESC LIMIT 1 BY creator_channel_id, if(ref_id != '', ref_id, url))
            ORDER BY cid, rank, views DESC LIMIT 5 BY cid)
          GROUP BY cid)
SELECT ch.channel_code AS channel_code, ch.handle AS handle, ch.nickname AS nickname, ch.avatar_url AS avatar_url, ch.marketplace_url AS url,
       toFloat64(ch.latest_cast_fee) AS cast_fee, toFloat64(ch.score) AS fulfillment, ch.mcn AS mcn, toString(ch.last_synced_at) AS source_at,
       p.follower_count, p.avg_video_play_count, p.avg_ec_video_play_count, p.video_engagement_rate, p.video_count_30d, p.ec_video_count,
       p.units_sold, p.gmv_amount, p.is_gmv_hidden_by_creator, p.gmv_range_min, p.gmv_range_max, p.gpm_amount, p.avg_gmv_per_buyer_amount,
       toFloat64(p.follower_gender_female) AS female, toFloat64(p.age_18_24_follower_rate) AS a1, toFloat64(p.age_25_34_follower_rate) AS a2,
       toFloat64(p.age_35_44_follower_rate) AS a3, toFloat64(p.age_45_54_follower_rate) AS a4, toFloat64(p.age_55_plus_follower_rate) AS a5,
       p.follower_state_location, p.brand_collaboration_count, p.partnered_brands, p.promoted_product_num,
       toJSONString(cat.cats) AS cats, toJSONString(top.vids) AS vids -- Metabase không trả được mảng tuple, đổi sẵn sang JSON
FROM ch LEFT JOIN p ON p.creator_channel_id = ch.id LEFT JOIN cat ON cat.cid = ch.id LEFT JOIN top ON top.cid = ch.id
SETTINGS join_use_nulls = 1`;

type Row = Record<string, unknown>;
const n = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const int = (v: unknown) => { const x = n(v); return x == null ? null : Math.round(x); };
// Đơn vị kiểm tra trên kho ngày 2026-11-26: ER là chuỗi % ("1.73"), % nữ là % (0..100). Tỷ lệ tuổi và tỷ trọng ngành (gmv_rate)
// lẫn hai thang (đa số tuổi theo %, ~300 creator theo 0..1; ngành ngược lại) nên quy thang theo từng creator.
const pct = (v: unknown) => { const x = n(v); return x == null ? null : Math.round(x * 1e4) / 1e6; };
const ratio = (x: number | null, max = x) => (x == null ? null : max! > 100 ? x / 10_000 : max! > 1 ? x / 100 : x);
const json = (v: unknown) => { if (typeof v !== 'string' || !v.trim()) return v ?? null; try { return JSON.parse(v); } catch { return null; } };

/** Danh sách [{ key/name, value }] → [{ name, share 0..1 }], quy đơn vị theo giá trị lớn nhất của cả danh sách. */
function shares(list: unknown, key = 'key'): { name: string; share: number }[] | null {
  const arr = Array.isArray(list) ? list : null;
  if (!arr?.length) return null;
  const rows = arr.map((x) => (Array.isArray(x) ? { name: String(x[0] ?? ''), v: n(x[1]) } : { name: String(x?.[key] ?? x?.name ?? ''), v: n(x?.value ?? x?.rate) }))
    .filter((x): x is { name: string; v: number } => !!x.name && x.v != null);
  const max = Math.max(...rows.map((x) => x.v));
  return rows.length ? rows.map((x) => ({ name: x.name, share: ratio(x.v, max)! })).sort((a, b) => b.share - a.share) : null;
}

/** Mã video TikTok → link trang video (link CDN trong kho có hạn dùng); nền tảng khác giữ link gốc. */
const videoUrl = (handle: string, ref: unknown) => { const s = String(ref ?? ''); return /^\d+$/.test(s) ? `https://www.tiktok.com/@${handle}/video/${s}` : s.startsWith('http') ? s : null; };

function brandNames(v: unknown): string[] {
  const arr = json(v);
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => (typeof x === 'string' ? x : x?.name ?? x?.brand_name ?? '')).filter((x): x is string => typeof x === 'string' && !!x).slice(0, 50);
}

/** Một dòng ClickHouse → bản ghi WarehouseCreator (đủ mọi cột để nạp bằng jsonb_populate_recordset). */
export function toCreator(r: Row, syncedAt: Date) {
  const platform = PLATFORM[String(r.channel_code)];
  const handle = String(r.handle ?? '').trim().replace(/^@/, '').toLowerCase();
  if (!platform || !handle) return null;
  const rawAges = [n(r.a1), n(r.a2), n(r.a3), n(r.a4), n(r.a5)];
  const ageSum = rawAges.reduce<number>((s, x) => s + (x ?? 0), 0);
  const ages = rawAges.map((x) => (x == null ? null : Math.round((x / (ageSum > 1.5 ? 100 : 1)) * 1e6) / 1e6)); // tổng ~100 → %, tổng ~1 → tỷ lệ
  // 80% creator trong kho chưa có chân dung follower: tuổi toàn 0 và % nữ là giá trị giữ chỗ 0 hoặc 100. Coi là chưa có dữ liệu.
  const audience = ageSum > 0;
  const hidden = r.is_gmv_hidden_by_creator === true || r.is_gmv_hidden_by_creator === 1;
  const lo = n(r.gmv_range_min), hi = n(r.gmv_range_max);
  const gmv = n(r.gmv_amount) || (hidden && lo != null ? (hi != null ? (lo + hi) / 2 : lo) : n(r.gmv_amount));
  const vids = (Array.isArray(json(r.vids)) ? json(r.vids) : []) as unknown[][];
  return {
    platform, handle,
    nickname: (r.nickname as string) || null, avatarUrl: (r.avatar_url as string) || null, url: (r.url as string) || null,
    followers: int(r.follower_count) || null, medianViews: int(r.avg_video_play_count) || null, ecViews: int(r.avg_ec_video_play_count),
    er: pct(r.video_engagement_rate), videos30: int(r.video_count_30d), ecVideos: int(r.ec_video_count), unitsSold: int(r.units_sold),
    gmv, gmvHidden: hidden, gpm: n(r.gpm_amount), aov: n(r.avg_gmv_per_buyer_amount),
    female: audience ? pct(r.female) : null,
    ages: audience ? Object.fromEntries(['18-24', '25-34', '35-44', '45-54', '55+'].map((k, i) => [k, ages[i] ?? 0])) : null,
    locations: shares(json(r.follower_state_location)),
    categories: shares(json(r.cats)),
    brandCount: int(r.brand_collaboration_count), brands: brandNames(r.partnered_brands), products: int(r.promoted_product_num),
    castFee: int(r.cast_fee) || null, fulfillment: n(r.fulfillment) || null, mcn: (r.mcn as string) || null,
    topVideos: vids.length ? vids.map((v) => ({ title: String(v[1] ?? ''), url: videoUrl(handle, v[2]), views: int(v[3]), likes: int(v[4]), date: (v[5] as string)?.slice(0, 10) || null, products: (v[6] as string) || null })) : null,
    sourceAt: r.source_at && !String(r.source_at).startsWith('1970') ? new Date(`${String(r.source_at).replace(' ', 'T')}Z`).toISOString() : null,
    syncedAt: syncedAt.toISOString(),
  };
}
type Creator = NonNullable<ReturnType<typeof toCreator>>;
const COLS = Object.keys(toCreator({ channel_code: 'tiktok', handle: 'x' }, new Date())!) as (keyof Creator)[];

const mbError = (t: string) => { try { const j = JSON.parse(t); return String(j.error ?? j.via?.[0]?.error ?? j.message ?? t); } catch { return t; } };

/** Chạy SQL native qua Metabase. Dùng API export JSON: không bị giới hạn 2.000 dòng như /api/dataset, và Metabase ghi mỗi dòng
 *  kết quả trên một dòng văn bản ("[", "{…},", …, "]") nên đọc theo luồng, không phải giữ cả trăm MB trong bộ nhớ. */
async function* query(sql: string): AsyncGenerator<Row> {
  const c = await requireCfg('warehouse', 'METABASE_URL', 'METABASE_USER', 'METABASE_PASSWORD');
  const base = c.METABASE_URL.replace(/\/+$/, '');
  const login = await fetch(`${base}/api/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
    body: JSON.stringify({ username: c.METABASE_USER, password: c.METABASE_PASSWORD }),
  });
  if (!login.ok) throw new Error(`Metabase đăng nhập lỗi ${login.status}: ${mbError(await login.text()).slice(0, 200)}`);
  const headers = { 'X-Metabase-Session': ((await login.json()) as { id: string }).id };
  try {
    const q = { database: Number(await cfg('METABASE_DATABASE_ID')) || 2, type: 'native', native: { query: sql } };
    const res = await fetch(`${base}/api/dataset/json`, { method: 'POST', headers, body: new URLSearchParams({ query: JSON.stringify(q), format_rows: 'false' }), cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(`Metabase ${res.status}: ${mbError(await res.text()).slice(0, 300)}`);
    const decoder = new TextDecoder();
    let buf = '';
    const parse = (line: string) => {
      const t = line.trim().replace(/,$/, '');
      if (!t || t === '[' || t === ']') return null;
      const r = JSON.parse(t) as Row;
      if ('error' in r && !('handle' in r)) throw new Error(`Metabase: ${String(r.error).slice(0, 300)}`); // lỗi giữa chừng
      return r;
    };
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const r = parse(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (r) yield r;
      }
    }
    const r = parse(buf);
    if (r) yield r;
  } finally {
    await fetch(`${base}/api/session`, { method: 'DELETE', headers }).catch(() => {});
  }
}

async function upsert(rows: Creator[]) {
  if (!rows.length) return;
  const set = COLS.filter((c) => c !== 'platform' && c !== 'handle').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
  const cols = COLS.map((c) => `"${c}"`).join(', ');
  await db.$executeRawUnsafe(
    `INSERT INTO "WarehouseCreator" (${cols}) SELECT ${cols} FROM jsonb_populate_recordset(null::"WarehouseCreator", $1::jsonb)
     ON CONFLICT ("platform", "handle") DO UPDATE SET ${set}`,
    JSON.stringify(rows),
  );
}

/** Nạp lại toàn bộ creator từ kho. Creator không còn trong kho thì xoá khỏi bảng. */
export async function syncWarehouseCreators() {
  if (!(await configured('warehouse'))) return 'Chưa cấu hình kho dữ liệu (Phân quyền → Tích hợp), bỏ qua.';
  const started = new Date();
  const before = await db.warehouseCreator.count();
  const batch = new Map<string, Creator>();
  let total = 0;
  const stat = { followers: 0, er: [Infinity, -Infinity], female: [Infinity, -Infinity], cats: 0 };
  for await (const r of query(CREATOR_SQL)) {
    const c = toCreator(r, started);
    if (!c) continue;
    batch.set(`${c.platform}|${c.handle}`, c); // username trùng trong cùng lô: giữ dòng sau
    total++;
    if (c.followers != null) stat.followers++;
    if (c.er != null) stat.er = [Math.min(stat.er[0], c.er), Math.max(stat.er[1], c.er)];
    if (c.female != null) stat.female = [Math.min(stat.female[0], c.female), Math.max(stat.female[1], c.female)];
    if (c.categories) stat.cats++;
    if (batch.size >= 1000) { await upsert([...batch.values()]); batch.clear(); }
  }
  await upsert([...batch.values()]);
  // Lượt này ít hơn một nửa lần trước thì nghi kho lỗi: giữ creator cũ thay vì xoá hàng loạt.
  const removed = total >= before / 2 ? await db.warehouseCreator.deleteMany({ where: { syncedAt: { lt: started } } }) : null;
  const range = ([a, b]: number[]) => (a === Infinity ? '—' : `${a.toFixed(3)}–${b.toFixed(3)}`);
  // Khoảng giá trị ghi vào thông báo để kiểm tra đơn vị (ER, % nữ phải nằm trong 0..1).
  return `${total.toLocaleString('vi-VN')} creator · ${stat.followers.toLocaleString('vi-VN')} có follower · ${stat.cats.toLocaleString('vi-VN')} có tỷ trọng ngành · ER ${range(stat.er)} · nữ ${range(stat.female)} · ${removed ? `xoá ${removed.count}` : `chỉ ${total} so với ${before} lần trước, giữ creator cũ`}`;
}

/** Thời điểm và kết quả lượt đồng bộ gần nhất, cho trang Creator matching. */
export async function warehouseStatus() {
  if (!(await configured('warehouse'))) return null;
  const [s, count] = await Promise.all([db.syncState.findUnique({ where: { id: 'warehouse-creators' } }), db.warehouseCreator.count()]);
  return { count, at: s?.finishedAt ?? null, message: s?.message ?? null };
}
