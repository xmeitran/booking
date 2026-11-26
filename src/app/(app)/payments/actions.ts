'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { audit } from '@/lib/booking/catalog';
import { db } from '@/lib/db';
import { str } from '@/lib/form';
import { PAY_STATUS } from '@/lib/booking/payments';
import { guard, jobScope, scopeOf } from '@/lib/auth/scope';
import { can, requireUser } from '@/lib/auth/session';
import { approvalStatus, sendApproval } from '@/lib/lark/approval';
import { jobCode } from '@/lib/booking/jobs';
import { FEE_DIVISOR } from '@/lib/koc/kocInsights';

/** Gom job nghiệm thu Đạt (chưa vào ĐNTT nào) thành một đề nghị thanh toán; job chuyển sang "Thanh toán". */
export async function createPayment(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const ids = [...new Set(fd.getAll('jobId').map(String))];
  if (!ids.length) return 'Tick chọn ít nhất một job.';
  const ready = { id: { in: ids }, stage: 'Nghiệm thu', reviewResult: 'Đạt', paymentId: null, AND: [jobScope(await scopeOf(me))] };
  const jobs = await db.job.findMany({ where: ready });
  const stale = 'Có job chưa nghiệm thu Đạt hoặc đã nằm trong ĐNTT khác. Tải lại trang.';
  if (jobs.length !== ids.length) return stale;
  if (jobs.some((j) => j.price == null)) return 'Có job chưa nhập giá. Nhập giá trong job trước khi đề nghị thanh toán.';
  // Hai người gom cùng job một lúc: chỉ một ĐNTT lấy được job, ĐNTT kia huỷ (không để ĐNTT rỗng / job bị giành).
  let p;
  try {
    p = await db.$transaction(async (tx) => {
      const created = await tx.paymentRequest.create({ data: { createdById: me.id, note: str(fd, 'note') || null } });
      const { count } = await tx.job.updateMany({ where: ready, data: { paymentId: created.id, stage: 'Thanh toán' } });
      if (count !== ids.length) throw new Error(stale);
      return created;
    });
  } catch (e) {
    if (e instanceof Error && e.message === stale) return stale;
    throw e;
  }
  for (const id of ids) await audit(me.id, 'Job', id, `Vào ĐNTT #${p.number}`);
  await audit(me.id, 'PaymentRequest', p.id, 'Tạo', { jobs: ids.length });
  revalidatePath('/payments');
  redirect(`/payments/${p.id}`);
}

export async function setPaymentStatus(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  await guard(me, 'payment', id);
  const status = str(fd, 'status');
  if (!PAY_STATUS.includes(status)) redirect(`/payments/${id}`);
  // Chỉ đi tiếp đúng một bước: không cho kéo ĐNTT đã duyệt / đã trả về Nháp (rồi xoá, gom lại → trả tiền hai lần).
  const p = await db.paymentRequest.findUniqueOrThrow({ where: { id } });
  if (PAY_STATUS.indexOf(status) !== PAY_STATUS.indexOf(p.status) + 1) redirect(`/payments/${id}?err=${encodeURIComponent(`ĐNTT đang "${p.status}", không chuyển sang "${status}" được`)}`);
  // Duyệt / xác nhận đã trả: chỉ Admin, Leader.
  if ((status === 'Đã duyệt' || status === 'Đã thanh toán') && !can(me, 'payment.approve')) redirect(`/payments/${id}?err=${encodeURIComponent('Bạn chưa có quyền duyệt hoặc xác nhận đã thanh toán. Nhờ Admin cấp quyền ở Phân quyền.')}`);
  await db.paymentRequest.update({ where: { id }, data: { status } });
  await audit(me.id, 'PaymentRequest', id, `Trạng thái: ${status}`);
  revalidatePath(`/payments/${id}`);
  redirect(`/payments/${id}`);
}

/** Bỏ một job khỏi ĐNTT còn Nháp: job về "Nghiệm thu" để gom lại sau. */
export async function removeFromPayment(fd: FormData) {
  const me = await requireUser();
  await guard(me, 'job', str(fd, 'jobId'));
  const job = await db.job.findUniqueOrThrow({ where: { id: str(fd, 'jobId') }, include: { payment: true } });
  if (job.payment?.status === 'Nháp') {
    await db.job.update({ where: { id: job.id }, data: { paymentId: null, stage: 'Nghiệm thu' } });
    await audit(me.id, 'Job', job.id, `Bỏ khỏi ĐNTT #${job.payment.number}`);
  }
  revalidatePath(`/payments/${job.paymentId}`);
  redirect(`/payments/${job.paymentId}`);
}

