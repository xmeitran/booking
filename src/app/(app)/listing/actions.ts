'use server';
import { randomBytes } from 'node:crypto';
import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { refreshKoc } from '@/lib/koc/creatorStats';
import { db } from '@/lib/db';
import { optInt, str } from '@/lib/form';
import { BRAND_CHOICE, COLS, CONTACT_STATUS, fromLarkListing, loadListing, LARK_LISTING_READONLY, parseHandle, PRICE_TYPES, RECOMMEND } from '@/lib/booking/listing';
import { runOnce } from '@/lib/cronJob';
import { syncListingsJob } from '@/lib/lark/listingSync';
import { guard } from '@/lib/auth/scope';
import { readTab, sheetIdOf, writeTab } from '@/lib/google';
import { inviteTemplate, mailer, render } from '@/lib/mail';
import { fmtNum } from '@/lib/format';
import { fmtPct } from '@/lib/format';
import { requireUser } from '@/lib/auth/session';

const oneOf = (list: string[], v: string) => (list.includes(v) ? v : null);

/** CR nhập dạng % (5 hoặc 5,5) → 0.05. */
function optPercent(fd: FormData, key: string): number | null {
  const s = str(fd, key).replace(',', '.').replace('%', '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n / 100 : NaN;
}

export async function saveBatch(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const id = str(fd, 'id');
  if (id) await guard(me, 'listing', id);
  if (id && fromLarkListing(id)) return LARK_LISTING_READONLY;
  const name = str(fd, 'name');
  const month = str(fd, 'month');
  const cr = optPercent(fd, 'cr');
  const aov = optInt(fd, 'aov');
  if (!name) return 'Nhập tên đợt listing.';
  if (!/^\d{4}-\d{2}$/.test(month)) return 'Chọn tháng.';
  if (Number.isNaN(cr)) return 'CR là phần trăm từ 0 tới 100.';
  if (Number.isNaN(aov)) return 'AOV phải là số nguyên ≥ 0.';
  // Brand / gian hàng / sản phẩm chọn từ Danh mục; CR, AOV trống thì lấy của gian hàng.
  const place = str(fd, 'place');
  const storeRow = place.startsWith('s:') ? await db.store.findUnique({ where: { id: place.slice(2) }, include: { brand: true } }) : null;
  const brandRow = storeRow?.brand ?? (place.startsWith('b:') ? await db.brand.findUnique({ where: { id: place.slice(2) } }) : null);
  if (place && !brandRow) return 'Brand / gian hàng không còn trong Danh mục, chọn lại.';
  const productRow = str(fd, 'productId') ? await db.product.findUnique({ where: { id: str(fd, 'productId') } }) : null;
  if (productRow && brandRow && productRow.brandId !== brandRow.id) return `Sản phẩm "${productRow.name}" không thuộc brand ${brandRow.name}.`;
  const data = {
    name, month, cr: cr ?? storeRow?.cr ?? null, aov: aov ?? storeRow?.aov ?? null,
    brand: brandRow?.name ?? (str(fd, 'brand') || null),
    store: storeRow?.name ?? (place ? null : str(fd, 'store') || null),
    product: productRow?.name ?? (str(fd, 'product') || null),
  };
  const batch = id
    ? await db.listingBatch.update({ where: { id }, data })
    : await db.listingBatch.create({ data: { ...data, createdById: me.id } });
  revalidatePath('/listing');
  redirect(`/listing/${batch.id}`);
}

export async function deleteBatch(fd: FormData) {
  const me = await requireUser();
  await guard(me, 'listing', str(fd, 'id'));
  const batch = await db.listingBatch.findUniqueOrThrow({ where: { id: str(fd, 'id') } });
  if (fromLarkListing(batch.id)) throw new Error(LARK_LISTING_READONLY);
  if (me.role === 'STAFF' && batch.createdById !== me.id) throw new Error('Chỉ người tạo, Leader hoặc Admin được xoá đợt listing.');
  // Đợt đã có job: xoá đợt làm job mất nguồn listing (và plan không tính được chi phí ngoài plan).
  if (await db.job.count({ where: { listingItem: { batchId: batch.id } } })) throw new Error('Đợt listing đã có job, không xoá được. Huỷ / xoá các job trước.');
  await db.listingBatch.delete({ where: { id: batch.id } });
  revalidatePath('/listing');
  redirect('/listing');
}

/** Dán một hoặc nhiều ID kênh / link TikTok (mỗi dòng một kênh). Kênh chưa có trong Danh bạ thì tạo mới. */
export async function addKocs(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const batchId = str(fd, 'batchId');
  await guard(me, 'listing', batchId);
  if (fromLarkListing(batchId)) return LARK_LISTING_READONLY;
  const priceType = oneOf(PRICE_TYPES, str(fd, 'priceType')) ?? 'Video';
  // Dán ID / link (ô nhập) hoặc tick chọn từ Danh bạ / gợi ý (pick = id KOC: thêm đúng dòng đã tick, kể cả kênh không phải TikTok).
  const picked = fd.getAll('pick').map(String).filter(Boolean);
  const lines = str(fd, 'ids').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length && !picked.length) return 'Tick chọn KOC từ Danh bạ / gợi ý, hoặc dán ID kênh / link TikTok.';
  // ID không đúng dạng TikTok handle (kênh brand / UGC Lark ghi "phcarevietnam_VJ Xuân Mai") vẫn nhận nếu Danh bạ đã có;
  // ID đã gộp (alias) quy về KOC giữ lại.
  const keys = [...new Set(lines.map((l) => parseHandle(l) ?? l.replace(/^@/, '').toLowerCase()))];
  const aliases = await db.kocAlias.findMany({ where: { handle: { in: keys } }, select: { handle: true, koc: { select: { handle: true } } } });
  const handles = [...new Set(keys.map((k) => aliases.find((a) => a.handle === k)?.koc.handle ?? k))];
  const existing = await db.koc.findMany({ where: { platform: 'TikTok', handle: { in: handles } } });
  const known = new Set(existing.map((k) => k.handle));
  const bad = handles.filter((h) => !known.has(h) && !parseHandle(h));
  if (bad.length) return `ID kênh không hợp lệ và chưa có trong Danh bạ: ${bad.slice(0, 5).join(', ')}`;
  await db.koc.createMany({
    data: handles.filter((h) => !known.has(h)).map((h) => ({ platform: 'TikTok', handle: h, name: h, channelUrl: `https://www.tiktok.com/@${h}` })),
    skipDuplicates: true,
  });
  const kocs = await db.koc.findMany({ where: { OR: [{ id: { in: picked } }, { platform: 'TikTok', handle: { in: handles } }] } });
  await db.listingItem.createMany({
    data: kocs.map((k) => ({ batchId, kocId: k.id, createdById: me.id, priceType })),
    skipDuplicates: true,
  });
  // KOC chưa có số TikTok: tra luôn sau khi trả trang (vài kênh đầu; còn lại để lượt mỗi giờ).
  const fresh = kocs.filter((k) => !k.ttsCheckedAt).slice(0, 3);
  if (fresh.length) after(async () => { for (const k of fresh) await refreshKoc(k.id).catch(() => {}); });
  revalidatePath(`/listing/${batchId}`);
  redirect(`/listing/${batchId}`);
}

