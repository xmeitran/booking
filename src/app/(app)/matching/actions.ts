'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { refreshKoc } from '@/lib/creatorStats';
import { db } from '@/lib/db';
import { str } from '@/lib/form';
import { parseCriteria } from '@/lib/matching';
import { requireUser } from '@/lib/session';

export async function saveBrief(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const id = str(fd, 'id');
  const name = str(fd, 'name');
  if (!name) return 'Nhập tên.';
  const criteria = parseCriteria(fd);
  if (typeof criteria === 'string') return criteria;
  const template = str(fd, 'template') === '1';
  const opt = (k: string) => (template ? null : str(fd, k) || null);
  const data = {
    name, template, criteria, category: str(fd, 'category') || null, note: str(fd, 'note') || null,
    brand: opt('brand'), guideline: opt('guideline'), strategy: opt('strategy'), plan: opt('plan'),
  };
  const b = id ? await db.matchBrief.update({ where: { id }, data }) : await db.matchBrief.create({ data: { ...data, createdById: me.id } });
  revalidatePath('/matching');
  redirect(`/matching/${b.id}`);
}

export async function deleteBrief(fd: FormData) {
  const me = await requireUser();
  const b = await db.matchBrief.findUniqueOrThrow({ where: { id: str(fd, 'id') } });
  if (me.role === 'STAFF' && b.createdById !== me.id) throw new Error('Chỉ người tạo, Leader hoặc Admin được xoá.');
  await db.matchBrief.delete({ where: { id: b.id } });
  revalidatePath('/matching');
  redirect('/matching');
}

/** KOC đã chọn trong danh sách khớp → đợt listing có sẵn hoặc đợt mới (brand lấy từ brief). */
export async function addMatchesToListing(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const kocIds = [...new Set(fd.getAll('kocId').map(String))];
  if (!kocIds.length) return 'Tick chọn ít nhất một KOC.';
  let batchId = str(fd, 'batchId');
  if (batchId === 'new') {
    const name = str(fd, 'newName');
    const month = str(fd, 'month');
    if (!name) return 'Nhập tên đợt listing mới.';
    if (!/^\d{4}-\d{2}$/.test(month)) return 'Chọn tháng cho đợt mới.';
    const brief = await db.matchBrief.findUnique({ where: { id: str(fd, 'briefId') }, select: { brand: true } });
    batchId = (await db.listingBatch.create({ data: { name, month, brand: brief?.brand ?? null, createdById: me.id } })).id;
  } else if (!batchId) return 'Chọn đợt listing.';
  await db.listingItem.createMany({ data: kocIds.map((kocId) => ({ batchId, kocId, createdById: me.id, priceType: 'Video' })), skipDuplicates: true });
  // KOL chưa có số TikTok: tra vài kênh đầu ngay sau khi trả trang, còn lại để lượt mỗi giờ.
  const fresh = await db.koc.findMany({ where: { id: { in: kocIds }, ttsCheckedAt: null }, select: { id: true }, take: 3 });
  if (fresh.length) after(async () => { for (const k of fresh) await refreshKoc(k.id).catch(() => {}); });
  revalidatePath(`/listing/${batchId}`);
  redirect(`/listing/${batchId}`);
}
