// Đồng bộ bảng "3.1 Listing KOCs" (Lark Base B2C_Quản lý Booking) vào tab Listing, chỉ đọc như Plan từ Lark.
// Mỗi (brand, gian hàng, tháng, đợt) trên Lark = 1 đợt listing "lark-..."; mỗi KOC trong đợt = 1 dòng ("lark-<record_id>" của dòng
// Lark sửa gần nhất). Lark hay có nhiều dòng cùng KOC cùng đợt (thường là nhiều video): gộp lại, số video = số dòng.
// Team vẫn sửa trên Lark (Brand duyệt, giá, đề xuất); app chỉ hiển thị, không cho sửa / tạo job từ đợt Lark (Lark tạo BO).
// KOC chưa có trong Danh bạ được thêm (ID kênh TikTok hợp lệ); Zalo / email / thông tin nhận hàng điền ô trống của Danh bạ.
import { createHash } from 'node:crypto';
import { type LarkRecord, searchPages, toText } from './bookingSync';
import { db } from './db';
import { fillKocContacts, type ContactFill, emailOf, handleOf, phoneOf } from './kocLarkSync';
import { tenantToken } from './lark';
import { brandKey, RECOMMEND } from './listing';
import { matchUser, people } from './masterSync';
import { TIKTOK_USERNAME } from './validate';

const TABLE = 'tblmbt4LeSjjJtce';
// Tên cột trên Lark. Đổi tên cột bên Lark thì sửa ở đây.
const COL = {
  channel: '🎃 ID kênh', link: 'Link kênh', round: '🎃 Đợt', month: 'Tháng', store: 'Store_text', brand: 'Brand', product: '🌟Sản phẩm',
  price: '🎃 Giá net video', status: '🎃 Trạng thái KOC', rec: 'Đề xuất từ UpBase', note: 'Content note', comment: 'Leader/Growth/Account comment',
  choice: '🎃 Brand duyệt', reason: 'Lý do Brand từ chối', by: 'Nhân sự điền', format: 'Định dạng booking', ship: 'Thông tin nhận hàng',
  zalo: 'Zalo', email: 'Email',
} as const;
export const LARK_USER = 'lark'; // user hệ thống (bị khoá) đứng tên dòng Lark không khớp được "Nhân sự điền"
const CHOICES = ['Yes', 'No', 'Cân nhắc'];
const INT_MAX = 2_147_483_647;

export type ListingDraft = {
  id: string; batchId: string; month: string; brand: string; round: string; handle: string | null; at: number;
  store: string | null; product: string | null; price: number | null; priceType: string; status: string | null; recommendation: string | null;
  contentNote: string | null; brandChoice: string | null; rejectReason: string | null; by: ReturnType<typeof people>[number] | null;
  contact: ContactFill;
};

/** Khoá đợt: brand + gian hàng (bỏ dấu cách / ký tự đặc biệt) + tháng + đợt → id ổn định giữa các lượt đồng bộ. */
export const batchIdOf = (month: string, brand: string, store: string | null, round: string) =>
  `lark-${month}-${createHash('sha1').update(`${brandKey(brand)}|${brandKey(store)}|${brandKey(round)}`).digest('hex').slice(0, 10)}`;

/** Một dòng Lark → bản nháp KOC trong đợt; thiếu tháng / brand thì bỏ. */
export function toDraft(r: LarkRecord): ListingDraft | null {
  const f = r.fields;
  const t = (k: keyof typeof COL) => toText(f[COL[k]], new Map())?.trim() || null;
  const m = t('month')?.match(/^(\d{4})\/(\d{2})$/);
  const brand = t('brand');
  if (!m || !brand) return null;
  const month = `${m[1]}-${m[2]}`;
  const round = t('round') ?? 'Đợt 1';
  const store = t('store');
  const price = Math.round(Number(t('price')));
  const rec = t('rec');
  const choice = t('choice');
  return {
    id: `lark-${r.record_id}`, batchId: batchIdOf(month, brand, store, round), month, brand, round, at: r.last_modified_time,
    handle: handleOf(t('link'), t('channel')),
    store, product: collapseRepeat(t('product')),
    price: Number.isFinite(price) && price > 0 && price <= INT_MAX ? price : null,
    priceType: /live/i.test(t('format') ?? '') ? 'Phiên livestream' : 'Video',
    status: t('status'),
    recommendation: RECOMMEND.find((x) => x.toLowerCase() === rec?.toLowerCase()) ?? rec,
    contentNote: [t('note'), t('comment')].filter(Boolean).join(' · ') || null,
    brandChoice: CHOICES.find((x) => x.toLowerCase() === choice?.toLowerCase()) ?? null,
    rejectReason: t('reason'),
    by: people(f[COL.by])[0] ?? null,
    contact: { phone: phoneOf(t('zalo')), email: emailOf(t('email')), address: t('ship') },
  };
}