export async function saveItem(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const id = str(fd, 'id');
  await guard(me, 'item', id);
  if (fromLarkListing(id)) return LARK_LISTING_READONLY;
  const price = optInt(fd, 'price');
  const viewTarget = optInt(fd, 'viewTarget');
  const planAirDate = str(fd, 'planAirDate');
  const videos = optInt(fd, 'videos') ?? 1;
  if (Number.isNaN(price) || Number.isNaN(viewTarget)) return 'Giá và View Target phải là số nguyên ≥ 0.';
  if (Number.isNaN(videos) || videos < 1 || videos > 50) return 'Số video từ 1 tới 50.';
  const item = await db.listingItem.update({
    where: { id },
    data: {
      priceType: oneOf(PRICE_TYPES, str(fd, 'priceType')) ?? 'Video',
      price, viewTarget, videos,
      status: oneOf(CONTACT_STATUS, str(fd, 'status')),
      recommendation: oneOf(RECOMMEND, str(fd, 'recommendation')),
      brandChoice: oneOf(BRAND_CHOICE, str(fd, 'brandChoice')),
      rejectReason: str(fd, 'rejectReason') || null,
      contentNote: str(fd, 'contentNote') || null,
      planAirDate: /^\d{4}-\d{2}-\d{2}$/.test(planAirDate) ? new Date(`${planAirDate}T00:00:00+07:00`) : null,
    },
  });
  revalidatePath(`/listing/${item.batchId}`);
  redirect(`/listing/${item.batchId}`);
}

