// Đồng bộ bảng "3.2 List duyệt book" (Lark Base B2C_Quản lý Booking) vào bảng Booking, và thêm KOL mới vào Danh bạ.
// Mỗi lần chạy đọc lướt cả bảng (chỉ các cột cần dùng, ~1 phút cho 18k dòng) nhưng chỉ ghi bản ghi mới / vừa sửa.
// Lọc theo "Last Modified Date" phía Lark chỉ lọc được theo ngày (mỗi ngày ~3.700 dòng đổi) và chậm hơn 10 lần nên không dùng.
// Dùng API search (nhanh) thay vì list (~24s/trang, hay bị cắt kết nối); search chỉ trả record_id cho cột liên kết
// nên tra chữ từ cột chính của bảng được liên kết (KOCs tổng hợp, Stores, Tệp KOCs).
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { larkGet, larkPost, tenantToken } from './lark';

const APP = 'W6vRbbuOVar3qtsV18dlan1xgXb';
const TABLE = 'tbluWrjJd9Pt9uzb';

// Tên cột trên Lark. Đổi tên cột bên Lark thì sửa ở đây.
const COL = {
  code: 'Mã Booking',
  channel: '🎃 id kênh',
  channelUrl: 'Link kênh',
  store: 'Store',
  brand: 'Brand',
  owner: 'Người phụ trách',
  pipeline: 'Pipeline_text',
  planMonth: 'Tháng Plan',
  airDate: '🎃 Ngày air/live real',
  planAirDate: 'P.Ngày air',
  cost: '🎃Chi phí thanh toán Booking',
  linkAir: '🎃 Link air/Link nghiệm thu',
} as const;
const EXTRA = {
  product: '🎃 Sản phẩm',
  niche: '🎃 Tệp kênh',
  platform: 'Nền tảng',
  coopType: 'Hình thức hợp tác',
  format: '🎃 Định dạng nghiệm thu',
  kl: 'KL',
  views30: '🌸 Views 30 ngày',
  gmv30: '🌸 GMV 30 ngày',
} as const;

// id → chữ: option "opt..." (cột công thức kiểu chọn) và record "rec..." của bảng được liên kết.
type Options = Map<string, string>;

/** Đưa mọi kiểu giá trị của Lark Base (link, lookup, người, url, công thức) về chữ. */
export function toText(v: unknown, opts: Options): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'string') return opts.get(v) ?? v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    const parts = v.map((x) => toText(x, opts)).filter((x): x is string => Boolean(x));
    return parts.length ? [...new Set(parts)].join(', ') : null;
  }
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.users)) return toText((o.users as { name?: string }[]).map((u) => u.name), opts);
  if ('value' in o) return toText(o.value, opts);
  if ('link_record_ids' in o) return toText(o.link_record_ids, opts);
  if (Array.isArray(o.text_arr)) return toText(o.text_arr, opts);
  return toText(o.name ?? o.text ?? o.link ?? null, opts);
}

const toDate = (v: unknown, opts: Options) => {
  const n = Number(toText(v, opts)?.split(', ')[0]);
  return Number.isFinite(n) && n > 0 ? new Date(n) : null;
};
const toNum = (v: unknown, opts: Options) => {
  const n = Number(toText(v, opts)?.split(', ')[0]);
  return Number.isFinite(n) ? n : null;
};
const firstUrl = (v: unknown) => (Array.isArray(v) ? (v[0] as { link?: string } | undefined)?.link ?? null : null);

interface LarkRecord {
  record_id: string;
  last_modified_time: number;
  fields: Record<string, unknown>;
}

export function toBooking(r: LarkRecord, opts: Options) {
  const f = r.fields;
  const t = (name: string) => toText(f[name], opts);
  return {
    id: r.record_id,
    code: t(COL.code) ?? r.record_id,
    channel: t(COL.channel)?.split(', ')[0] ?? null,
    channelUrl: firstUrl(f[COL.channelUrl]) ?? t(COL.channelUrl),
    store: t(COL.store),
    brand: t(COL.brand),
    owner: t(COL.owner),
    pipeline: t(COL.pipeline),
    planMonth: t(COL.planMonth),
    airDate: toDate(f[COL.airDate], opts),
    planAirDate: toDate(f[COL.planAirDate], opts),
    cost: toNum(f[COL.cost], opts),
    linkAir: t(COL.linkAir),
    extra: Object.fromEntries(Object.entries(EXTRA).map(([k, name]) => [k, t(name)])) as Record<keyof typeof EXTRA, string | null>,
    larkUpdatedAt: new Date(r.last_modified_time),
  };
}

