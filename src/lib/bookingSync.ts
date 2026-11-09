// Đồng bộ bảng "3.2 List duyệt book" (Lark Base B2C_Quản lý Booking) vào bảng Booking, và thêm KOL mới vào Danh bạ.
// Mỗi lần chạy đọc lướt cả bảng (chỉ các cột cần dùng, ~1 phút cho 18k dòng) nhưng chỉ ghi bản ghi mới / vừa sửa.
// Lọc theo "Last Modified Date" phía Lark chỉ lọc được theo ngày (mỗi ngày ~3.700 dòng đổi) và chậm hơn 10 lần nên không dùng.
// Dùng API search (nhanh) thay vì list (~24s/trang, hay bị cắt kết nối); search chỉ trả record_id cho cột liên kết
// nên tra chữ từ cột chính của bảng được liên kết (KOCs tổng hợp, Stores, Tệp KOCs).
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { larkGet, larkPost, tenantToken } from './lark';
import { bankAccount, idNumber } from './validate';

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
  sla: 'Cảnh báo trễ SLA', // "Trễ hạn" / "Bình thường"
  paymentStatus: 'Trạng thái phiếu thanh toán',
  planShipDate: 'P.Ngày gửi hàng',
  planReceiveDate: 'P.Ngày nhận hàng',
  planScriptDate: 'P.Ngày KOC gửi kịch bản',
  planDemoDate: 'P.Ngày KOC gửi demo',
  planPaymentDate: 'P.Ngày làm ĐNTT',
  bookingPic: 'Booking PIC',
  accountPic: 'Account PIC',
  leader: 'Leader',
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
  orders30: '🌸 Số đơn hàng 30 ngày',
  views14: '🌼 Views 14 ngày',
  gmv14: '🌼 GMV 14 ngày',
  airLinkOnTime: 'Trễ/Đúng hạn điền link air',
  airLinkFilledAt: 'Ngày điền link air',
  slaNote: 'Giải trình trễ SLA',
  amountDue: 'Số tiền cần phải thanh toán',
  amountPaid: 'Số tiền đã thanh toán',
  amountPending: 'Số tiền chờ thanh toán',
  advance: '🎃 Số tiền tạm ứng trước',
  advanceStatus: 'Trạng thái phiếu tạm ứng',
  accountType: '🎃📝Loại tài khoản thanh toán',
  adsCode: 'Mã ủy quyền ads',
  contractLink: '🎃Link hợp đồng (nếu có)',
  listingRound: 'Đợt listing',
  note: 'Ghi chú',
} as const;
// Thông tin thanh toán của KOC trên từng booking: chỉ dùng để điền ô còn trống ở Danh bạ (Admin / Leader xem, không lưu vào Booking).
const BANK = { holder: 'Tên tài khoản ngân hàng', account: 'Số tài khoản', bank: 'Ngân hàng', id: 'CCCD/MST/Passport' } as const;

// Tăng khi thêm cột: lượt đồng bộ sau ghi lại mọi dòng để lấp cột mới.
const SYNC_VERSION = 3; // 3: chuẩn hoá kênh (bỏ khoảng trắng, @)

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

export interface LarkRecord {
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
    channel: t(COL.channel)?.split(', ')[0]?.trim().replace(/^@/, '') || null, // = handle trong Danh bạ (không phân biệt hoa thường)
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
    slaLate: t(COL.sla) === 'Trễ hạn',
    paymentStatus: t(COL.paymentStatus),
    planShipDate: toDate(f[COL.planShipDate], opts),
    planReceiveDate: toDate(f[COL.planReceiveDate], opts),
    planScriptDate: toDate(f[COL.planScriptDate], opts),
    planDemoDate: toDate(f[COL.planDemoDate], opts),
    planPaymentDate: toDate(f[COL.planPaymentDate], opts),
    bookingPic: t(COL.bookingPic),
    accountPic: t(COL.accountPic),
    leader: t(COL.leader),
    syncVersion: SYNC_VERSION,
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
  // ID đã gộp vào KOC khác (có thể vừa gộp trong lúc lượt này đang chạy): không tạo lại hồ sơ trùng.
  const merged = await db.kocAlias.findMany({ where: { handle: { in: [...byKey.keys()] } }, select: { handle: true } });
  for (const a of merged) byKey.delete(a.handle);
  return (await db.koc.createMany({ data: [...byKey.values()], skipDuplicates: true })).count;
}