export async function removeItem(fd: FormData) {
  await guard(await requireUser(), 'item', str(fd, 'id'));
  if (fromLarkListing(str(fd, 'id'))) throw new Error(LARK_LISTING_READONLY);
  // KOC đã có job: bỏ khỏi đợt làm job mất liên kết, thêm lại thì "Tạo job" tạo job lần nữa.
  if (await db.job.count({ where: { listingItemId: str(fd, 'id') } })) throw new Error('KOC đã có job trong đợt này, không bỏ khỏi đợt được. Huỷ job nếu không book nữa.');
  const item = await db.listingItem.delete({ where: { id: str(fd, 'id') } });
  revalidatePath(`/listing/${item.batchId}`);
  redirect(`/listing/${item.batchId}`);
}

// Sửa nhanh một ô trong bảng listing. Chỉ các trường dưới đây; giá trị kiểm như form đầy đủ.
const LIST_FIELDS: Record<string, string[]> = { status: CONTACT_STATUS, recommendation: RECOMMEND, brandChoice: BRAND_CHOICE };
export async function setItemField(fd: FormData) {
  await guard(await requireUser(), 'item', str(fd, 'id'));
  if (fromLarkListing(str(fd, 'id'))) return;
  const field = str(fd, 'field');
  const v = str(fd, 'value');
  let value: string | number | Date | null;
  if (LIST_FIELDS[field]) value = oneOf(LIST_FIELDS[field], v);
  else if (field === 'price' || field === 'viewTarget') {
    const n = optInt(fd, 'value');
    if (Number.isNaN(n)) return;
    value = n;
  } else if (field === 'contentNote' || field === 'rejectReason') value = v.slice(0, 1000) || null;
  else if (field === 'planAirDate') value = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+07:00`) : null;
  else return;
  const item = await db.listingItem.update({ where: { id: str(fd, 'id') }, data: { [field]: value } });
  revalidatePath(`/listing/${item.batchId}`);
}

// Link cho Brand tự chọn Yes / No / Cân nhắc mà không cần tài khoản. Ai có link đều xem được → thu hồi khi xong.
export async function createShare(fd: FormData) {
  await guard(await requireUser(), 'listing', str(fd, 'id'));
  if (fromLarkListing(str(fd, 'id'))) return;
  const b = await db.listingBatch.update({ where: { id: str(fd, 'id') }, data: { shareToken: randomBytes(18).toString('base64url') } });
  revalidatePath(`/listing/${b.id}`);
}

export async function revokeShare(fd: FormData) {
  await guard(await requireUser(), 'listing', str(fd, 'id'));
  const b = await db.listingBatch.update({ where: { id: str(fd, 'id') }, data: { shareToken: null } });
  revalidatePath(`/listing/${b.id}`);
}

/** Nút "Đồng bộ ngay" ở tab Listing: chạy sau khi trả trang, chặn bấm dồn 2 phút. */
export async function syncListingsNow() {
  await requireUser();
  after(() => runOnce('listings', 2, syncListingsJob));
  revalidatePath('/listing');
}

// ---- Google Sheet của brand (G1 đẩy listing, G2 lấy kết quả duyệt). Tab trong sheet đặt theo tên đợt.
const tabOf = (name: string) => name.replace(/[\[\]:*?/\\]/g, ' ').slice(0, 90);
const back = (id: string, k: 'msg' | 'err', text: string): never => redirect(`/listing/${id}?${k}=${encodeURIComponent(text)}`);
const errText = (e: unknown) => (e instanceof Error ? e.message : 'Lỗi không rõ');

/** G1: ghi đè tab của đợt trên Google Sheet bằng các cột gửi Brand (không có thông tin cá nhân, không có KOC blacklist). */
export async function pushToSheet(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  await guard(me, 'listing', id);
  if (fromLarkListing(id)) back(id, 'err', LARK_LISTING_READONLY);
  const first = await db.listingBatch.findUnique({ where: { id } });
  if (!first) return back(id, 'err', 'Không có đợt listing này');
  const sheetId = sheetIdOf(str(fd, 'sheetUrl') || first.sheetUrl || '');
  if (!sheetId) back(id, 'err', 'Dán link Google Sheet của brand (https://docs.google.com/spreadsheets/d/...).');
  // Đẩy lại là ghi đè cả tab: lấy lựa chọn brand đã điền trên sheet về app trước, để không mất phần brand đã duyệt.
  try { await applySheetDecisions(id, sheetId!); } catch { /* tab chưa có / chưa chia sẻ: lỗi sẽ báo ở bước ghi bên dưới */ }
  const data = (await loadListing(id))!;
  const { batch } = data;
  const cols = COLS.filter((c) => !c.personal);
  const fixed: Record<string, string | null> = { 'Đợt listing': batch.name, Store: batch.store, 'Sản phẩm': batch.product, CR: batch.cr == null ? '' : fmtPct(batch.cr) };
  const rows = data.rows.filter((r) => !r.koc.blacklisted);
  try {
    await writeTab(sheetId!, tabOf(batch.name), [cols.map((c) => c.h), ...rows.map((r) => cols.map((c) => (c.h in fixed ? fixed[c.h] : c.v(r))))]);
  } catch (e) { back(id, 'err', errText(e)); }
  await db.listingBatch.update({ where: { id }, data: { sheetUrl: `https://docs.google.com/spreadsheets/d/${sheetId}`, sheetAt: new Date() } });
  revalidatePath(`/listing/${id}`);
  back(id, 'msg', `Đã đẩy ${rows.length} KOC sang Google Sheet, tab "${tabOf(batch.name)}".`);
}