type Row = ReturnType<typeof toBooking>;

/** KOL mới từ booking → Danh bạ. Chỉ thêm kênh chưa có, không ghi đè thông tin đã sửa tay. */
async function addKocs(rows: Row[]) {
  const byKey = new Map<string, Prisma.KocCreateManyInput>();
  for (const r of rows) {
    if (!r.channel) continue;
    const handle = r.channel.trim().replace(/^@/, '').toLowerCase();
    if (!handle) continue;
    // "id kênh" là kênh TikTok (Link kênh = tiktok.com/@...). Cột "Nền tảng" bên Lark tính từ link air của booking, không phải của kênh.
    byKey.set(handle, { platform: 'TikTok', handle, name: r.channel.trim(), channelUrl: r.channelUrl, niche: r.extra.niche });
  }
  return (await db.koc.createMany({ data: [...byKey.values()], skipDuplicates: true })).count;
}

async function* searchPages(table: string, fieldNames: string[], token: string) {
  let pageToken = '';
  do {
    const { data } = await larkPost(
      `/open-apis/bitable/v1/apps/${APP}/tables/${table}/records/search?page_size=500${pageToken && `&page_token=${pageToken}`}`,
      { field_names: fieldNames, automatic_fields: true },
      token,
    );
    yield (data.items ?? []) as LarkRecord[];
    pageToken = data.has_more ? data.page_token : '';
  } while (pageToken);
}

async function fieldsOf(table: string, token: string) {
  const out: { field_name: string; is_primary?: boolean; property?: Record<string, any> }[] = [];
  let pageToken = '';
  do {
    const data = await larkGet(`/open-apis/bitable/v1/apps/${APP}/tables/${table}/fields?page_size=100${pageToken && `&page_token=${pageToken}`}`, token);
    out.push(...data.items);
    pageToken = data.has_more ? data.page_token : '';
  } while (pageToken);
  return out;
}

export async function syncBookings() {
  const token = await tenantToken();
  const used = [...Object.values(COL), ...Object.values(EXTRA)] as string[];

  const opts: Options = new Map();
  const linkTables = new Set<string>();
  for (const fld of await fieldsOf(TABLE, token)) {
    const p = fld.property ?? {};
    for (const o of p.options ?? p.type?.ui_property?.options ?? []) opts.set(o.id, o.name);
    if (used.includes(fld.field_name) && p.table_id) linkTables.add(p.table_id);
  }
  for (const table of linkTables) {
    const primary = (await fieldsOf(table, token)).find((f) => f.is_primary)!.field_name;
    for await (const page of searchPages(table, [primary], token)) {
      for (const r of page) opts.set(r.record_id, toText(r.fields[primary], opts) ?? '');
    }
  }

  const known = new Map((await db.booking.findMany({ select: { id: true, larkUpdatedAt: true } })).map((b) => [b.id, b.larkUpdatedAt.getTime()]));
  const seen = new Set<string>();
  let created = 0, updated = 0, kocs = 0;

  for await (const page of searchPages(TABLE, used, token)) {
    const rows = page.map((r) => toBooking(r, opts));
    rows.forEach((r) => seen.add(r.id));

    const fresh = rows.filter((r) => !known.has(r.id));
    const changed = rows.filter((r) => known.has(r.id) && known.get(r.id) !== r.larkUpdatedAt.getTime());
    created += (await db.booking.createMany({ data: fresh, skipDuplicates: true })).count;
    // ponytail: cập nhật từng dòng; mỗi giờ thường chỉ vài trăm dòng đổi. Gom batch nếu chậm.
    for (const r of changed) await db.booking.update({ where: { id: r.id }, data: r });
    updated += changed.length;
    kocs += await addKocs(fresh.concat(changed));
  }

  // Chỉ xoá khi đã đọc trọn bảng (vòng lặp trên ném lỗi nếu Lark lỗi giữa chừng).
  const gone = [...known.keys()].filter((id) => !seen.has(id));
  const removed = seen.size ? (await db.booking.deleteMany({ where: { id: { in: gone } } })).count : 0;

  return { total: seen.size, created, updated, removed, kocs };
}
