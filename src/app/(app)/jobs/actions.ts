'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { audit, checklistOf } from '@/lib/catalog';
import { db } from '@/lib/db';
import { optInt, str } from '@/lib/form';
import { CANCELLED, RESULTS, SAMPLE, STAGES, type ReviewItem } from '@/lib/jobs';
import { PRICE_TYPES, sameBrand } from '@/lib/listing';
import { requireUser } from '@/lib/session';

const vnDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00+07:00`) : null);
const done = (id: string) => {
  revalidatePath('/jobs');
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}`);
};

/** Tạo job cho mọi KOC Brand chọn "Yes" trong một đợt listing (chưa có job). Brand, sản phẩm khớp Danh mục theo tên. */
export async function createJobsFromListing(fd: FormData) {
  const me = await requireUser();
  const batch = await db.listingBatch.findUniqueOrThrow({ where: { id: str(fd, 'batchId') }, include: { items: { where: { brandChoice: 'Yes', job: null } } } });
  const brands = await db.brand.findMany({ include: { products: true, members: { where: { role: 'Booking PIC' } } } });
  const brand = brands.find((b) => sameBrand(b.name, batch.brand));
  const product = brand?.products.find((p) => sameBrand(p.name, batch.product));
  const line = batch.planLineId ? await db.planLine.findUnique({ where: { id: batch.planLineId } }) : null;
  const picId = line?.picId ?? brand?.members[0]?.userId ?? me.id;
  for (const it of batch.items) {
    const job = await db.job.create({
      data: {
        kocId: it.kocId, listingItemId: it.id, brandId: brand?.id ?? null, productId: product?.id ?? null, planLineId: line?.id ?? null,
        picId, priceType: it.priceType, price: it.price, deadline: it.planAirDate, sample: 'Cần gửi', createdById: me.id,
        note: it.contentNote,
      },
    });
    await audit(me.id, 'Job', job.id, 'Tạo từ listing', { batchId: batch.id });
  }
  revalidatePath(`/listing/${batch.id}`);
  redirect(`/jobs?batch=${batch.id}`);
}

export async function updateJob(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const id = str(fd, 'id');
  const price = optInt(fd, 'price');
  const submittedUrl = str(fd, 'submittedUrl');
  if (Number.isNaN(price)) return 'Giá là số nguyên ≥ 0.';
  if (submittedUrl && !/^https?:\/\//i.test(submittedUrl)) return 'Link video phải bắt đầu bằng http(s)://';
  const before = await db.job.findUniqueOrThrow({ where: { id } });
  const data = {
    price,
    priceType: PRICE_TYPES.includes(str(fd, 'priceType')) ? str(fd, 'priceType') : before.priceType,
    deadline: vnDate(str(fd, 'deadline')),
    sample: SAMPLE.includes(str(fd, 'sample')) ? str(fd, 'sample') : null,
    picId: str(fd, 'picId') || null,
    productId: str(fd, 'productId') || null,
    note: str(fd, 'note') || null,
    submittedUrl: submittedUrl || null,
    // Nộp link lần đầu / link mới: ghi giờ nộp, chuyển "Đã nộp" nếu đang ở các bước trước.
    ...(submittedUrl && submittedUrl !== before.submittedUrl
      ? { submittedAt: new Date(), ...(STAGES.indexOf(before.stage as never) < STAGES.indexOf('Đã nộp') ? { stage: 'Đã nộp' } : {}) }
      : {}),
  };
  await db.job.update({ where: { id }, data });
  await audit(me.id, 'Job', id, 'Sửa', { ...data, deadline: data.deadline?.toISOString() ?? null, submittedAt: undefined });
  done(id);
  return null;
}

export async function saveBrief(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  const approve = str(fd, 'approve') === '1';
  await db.job.update({ where: { id }, data: { brief: str(fd, 'brief') || null, briefApproved: approve } });
  await audit(me.id, 'Job', id, approve ? 'Duyệt brief' : 'Sửa brief');
  done(id);
}

/** Chuyển chặng. "Đã nộp" cần link video; "Nghiệm thu" cần nghiệm thu Đạt; "Thanh toán" chỉ qua đề nghị thanh toán. */
export async function moveStage(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  const stage = str(fd, 'stage');
  const job = await db.job.findUniqueOrThrow({ where: { id } });
  const ok = (STAGES as readonly string[]).includes(stage) || stage === CANCELLED;
  const why = !ok ? 'Chặng không hợp lệ'
    : stage === 'Đã nộp' && !job.submittedUrl ? 'Nhập link video KOC nộp trước'
    : stage === 'Nghiệm thu' && job.reviewResult !== 'Đạt' ? 'Nghiệm thu chưa Đạt'
    : stage === 'Thanh toán' && !job.paymentId ? 'Tạo đề nghị thanh toán để chuyển sang Thanh toán'
    : null;
  if (why) redirect(`/jobs/${id}?err=${encodeURIComponent(why)}`);
  await db.job.update({ where: { id }, data: { stage } });
  await audit(me.id, 'Job', id, `Chuyển ${job.stage} → ${stage}`);
  done(id);
}

/** Nghiệm thu theo checklist của brand: mỗi tiêu chí Đạt / Cần sửa / Không đạt + mốc thời gian trong video làm bằng chứng. */
export async function reviewJob(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  const job = await db.job.findUniqueOrThrow({ where: { id }, include: { brand: true } });
  const items: ReviewItem[] = checklistOf(job.brand?.checklist).map((item, i) => ({
    item,
    result: (RESULTS as readonly string[]).includes(str(fd, `r${i}`)) ? (str(fd, `r${i}`) as ReviewItem['result']) : '',
    at: str(fd, `t${i}`).slice(0, 20),
    note: str(fd, `n${i}`).slice(0, 300),
  }));
  if (items.some((x) => !x.result)) redirect(`/jobs/${id}?err=${encodeURIComponent('Chấm đủ mọi tiêu chí trước khi xác nhận')}#review`);
  const result = items.some((x) => x.result === 'Không đạt') ? 'Không đạt' : items.some((x) => x.result === 'Cần sửa') ? 'Cần sửa' : 'Đạt';
  await db.job.update({
    where: { id },
    data: {
      review: items, reviewResult: result, reviewNote: str(fd, 'reviewNote') || null, reviewedById: me.id, reviewedAt: new Date(),
      // Đạt → chờ đề nghị thanh toán. Chưa đạt → trả về "Đang quay" để KOC sửa và nộp lại.
      stage: result === 'Đạt' ? 'Nghiệm thu' : 'Đang quay',
    },
  });
  await audit(me.id, 'Job', id, `Nghiệm thu: ${result}`, { items, link: job.submittedUrl });
  done(id);
}

export async function draftBrief(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  const j = await db.job.findUniqueOrThrow({ where: { id }, include: { koc: true, brand: true, product: true } });
  const { briefTemplate } = await import('@/lib/jobs');
  await db.job.update({ where: { id }, data: { brief: briefTemplate(j, checklistOf(j.brand?.checklist)), briefApproved: false } });
  await audit(me.id, 'Job', id, 'Tạo brief nháp');
  done(id);
}