export async function* searchPages(table: string, fieldNames: string[], token: string) {
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
  const fetched = [...used, ...Object.values(BANK)];

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

  const known = new Map((await db.booking.findMany({ select: { id: true, larkUpdatedAt: true, syncVersion: true } }))
    .map((b) => [b.id, b.syncVersion === SYNC_VERSION ? b.larkUpdatedAt.getTime() : -1]));
  const seen = new Set<string>();
  let created = 0, updated = 0, kocs = 0;
  // ID kênh đã gộp ở Danh bạ → handle của KOC gộp vào.
  const alias = new Map((await db.kocAlias.findMany({ select: { handle: true, koc: { select: { handle: true } } } })).map((a) => [a.handle, a.koc.handle]));
  const canon = (r: Row): Row => (r.channel && alias.has(r.channel.toLowerCase()) ? { ...r, channel: alias.get(r.channel.toLowerCase())! } : r);

  // handle → thông tin thanh toán ở booking sửa gần nhất có số tài khoản hợp lệ.
  const banks = new Map<string, { at: number; holder: string | null; account: string; bank: string | null; id: string | null }>();

  for await (const page of searchPages(TABLE, fetched, token)) {
    const rows = page.map((r) => canon(toBooking(r, opts)));
    page.forEach((r, i) => {
      const h = rows[i].channel?.toLowerCase();
      const account = bankAccount(toText(r.fields[BANK.account], opts) ?? '');
      if (!h || !account) return;
      const at = r.last_modified_time;
      if ((banks.get(h)?.at ?? 0) > at) return;
      banks.set(h, {
        at, account,
        holder: toText(r.fields[BANK.holder], opts)?.trim() || null,
        bank: toText(r.fields[BANK.bank], opts)?.trim() || null,
        id: idNumber(toText(r.fields[BANK.id], opts) ?? '') ?? null,
      });
    });
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

  await fillBankInfo(banks);
  await refreshKocAggregates();
  return { total: seen.size, created, updated, removed, kocs };
}

/** Điền số tài khoản / CCCD từ Lark vào Danh bạ, chỉ ô đang trống (sửa tay ở Danh bạ không bị ghi đè). */
async function fillBankInfo(banks: Map<string, { holder: string | null; account: string; bank: string | null; id: string | null }>) {
  if (!banks.size) return;
  const list = [...banks];
  await db.$executeRaw`
    update "Koc" k set
      "bankAccount" = coalesce(k."bankAccount", v.account), "bankHolder" = coalesce(k."bankHolder", v.holder),
      "bankName" = coalesce(k."bankName", v.bank), "idNumber" = coalesce(k."idNumber", v.idn)
    from unnest(${list.map(([h]) => h)}::text[], ${list.map(([, b]) => b.account)}::text[], ${list.map(([, b]) => b.holder)}::text[],
                ${list.map(([, b]) => b.bank)}::text[], ${list.map(([, b]) => b.id)}::text[]) as v(h, account, holder, bank, idn)
    where k.handle = v.h and k.platform = 'TikTok'
      and (k."bankAccount" is null or k."bankAccount" = v.account) -- Danh bạ đã có số TK khác: không lấy tên / ngân hàng / CCCD của TK khác
      and (k."bankAccount" is null or k."bankHolder" is null or k."bankName" is null or k."idNumber" is null)`;
}

/** Đồng bộ tự động (Lark automation, GitHub cron) chạy tối đa 1 lần / giờ; 55 để lịch gọi mỗi giờ lệch vài phút vẫn chạy. */
export const AUTO_SYNC_GAP_MIN = 55;

/** Một lượt đồng bộ, trả câu tóm tắt lưu ở SyncState (dùng cho cron và nút "Đồng bộ ngay"). */
export async function syncBookingsJob() {
  const r = await syncBookings();
  return `${r.total} booking · ${r.created} mới · ${r.updated} cập nhật · ${r.removed} xoá · ${r.kocs} KOL mới`;
}

/** Số booking, booking gần nhất, cấp KL gần nhất của từng KOC: để Danh bạ lọc / sắp xếp không phải gộp lại mỗi lần xem. */
export async function refreshKocAggregates() {
  await db.$executeRaw`
    update "Koc" set "bookingCount" = 0, "lastBookingAt" = null, "klAuto" = null
    where platform = 'TikTok' and "bookingCount" > 0
      and handle not in (select lower(channel) from "Booking" where channel is not null)`;
  await db.$executeRaw`
    update "Koc" k set "bookingCount" = a.n, "lastBookingAt" = a.last, "klAuto" = a.kl
    from (
      select lower(channel) h, count(*)::int n, max(coalesce("airDate", "planAirDate", "larkUpdatedAt")) last,
        (array_agg(extra->>'kl' order by coalesce("airDate", "planAirDate", "larkUpdatedAt") desc) filter (where extra->>'kl' is not null))[1] kl
      from "Booking" where channel is not null group by 1
    ) a
    where a.h = k.handle and k.platform = 'TikTok'`;
}