/** Cột sản phẩm trên Lark là công thức nối chuỗi ("PomeloPomeloPomelo"): gộp phần lặp lại. */
export const collapseRepeat = (s: string | null) => (s ? s.replace(/^(.+?)\1+$/s, '$1') : s);
const mostCommon = (values: (string | null)[]) => {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

export async function syncListings() {
  const token = await tenantToken();
  const drafts: ListingDraft[] = [];
  let rows = 0, incomplete = 0;
  for await (const page of searchPages(TABLE, Object.values(COL), token)) {
    rows += page.length;
    for (const r of page) {
      const d = toDraft(r);
      if (d) drafts.push(d);
      else incomplete++;
    }
  }
  // Đổi tên / định dạng cột trên Lark thì mọi dòng ra rỗng: không được xoá hết đợt đang có.
  if (!drafts.length) throw new Error(`Đọc ${rows} dòng Lark nhưng không ra dòng listing nào (đổi tên / định dạng cột?), không đồng bộ để tránh xoá nhầm.`);

  await db.user.upsert({ where: { id: LARK_USER }, create: { id: LARK_USER, larkUserId: 'lark-system', name: 'Lark Base', role: 'STAFF', active: false }, update: {} });
  const users = await db.user.findMany({ where: { active: true }, select: { id: true, larkUserId: true, name: true } });
  const userOf = (d: ListingDraft) => (d.by && matchUser(users, d.by)?.id) || LARK_USER;

  // KOC theo handle (ID đã gộp quy về KOC giữ lại); chưa có và đúng định dạng TikTok thì thêm vào Danh bạ.
  const alias = new Map((await db.kocAlias.findMany({ select: { handle: true, koc: { select: { handle: true } } } })).map((a) => [a.handle, a.koc.handle]));
  for (const d of drafts) if (d.handle) d.handle = alias.get(d.handle) ?? d.handle;
  const handles = [...new Set(drafts.map((d) => d.handle).filter((h): h is string => Boolean(h)))];
  const known = new Map((await db.koc.findMany({ where: { platform: 'TikTok', handle: { in: handles } }, select: { id: true, handle: true } })).map((k) => [k.handle, k.id]));
  const toAdd = handles.filter((h) => !known.has(h) && TIKTOK_USERNAME.test(h));
  const newKocs = toAdd.length
    ? (await db.koc.createMany({ data: toAdd.map((h) => ({ platform: 'TikTok', handle: h, name: h, channelUrl: `https://www.tiktok.com/@${h}` })), skipDuplicates: true })).count
    : 0;
  if (toAdd.length) for (const k of await db.koc.findMany({ where: { platform: 'TikTok', handle: { in: toAdd } }, select: { id: true, handle: true } })) known.set(k.handle, k.id);

  // Mỗi KOC một dòng trong đợt: giữ dòng Lark sửa gần nhất, số video = số dòng Lark của KOC trong đợt.
  const latest = new Map<string, ListingDraft & { kocId: string; videos: number }>();
  let skipped = 0;
  for (const d of drafts) {
    const kocId = d.handle ? known.get(d.handle) : undefined;
    if (!kocId) { skipped++; continue; }
    const key = `${d.batchId}|${kocId}`;
    const cur = latest.get(key);
    const videos = (cur?.videos ?? 0) + 1;
    latest.set(key, (cur?.at ?? -1) < d.at ? { ...d, kocId, videos } : { ...cur!, videos });
  }
  const kept = [...latest.values()];

  const groups = new Map<string, (typeof kept)[number][]>();
  for (const d of kept) groups.set(d.batchId, [...(groups.get(d.batchId) ?? []), d]);
  const batches = [...groups].map(([id, list]) => ({
    id, month: list[0].month, brand: list[0].brand, store: list[0].store,
    name: `${list[0].store ?? list[0].brand} · ${list[0].round} · T${list[0].month.slice(5)}/${list[0].month.slice(0, 4)}`,
    product: mostCommon(list.map((d) => d.product)), createdById: userOf(list[0]),
  }));
  const oldBatches = new Map((await db.listingBatch.findMany({ where: { id: { startsWith: 'lark-' } } })).map((b) => [b.id, b]));
  await db.listingBatch.createMany({ data: batches.filter((b) => !oldBatches.has(b.id)), skipDuplicates: true });
  for (const b of batches) {
    const o = oldBatches.get(b.id);
    if (o && (o.name !== b.name || o.store !== b.store || o.product !== b.product || o.brand !== b.brand)) await db.listingBatch.update({ where: { id: b.id }, data: b });
  }

  const items = kept.map((d) => ({
    id: d.id, batchId: d.batchId, kocId: d.kocId, createdById: userOf(d), priceType: d.priceType, price: d.price, videos: d.videos, status: d.status,
    recommendation: d.recommendation, contentNote: d.contentNote, brandChoice: d.brandChoice, rejectReason: d.rejectReason,
  }));
  const old = new Map((await db.listingItem.findMany({ where: { id: { startsWith: 'lark-' } } })).map((i) => [i.id, i]));
  const fresh = items.filter((i) => !old.has(i.id));
  const changed = items.filter((i) => {
    const o = old.get(i.id);
    return o && (Object.keys(i) as (keyof typeof i)[]).some((k) => o[k] !== i[k]);
  });
  const created = (await db.listingItem.createMany({ data: fresh, skipDuplicates: true })).count;
  // ponytail: cập nhật từng dòng; mỗi giờ thường chỉ vài chục dòng đổi. Gom batch nếu chậm.
  for (const i of changed) await db.listingItem.update({ where: { id: i.id }, data: i });
  const keep = new Set(items.map((i) => i.id));
  const removed = (await db.listingItem.deleteMany({ where: { id: { startsWith: 'lark-', notIn: [...keep] }, jobs: { none: {} } } })).count;
  await db.listingBatch.deleteMany({ where: { id: { startsWith: 'lark-', notIn: batches.map((b) => b.id) }, items: { none: {} } } });

  const contacts = new Map<string, ContactFill>();
  for (const d of [...drafts].sort((a, b) => b.at - a.at)) {
    if (!d.handle) continue;
    const c = contacts.get(d.handle) ?? {};
    contacts.set(d.handle, { phone: c.phone ?? d.contact.phone, email: c.email ?? d.contact.email, address: c.address ?? d.contact.address });
  }
  const filled = await fillKocContacts(contacts);
  return { rows, incomplete, batches: batches.length, items: items.length, created, updated: changed.length, removed, newKocs, skipped, filled };
}

/** Một lượt đồng bộ listing từ Lark, trả câu tóm tắt lưu ở SyncState (cron :00 mỗi giờ, nút "Đồng bộ ngay" ở tab Listing). */
export async function syncListingsJob() {
  const r = await syncListings();
  const f = r.filled;
  const filled = [f.phone && `${f.phone} SĐT`, f.email && `${f.email} email`, f.address && `${f.address} địa chỉ`].filter(Boolean).join(', ');
  return `${r.batches} đợt · ${r.items} KOC · ${r.created} mới · ${r.updated} cập nhật · ${r.removed} xoá · ${r.newKocs} KOC mới vào Danh bạ`
    + `${r.skipped ? ` · ${r.skipped} dòng không có ID kênh TikTok hợp lệ` : ''}${r.incomplete ? ` · ${r.incomplete} dòng thiếu tháng / brand` : ''}`
    + `${filled ? ` · Danh bạ điền thêm ${filled}` : ''}`;
}
