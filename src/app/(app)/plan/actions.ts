'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { audit } from '@/lib/catalog';
import { runOnce } from '@/lib/cronJob';
import { db } from '@/lib/db';
import { optInt, str } from '@/lib/form';
import { fromLark, syncPlansJob } from '@/lib/planSync';
import { requireUser } from '@/lib/session';
import { KL_LEVELS } from '../contacts/platforms';

// Đồng bộ plan từ Lark Base ngay (chạy nền sau khi trả trang); cùng khoá với cron nên không chạy chồng.
export async function syncPlansNow() {
  await requireUser();
  after(() => runOnce('plans', 2, syncPlansJob));
  revalidatePath('/plan');
}

export async function savePlan(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser('ADMIN', 'LEADER');
  const id = str(fd, 'id');
  const name = str(fd, 'name');
  const month = str(fd, 'month');
  const budget = optInt(fd, 'budget');
  if (fromLark(id)) return 'Plan đồng bộ từ Lark Base, sửa trên Lark.';
  if (!name) return 'Nhập tên plan.';
  if (!/^\d{4}-\d{2}$/.test(month)) return 'Chọn tháng.';
  if (Number.isNaN(budget)) return 'Ngân sách là số nguyên ≥ 0.';
  const data = { name, month, budget, note: str(fd, 'note') || null };
  const p = id ? await db.plan.update({ where: { id }, data }) : await db.plan.create({ data: { ...data, createdById: me.id } });
  await audit(me.id, 'Plan', p.id, id ? 'Sửa' : 'Tạo', data);
  revalidatePath('/plan');
  redirect(`/plan/${p.id}`);
}

export async function deletePlan(fd: FormData) {
  const me = await requireUser('ADMIN', 'LEADER');
  const id = str(fd, 'id');
  if (fromLark(id)) return; // đồng bộ lại sẽ tạo lại, xoá chỉ làm job mất liên kết
  await db.plan.delete({ where: { id } });
  await audit(me.id, 'Plan', id, 'Xoá');
  revalidatePath('/plan');
  redirect('/plan');
}

export async function saveLine(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser('ADMIN', 'LEADER');
  const id = str(fd, 'id');
  const planId = str(fd, 'planId');
  const brandId = str(fd, 'brandId') || null;
  const week = optInt(fd, 'week');
  const quantity = optInt(fd, 'quantity');
  const budget = optInt(fd, 'budget');
  const tier = str(fd, 'tier');
  if (fromLark(id)) return 'Dòng đồng bộ từ Lark Base, sửa trên Lark.';
  if (!brandId) return 'Chọn brand.';
  if (Number.isNaN(week) || (week != null && (week < 1 || week > 5))) return 'Tuần từ 1 tới 5.';
  if (quantity == null || Number.isNaN(quantity)) return 'Nhập số KOC cần book (0 nếu dòng chỉ giữ ngân sách).';
  if (Number.isNaN(budget)) return 'Ngân sách là số nguyên ≥ 0.';
  if (!quantity && !budget) return 'Dòng plan cần số KOC hoặc ngân sách.';
  // PIC trống: lấy Booking PIC của brand (Danh mục → brand → Nhân sự phụ trách).
  const picId = str(fd, 'picId') || (await db.brandMember.findFirst({ where: { brandId, role: 'Booking PIC' } }))?.userId || null;
  const data = {
    planId, brandId, week, quantity, budget, picId,
    productId: str(fd, 'productId') || null,
    tier: KL_LEVELS.includes(tier) ? tier : null,
    contentType: str(fd, 'contentType') || 'Video',
    note: str(fd, 'note') || null,
  };
  const line = id ? await db.planLine.update({ where: { id }, data }) : await db.planLine.create({ data });
  await audit(me.id, 'PlanLine', line.id, id ? 'Sửa' : 'Tạo', { planId, brandId, quantity, budget });
  revalidatePath(`/plan/${planId}`);
  redirect(`/plan/${planId}`);
}

export async function removeLine(fd: FormData) {
  const me = await requireUser('ADMIN', 'LEADER');
  if (fromLark(str(fd, 'id'))) return;
  const line = await db.planLine.delete({ where: { id: str(fd, 'id') } });
  await audit(me.id, 'PlanLine', line.id, 'Xoá');
  revalidatePath(`/plan/${line.planId}`);
  redirect(`/plan/${line.planId}`);
}

/** Tạo yêu cầu matching từ dòng plan: brief theo brand, tiêu chí cấp KOL = tier của dòng. Đã có thì mở brief đó. */
export async function matchFromLine(fd: FormData) {
  const me = await requireUser();
  const line = await db.planLine.findUniqueOrThrow({ where: { id: str(fd, 'id') }, include: { plan: true, brand: true, product: true, briefs: { take: 1 } } });
  if (line.briefs[0]) redirect(`/matching/${line.briefs[0].id}`);
  const name = [line.brand?.name, line.product?.name, line.plan.name, line.week ? `Tuần ${line.week}` : null, line.tier, line.contentType].filter(Boolean).join(' · ');
  const brief = await db.matchBrief.create({
    data: {
      name, brand: line.brand?.name ?? null, brandId: line.brandId, planLineId: line.id, createdById: me.id,
      guideline: line.brand?.guideline ?? null,
      strategy: [line.product?.usp && `USP sản phẩm: ${line.product.usp}`, line.brand?.usp && `USP brand: ${line.brand.usp}`].filter(Boolean).join('\n') || null,
      plan: `${line.quantity} KOC · ${line.contentType}${line.week ? ` · tuần ${line.week} tháng ${line.plan.month.split('-').reverse().join('/')}` : ''}${line.budget ? ` · ngân sách ${line.budget.toLocaleString('vi-VN')} ₫` : ''}`,
      criteria: line.tier ? { kl: [line.tier] } : {},
    },
  });
  await audit(me.id, 'MatchBrief', brief.id, 'Tạo từ plan', { planLineId: line.id });
  redirect(`/matching/${brief.id}`);
}