/** Chữ brand gõ trên sheet → Yes / No / Cân nhắc (như bản b2c). Không nhận ra → null. */
function choiceOf(raw: string) {
  const v = raw.trim().toLowerCase();
  if (['yes', 'y', 'duyệt', 'đã duyệt', 'ok', 'đồng ý', 'dong y'].includes(v)) return 'Yes';
  if (['no', 'n', 'từ chối', 'không'].includes(v)) return 'No';
  return v.includes('cân nhắc') || v.includes('can nhac') || v === 'maybe' ? 'Cân nhắc' : null;
}

/** Đọc "Brand chọn" / "Lý do từ chối" trên tab của đợt, khớp dòng theo "ID kênh", ghi vào app. Trả số dòng đổi; null = tab chưa có cột cần đọc. */
async function applySheetDecisions(batchId: string, sheetId: string) {
  const batch = await db.listingBatch.findUniqueOrThrow({ where: { id: batchId }, include: { items: { include: { koc: { select: { handle: true } } } } } });
  const grid = await readTab(sheetId, tabOf(batch.name));
  const head = (grid[0] ?? []).map((h) => h.trim());
  const [iKey, iChoice, iReason] = ['ID kênh', 'Brand chọn', 'Lý do từ chối'].map((h) => head.indexOf(h));
  if (iKey < 0 || iChoice < 0) return null;
  const byHandle = new Map(batch.items.map((it) => [it.koc.handle, it]));
  const changes = grid.slice(1).flatMap((row) => {
    const it = byHandle.get((row[iKey] ?? '').trim().replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, '').replace(/^@/, '').toLowerCase());
    const choice = choiceOf(row[iChoice] ?? '');
    if (!it || !choice) return []; // ô Brand chọn trống / không nhận ra: giữ nguyên trong app
    const rejectReason = (iReason < 0 ? '' : row[iReason] ?? '').trim().slice(0, 500) || null;
    return choice === it.brandChoice && rejectReason === it.rejectReason ? [] : [db.listingItem.update({ where: { id: it.id }, data: { brandChoice: choice, rejectReason } })];
  });
  if (changes.length) await db.$transaction(changes);
  return changes.length;
}

