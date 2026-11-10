'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { audit, checklistOf } from '@/lib/catalog';
import { db } from '@/lib/db';
import { optInt, str } from '@/lib/form';
import { CANCELLED, linePicker, RESULTS, SAMPLE, STAGES, type ReviewItem } from '@/lib/jobs';
import { fromLarkListing, LARK_LISTING_READONLY, PRICE_TYPES, sameBrand } from '@/lib/listing';
import { guard } from '@/lib/scope';
import { requirePerm, requireUser } from '@/lib/session';

const vnDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00+07:00`) : null);
const done = (id: string) => {
  revalidatePath('/jobs');
  revalidatePath(`/jobs/${id}`);
  redirect(`/jobs/${id}`);
};

/** Tạo job cho mọi KOC Brand chọn "Yes" trong một đợt listing (chưa có job). Brand, sản phẩm khớp Danh mục theo tên. */
export async function createJobsFromListing(fd: FormData) {
  const me = await requireUser();
  await guard(me, 'listing', str(fd, 'batchId'));
  if (fromLarkListing(str(fd, 'batchId'))) throw new Error(LARK_LISTING_READONLY); // Lark tạo BO cho đợt này
  // KOC blacklist không tạo job dù Brand đã chọn.
  const batch = await db.listingBatch.findUniqueOrThrow({
    where: { id: str(fd, 'batchId') },
    include: { items: { where: { brandChoice: 'Yes', koc: { blacklisted: false } }, include: { koc: { select: { kl: true, klAuto: true } }, _count: { select: { jobs: true } } } } },
  });
  const brands = await db.brand.findMany({ include: { products: true, members: { where: { role: 'Booking PIC' } } } });
  const line = batch.planLineId ? await db.planLine.findUnique({ where: { id: batch.planLineId } }) : null;
  // Đợt mở từ dòng plan: brand theo dòng plan (đợt có thể không ghi tên brand); không thì khớp theo tên brand của đợt.
  const brand = brands.find((b) => b.id === line?.brandId) ?? brands.find((b) => sameBrand(b.name, batch.brand));
  const product = brand?.products.find((p) => p.id === line?.productId) ?? brand?.products.find((p) => sameBrand(p.name, batch.product));
  // Mỗi job gắn vào dòng plan cùng brand + cùng loại content + cùng tier KOC, lấp dòng tuần sớm nhất còn thiếu (đầy hết thì dòng tuần cuối);
  // cùng tuần thì ưu tiên dòng mở matching (plan Lark: nhiều gian hàng một brand, không chia tuần).
  // Không có dòng nào khớp tier: job không gắn dòng (ngoài plan), tab Plan báo riêng.
  const lines = line && brand
    ? (await db.planLine.findMany({
        where: { planId: line.planId, brandId: brand.id, contentType: line.contentType },
        orderBy: [{ week: 'asc' }, { id: 'asc' }],
        include: { _count: { select: { jobs: { where: { stage: { not: CANCELLED } } } } } },
      })).sort((a, b) => (a.week ?? 99) - (b.week ?? 99) || Number(b.id === line.id) - Number(a.id === line.id))
    : [];
  const pickLine = linePicker(lines.map((l) => ({ ...l, used: l._count.jobs })));
  // Khoá đợt rồi đếm lại job trong transaction: hai người bấm "Tạo job" cùng lúc (hai tab, bấm đúp trước khi trang tải xong)
  // không tạo job gấp đôi.
  const created = await db.$transaction(async (tx) => {
    await tx.$queryRaw`select id from "ListingBatch" where id = ${batch.id} for update`;
    const has = new Map((await tx.job.groupBy({ by: ['listingItemId'], where: { listingItemId: { in: batch.items.map((i) => i.id) } }, _count: true }))
      .map((g) => [g.listingItemId, g._count]));
    const out: { id: string; planLineId: string | null }[] = [];
    for (const it of batch.items) {
      for (let n = has.get(it.id) ?? 0; n < it.videos; n++) {
        const l = line ? pickLine(it.koc.kl ?? it.koc.klAuto) : null;
        out.push(await tx.job.create({
          data: {
            kocId: it.kocId, listingItemId: it.id, brandId: brand?.id ?? null, productId: product?.id ?? null, planLineId: l?.id ?? null,
            picId: l?.picId ?? brand?.members[0]?.userId ?? me.id, priceType: it.priceType, price: it.price,
            deadline: n === 0 ? it.planAirDate : null, sample: 'Cần gửi', createdById: me.id,
            note: [it.videos > 1 && `Video ${n + 1}/${it.videos}`, it.contentNote].filter(Boolean).join(' · ') || null,
          },
          select: { id: true, planLineId: true },
        }));
      }
    }
    return out;
  }, { timeout: 60_000 });
  for (const j of created) await audit(me.id, 'Job', j.id, 'Tạo từ listing', { batchId: batch.id, planLineId: j.planLineId });
  revalidatePath(`/listing/${batch.id}`);
  redirect(`/jobs?batch=${batch.id}`);
}

export async function updateJob(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const id = str(fd, 'id');
  await guard(me, 'job', id);
  const price = optInt(fd, 'price');
  const submittedUrl = str(fd, 'submittedUrl');
  if (Number.isNaN(price)) return 'Giá là số nguyên ≥ 0.';
  if (submittedUrl && !/^https?:\/\//i.test(submittedUrl)) return 'Link video phải bắt đầu bằng http(s)://';
  const before = await db.job.findUniqueOrThrow({ where: { id }, include: { payment: { select: { number: true, status: true } } } });
  const priceType = PRICE_TYPES.includes(str(fd, 'priceType')) ? str(fd, 'priceType') : before.priceType;
  const newLink = Boolean(submittedUrl) && submittedUrl !== before.submittedUrl;
  // Job đã vào ĐNTT: link đã nghiệm thu không đổi; giá chỉ sửa khi ĐNTT còn Nháp (đã gửi duyệt / đã duyệt thì số tiền phải giữ nguyên).
  if (before.payment && (newLink || (!submittedUrl && before.submittedUrl))) return `Job đã nằm trong ĐNTT #${before.payment.number}, không đổi link video được.`;
  if (before.payment && before.payment.status !== 'Nháp' && (price !== before.price || priceType !== before.priceType)) {
    return `ĐNTT #${before.payment.number} đang "${before.payment.status}", không sửa giá được.`;
  }
  const data = {
    price,
    priceType,
    deadline: vnDate(str(fd, 'deadline')),
    sample: SAMPLE.includes(str(fd, 'sample')) ? str(fd, 'sample') : null,
    picId: str(fd, 'picId') || null,
    productId: str(fd, 'productId') || null,
    note: str(fd, 'note') || null,
    submittedUrl: submittedUrl || null,
    // Nộp link lần đầu / link mới: ghi giờ nộp, chuyển "Đã nộp" (link mới sau khi đã nghiệm thu Đạt thì phải nghiệm thu lại).
    // Job đã huỷ giữ nguyên chặng.
    ...(newLink
      ? { submittedAt: new Date(), ...(before.stage !== CANCELLED && { stage: 'Đã nộp', ...(before.stage === 'Nghiệm thu' && { reviewResult: null }) }) }
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
  await guard(me, 'job', id);
  const approve = str(fd, 'approve') === '1';
  await db.job.update({ where: { id }, data: { brief: str(fd, 'brief') || null, briefApproved: approve } });
  await audit(me.id, 'Job', id, approve ? 'Duyệt brief' : 'Sửa brief');
  done(id);
}

/** Chuyển chặng. "Đã nộp" cần link video; "Nghiệm thu" cần nghiệm thu Đạt; "Thanh toán" chỉ qua đề nghị thanh toán. */
export async function moveStage(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  await guard(me, 'job', id);
  const stage = str(fd, 'stage');
  const job = await db.job.findUniqueOrThrow({ where: { id } });
  const ok = (STAGES as readonly string[]).includes(stage) || stage === CANCELLED;
  const why = !ok ? 'Chặng không hợp lệ'
    : job.paymentId ? 'Job đã nằm trong ĐNTT, bỏ khỏi ĐNTT (khi còn Nháp) trước khi đổi chặng'
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
  await guard(me, 'job', id);
  const job = await db.job.findUniqueOrThrow({ where: { id }, include: { brand: true } });
  const blocked = job.paymentId ? 'Job đã nằm trong ĐNTT, không nghiệm thu lại được' : job.stage === CANCELLED ? 'Job đã huỷ' : !job.submittedUrl ? 'KOC chưa nộp video' : null;
  if (blocked) redirect(`/jobs/${id}?err=${encodeURIComponent(blocked)}`);
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
  await guard(me, 'job', id);
  const j = await db.job.findUniqueOrThrow({ where: { id }, include: { koc: true, brand: true, product: true } });
  const { briefTemplate } = await import('@/lib/jobs');
  await db.job.update({ where: { id }, data: { brief: briefTemplate(j, checklistOf(j.brand?.checklist)), briefApproved: false } });
  await audit(me.id, 'Job', id, 'Tạo brief nháp');
  done(id);
}

/** Content Copilot: Claude viết brief nháp từ brand, sản phẩm, KOC, checklist; người dùng sửa và duyệt. */
export async function aiDraftBrief(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  await guard(me, 'job', id);
  const { aiBrief, aiEnabled } = await import('@/lib/ai');
  if (!aiEnabled()) redirect(`/jobs/${id}?err=${encodeURIComponent('Chưa cấu hình AI (biến ANTHROPIC_API_KEY trên Render).')}`);
  const j = await db.job.findUniqueOrThrow({ where: { id }, include: { koc: true, brand: true, product: true } });
  let brief: string;
  try {
    brief = await aiBrief({
      brand: j.brand?.name ?? null, brandUsp: j.brand?.usp ?? null, guideline: j.brand?.guideline ?? null,
      product: j.product?.name ?? null, productUsp: j.product?.usp ?? null, productLink: j.product?.link ?? null,
      koc: { handle: j.koc.handle, name: j.koc.nickname ?? j.koc.name, niche: j.koc.niche, tier: j.koc.kl ?? j.koc.klAuto, followers: j.koc.followers, avgViews: j.koc.avgViews },
      format: j.priceType, deadline: j.deadline?.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) ?? null, note: j.note,
      checklist: checklistOf(j.brand?.checklist),
    });
  } catch (e) {
    redirect(`/jobs/${id}?err=${encodeURIComponent(`AI chưa viết được brief: ${e instanceof Error ? e.message : String(e)}`)}`);
  }
  await db.job.update({ where: { id }, data: { brief, briefApproved: false } });
  await audit(me.id, 'Job', id, 'AI viết brief nháp');
  done(id);
}

/** Xoá job tạo nhầm: chỉ Admin, chỉ khi job chưa nằm trong đề nghị thanh toán. KOC ở listing có thể tạo job lại. */
export async function deleteJob(fd: FormData) {
  const me = await requirePerm('job.delete');
  const id = str(fd, 'id');
  await guard(me, 'job', id);
  const job = await db.job.findUniqueOrThrow({ where: { id } });
  if (job.paymentId) redirect(`/jobs/${id}?err=${encodeURIComponent('Job đã nằm trong ĐNTT, bỏ khỏi ĐNTT trước khi xoá')}`);
  await db.job.delete({ where: { id } });
  await audit(me.id, 'Job', id, 'Xoá job', { number: job.number, kocId: job.kocId });
  revalidatePath('/jobs');
  redirect('/jobs');
}