/** Xoá ĐNTT còn Nháp: các job về "Nghiệm thu" để gom lại. */
export async function deletePayment(fd: FormData) {
  const me = await requireUser();
  await guard(me, 'payment', str(fd, 'id'));
  const p = await db.paymentRequest.findUniqueOrThrow({ where: { id: str(fd, 'id') } });
  if (p.status !== 'Nháp') redirect(`/payments/${p.id}?err=${encodeURIComponent('Chỉ xoá được ĐNTT còn Nháp')}`);
  await db.job.updateMany({ where: { paymentId: p.id }, data: { paymentId: null, stage: 'Nghiệm thu' } });
  await db.paymentRequest.delete({ where: { id: p.id } });
  await audit(me.id, 'PaymentRequest', p.id, `Xoá ĐNTT #${p.number}`);
  revalidatePath('/payments');
  redirect('/payments');
}

const fail = (id: string, e: unknown): never => redirect(`/payments/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : 'Có lỗi, thử lại sau')}`);

/** L4: gửi ĐNTT còn Nháp sang Lark Approval, đứng tên người bấm. Thành công thì ĐNTT sang "Đã gửi duyệt". */
export async function sendToApproval(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  await guard(me, 'payment', id);
  const p = await db.paymentRequest.findUniqueOrThrow({ where: { id }, include: { jobs: { include: { koc: true, brand: { select: { name: true } } }, orderBy: { number: 'asc' } } } });
  if (p.status !== 'Nháp' || p.approvalCode) fail(id, new Error('ĐNTT này đã gửi duyệt rồi.'));
  const noBank = p.jobs.filter((j) => !j.koc.bankAccount || !j.koc.bankHolder);
  if (noBank.length) fail(id, new Error(`Thiếu số tài khoản / chủ tài khoản của: ${[...new Set(noBank.map((j) => `@${j.koc.handle}`))].join(', ')}. Bổ sung ở Danh bạ trước khi gửi duyệt.`));
  const net = p.jobs.reduce((s, j) => s + (j.price ?? 0), 0);
  const kocs = [...new Map(p.jobs.map((j) => [j.kocId, j.koc])).values()];
  let code = '';
  try {
    code = await sendApproval(me.larkUserId, {
      code: `ĐNTT #${p.number}`, amount: net, gross: Math.round(net / FEE_DIVISOR),
      jobs: p.jobs.map((j) => `${jobCode(j.number)} · @${j.koc.handle} · ${j.brand?.name ?? '—'} · ${j.price ?? 0}`).join('\n'),
      koc: kocs.map((k) => k.nickname ?? k.name).join(', '),
      bank: kocs.map((k) => `${k.bankHolder} - ${k.bankAccount} - ${k.bankName ?? ''}`).join('\n'),
      note: p.note ?? '', creator: me.name ?? me.larkUserId,
    });
  } catch (e) { fail(id, e); }
  // Chỉ ghi khi ĐNTT vẫn còn Nháp và chưa có mã: hai người bấm cùng lúc thì một đơn Lark bị thừa, báo để huỷ tay.
  const { count } = await db.paymentRequest.updateMany({ where: { id, status: 'Nháp', approvalCode: null }, data: { status: 'Đã gửi duyệt', approvalCode: code, approvalStatus: 'PENDING' } });
  if (!count) fail(id, new Error(`ĐNTT vừa được người khác gửi duyệt. Đơn ${code} bạn vừa tạo trên Lark bị thừa, vào Lark huỷ đơn này.`));
  await audit(me.id, 'PaymentRequest', id, 'Gửi Lark Approval', { instance: code });
  revalidatePath(`/payments/${id}`);
  redirect(`/payments/${id}`);
}

/** L5: đọc trạng thái đơn trên Lark. APPROVED → "Đã duyệt"; bị từ chối / huỷ → về Nháp để sửa và gửi lại. */
export async function syncApproval(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  await guard(me, 'payment', id);
  const p = await db.paymentRequest.findUniqueOrThrow({ where: { id } });
  if (!p.approvalCode) fail(id, new Error('ĐNTT này chưa gửi duyệt trên Lark.'));
  let st = '';
  try { st = await approvalStatus(p.approvalCode!); } catch (e) { fail(id, e); }
  const data = st === 'APPROVED' && p.status === 'Đã gửi duyệt' ? { status: 'Đã duyệt', approvalStatus: st }
    : ['REJECTED', 'CANCELED', 'DELETED'].includes(st) && p.status === 'Đã gửi duyệt' ? { status: 'Nháp', approvalStatus: st, approvalCode: null }
    : { approvalStatus: st };
  await db.paymentRequest.update({ where: { id }, data });
  if (data.status) await audit(me.id, 'PaymentRequest', id, `Lark Approval: ${st} → ${data.status}`, { instance: p.approvalCode });
  revalidatePath(`/payments/${id}`);
  redirect(`/payments/${id}`);
}
