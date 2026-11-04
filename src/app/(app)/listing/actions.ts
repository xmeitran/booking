'use server';
import { randomBytes } from 'node:crypto';
import { after } from 'next/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { refreshKoc } from '@/lib/creatorStats';
import { db } from '@/lib/db';
import { optInt, str } from '@/lib/form';
import { BRAND_CHOICE, CONTACT_STATUS, parseHandle, PRICE_TYPES, RECOMMEND } from '@/lib/listing';
import { requireUser } from '@/lib/session';

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
  const name = str(fd, 'name');
  const month = str(fd, 'month');
  const cr = optPercent(fd, 'cr');
  const aov = optInt(fd, 'aov');
  if (!name) return 'Nhập tên đợt listing.';
  if (!/^\d{4}-\d{2}$/.test(month)) return 'Chọn tháng.';
  if (Number.isNaN(cr)) return 'CR là phần trăm từ 0 tới 100.';
  if (Number.isNaN(aov)) return 'AOV phải là số nguyên ≥ 0.';
  const data = { name, month, cr, aov, brand: str(fd, 'brand') || null, store: str(fd, 'store') || null, product: str(fd, 'product') || null };
  const batch = id
    ? await db.listingBatch.update({ where: { id }, data })
    : await db.listingBatch.create({ data: { ...data, createdById: me.id } });
  revalidatePath('/listing');
  redirect(`/listing/${batch.id}`);
}

export async function deleteBatch(fd: FormData) {
  const me = await requireUser();
  const batch = await db.listingBatch.findUniqueOrThrow({ where: { id: str(fd, 'id') } });
  if (me.role === 'STAFF' && batch.createdById !== me.id) throw new Error('Chỉ người tạo, Leader hoặc Admin được xoá đợt listing.');
  await db.listingBatch.delete({ where: { id: batch.id } });
  revalidatePath('/listing');
  redirect('/listing');
}

/** Dán một hoặc nhiều ID kênh / link TikTok (mỗi dòng một kênh). Kênh chưa có trong Danh bạ thì tạo mới. */
export async function addKocs(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const batchId = str(fd, 'batchId');
  const priceType = oneOf(PRICE_TYPES, str(fd, 'priceType')) ?? 'Video';
  const lines = str(fd, 'ids').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return 'Nhập ID kênh hoặc link TikTok.';
  const bad = lines.filter((l) => !parseHandle(l));
  if (bad.length) return `ID kênh không hợp lệ: ${bad.slice(0, 5).join(', ')}`;
  const handles = [...new Set(lines.map((l) => parseHandle(l)!))];

  const existing = await db.koc.findMany({ where: { platform: 'TikTok', handle: { in: handles } } });
  const known = new Set(existing.map((k) => k.handle));
  await db.koc.createMany({
    data: handles.filter((h) => !known.has(h)).map((h) => ({ platform: 'TikTok', handle: h, name: h, channelUrl: `https://www.tiktok.com/@${h}` })),
    skipDuplicates: true,
  });
  const kocs = await db.koc.findMany({ where: { platform: 'TikTok', handle: { in: handles } } });
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
  await requireUser();
  const id = str(fd, 'id');
  const price = optInt(fd, 'price');
  const viewTarget = optInt(fd, 'viewTarget');
  const planAirDate = str(fd, 'planAirDate');
  if (Number.isNaN(price) || Number.isNaN(viewTarget)) return 'Giá và View Target phải là số nguyên ≥ 0.';
  const item = await db.listingItem.update({
    where: { id },
    data: {
      priceType: oneOf(PRICE_TYPES, str(fd, 'priceType')) ?? 'Video',
      price, viewTarget,
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
  await requireUser();
  const item = await db.listingItem.delete({ where: { id: str(fd, 'id') } });
  revalidatePath(`/listing/${item.batchId}`);
  redirect(`/listing/${item.batchId}`);
}

// Sửa nhanh một ô trong bảng listing. Chỉ các trường dưới đây; giá trị kiểm như form đầy đủ.
const LIST_FIELDS: Record<string, string[]> = { status: CONTACT_STATUS, recommendation: RECOMMEND, brandChoice: BRAND_CHOICE };
export async function setItemField(fd: FormData) {
  await requireUser();
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
  await requireUser();
  const b = await db.listingBatch.update({ where: { id: str(fd, 'id') }, data: { shareToken: randomBytes(18).toString('base64url') } });
  revalidatePath(`/listing/${b.id}`);
}

export async function revokeShare(fd: FormData) {
  await requireUser();
  const b = await db.listingBatch.update({ where: { id: str(fd, 'id') }, data: { shareToken: null } });
  revalidatePath(`/listing/${b.id}`);
}