/** G2: lấy kết quả duyệt của brand từ Google Sheet. */
export async function pullFromSheet(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  await guard(me, 'listing', id);
  if (fromLarkListing(id)) back(id, 'err', LARK_LISTING_READONLY);
  const sheetId = sheetIdOf((await db.listingBatch.findUniqueOrThrow({ where: { id } })).sheetUrl ?? '');
  if (!sheetId) back(id, 'err', 'Đợt này chưa đẩy sang Google Sheet.');
  let n: number | null = 0;
  try { n = await applySheetDecisions(id, sheetId!); } catch (e) { back(id, 'err', errText(e)); }
  if (n == null) back(id, 'err', 'Sheet thiếu cột "ID kênh" hoặc "Brand chọn" ở dòng tiêu đề. Đẩy lại listing để tạo lại tab.');
  revalidatePath(`/listing/${id}`);
  back(id, 'msg', n ? `Đã cập nhật kết quả duyệt của ${n} KOC từ Google Sheet.` : 'Google Sheet chưa có thay đổi nào so với app.');
}

/** L6: gửi mail mời hợp tác cho KOC trong đợt có email và chưa được mời (KOC blacklist, KOC brand đã từ chối thì bỏ qua). */
export async function inviteKocs(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  await guard(me, 'listing', id);
  if (fromLarkListing(id)) back(id, 'err', LARK_LISTING_READONLY);
  const batch = await db.listingBatch.findUniqueOrThrow({
    where: { id },
    include: { items: { where: { invitedAt: null, brandChoice: { not: 'No' }, koc: { blacklisted: false, email: { not: null } } }, include: { koc: true } } },
  });
  if (!batch.items.length) back(id, 'err', 'Không có KOC nào để mời: KOC cần có email trong Danh bạ và chưa được gửi mail mời.');
  let send: Awaited<ReturnType<typeof mailer>>;
  try { send = await mailer(); } catch (e) { return back(id, 'err', errText(e)); }
  const tpl = await inviteTemplate();
  const [y, m] = batch.month.split('-');
  let sent = 0;
  const failed: string[] = [];
  for (const it of batch.items) {
    const k = it.koc;
    const vars = {
      ten_koc: k.nickname ?? k.name, id_kenh: `@${k.handle}`, link_kenh: k.channelUrl ?? `https://www.tiktok.com/@${k.handle}`,
      thuong_hieu: batch.brand ?? '', gian_hang: batch.store ?? batch.brand ?? '', san_pham: batch.product ?? '', loai_gia: it.priceType,
      thang_chien_dich: `${m}/${y}`, dot_booking: batch.name,
      muc_cat_xe: it.price ? `${fmtNum(it.price)} VNĐ (giá net nhận về)` : 'Trao đổi chi tiết theo ratecard kênh',
      ngay_air_du_kien: it.planAirDate ? it.planAirDate.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : 'sẽ thống nhất sau',
      ten_pic: me.name ?? 'Team Booking UpBase', email_pic: me.email ?? '', ghi_chu_rieng: it.contentNote ? `- Ghi chú: ${it.contentNote}` : '',
    };
    try {
      await send(k.email!, render(tpl.subject, vars), render(tpl.body, vars), me.email);
      // Ghi ngay từng dòng: lượt gửi đứt giữa chừng thì bấm lại không gửi trùng người đã nhận.
      await db.listingItem.update({ where: { id: it.id }, data: { invitedAt: new Date(), status: it.status ?? 'Đang liên hệ' } });
      sent++;
    } catch (e) { failed.push(`@${k.handle} (${errText(e).slice(0, 80)})`); }
  }
  revalidatePath(`/listing/${id}`);
  back(id, failed.length ? 'err' : 'msg', `Đã gửi mail mời ${sent}/${batch.items.length} KOC.${failed.length ? ` Lỗi: ${failed.slice(0, 5).join('; ')}` : ''}`);
}
