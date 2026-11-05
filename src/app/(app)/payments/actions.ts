'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { audit } from '@/lib/catalog';
import { db } from '@/lib/db';
import { str } from '@/lib/form';
import { PAY_STATUS } from '@/lib/payments';
import { requireUser } from '@/lib/session';

/** Gom job nghiệm thu Đạt (chưa vào ĐNTT nào) thành một đề nghị thanh toán; job chuyển sang "Thanh toán". */
export async function createPayment(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const ids = [...new Set(fd.getAll('jobId').map(String))];
  if (!ids.length) return 'Tick chọn ít nhất một job.';
  const jobs = await db.job.findMany({ where: { id: { in: ids }, stage: 'Nghiệm thu', reviewResult: 'Đạt', paymentId: null } });
  if (jobs.length !== ids.length) return 'Có job chưa nghiệm thu Đạt hoặc đã nằm trong ĐNTT khác. Tải lại trang.';
  const p = await db.paymentRequest.create({ data: { createdById: me.id, note: str(fd, 'note') || null } });
  await db.job.updateMany({ where: { id: { in: ids } }, data: { paymentId: p.id, stage: 'Thanh toán' } });
  for (const id of ids) await audit(me.id, 'Job', id, `Vào ĐNTT #${p.number}`);
  await audit(me.id, 'PaymentRequest', p.id, 'Tạo', { jobs: ids.length });
  revalidatePath('/payments');
  redirect(`/payments/${p.id}`);
}

export async function setPaymentStatus(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  const status = str(fd, 'status');
  if (!PAY_STATUS.includes(status)) redirect(`/payments/${id}`);
  // Duyệt / xác nhận đã trả: chỉ Admin, Leader.
  if ((status === 'Đã duyệt' || status === 'Đã thanh toán') && me.role === 'STAFF') redirect(`/payments/${id}?err=${encodeURIComponent('Chỉ Admin, Leader được duyệt / xác nhận đã thanh toán')}`);
  await db.paymentRequest.update({ where: { id }, data: { status } });
  await audit(me.id, 'PaymentRequest', id, `Trạng thái: ${status}`);
  revalidatePath(`/payments/${id}`);
  redirect(`/payments/${id}`);
}

/** Bỏ một job khỏi ĐNTT còn Nháp: job về "Nghiệm thu" để gom lại sau. */
export async function removeFromPayment(fd: FormData) {
  const me = await requireUser();
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
  const p = await db.paymentRequest.findUniqueOrThrow({ where: { id: str(fd, 'id') } });
  if (p.status !== 'Nháp') redirect(`/payments/${p.id}?err=${encodeURIComponent('Chỉ xoá được ĐNTT còn Nháp')}`);
  await db.job.updateMany({ where: { paymentId: p.id }, data: { paymentId: null, stage: 'Nghiệm thu' } });
  await db.paymentRequest.delete({ where: { id: p.id } });
  await audit(me.id, 'PaymentRequest', p.id, `Xoá ĐNTT #${p.number}`);
  revalidatePath('/payments');
  redirect('/payments');
}
