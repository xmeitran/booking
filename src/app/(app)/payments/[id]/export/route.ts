import { csvResponse } from '@/lib/csv';
import { db } from '@/lib/db';
import { jobCode } from '@/lib/jobs';
import { FEE_DIVISOR } from '@/lib/kocInsights';
import { paymentScope, scopeOf } from '@/lib/scope';
import { can, requirePerm } from '@/lib/session';

// File ĐNTT gửi kế toán. Cột tài khoản / CCCD chỉ có khi Admin, Leader tải.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requirePerm('data.export');
  const { id } = await params;
  const p = await db.paymentRequest.findFirst({ where: { id, AND: [paymentScope(await scopeOf(me))] }, include: { jobs: { include: { koc: true, brand: { select: { name: true } } }, orderBy: { number: 'asc' } } } });
  if (!p) return new Response('Không có ĐNTT này', { status: 404 });
  const bank = can(me, 'koc.bank');
  const header = ['Job', 'KOC', 'ID kênh', 'Brand', 'Loại', 'Link video', 'Ngày nghiệm thu', 'Giá net', 'Kèm thuế TNCN', ...(bank ? ['Chủ tài khoản', 'Số tài khoản', 'Ngân hàng', 'CCCD / MST'] : [])];
  const rows = p.jobs.map((j) => [
    jobCode(j.number), j.koc.nickname ?? j.koc.name, j.koc.handle, j.brand?.name, j.priceType, j.submittedUrl,
    j.reviewedAt?.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), j.price, j.price == null ? '' : Math.round(j.price / FEE_DIVISOR),
    ...(bank ? [j.koc.bankHolder, j.koc.bankAccount, j.koc.bankName, j.koc.idNumber] : []),
  ]);
  return csvResponse(`DNTT-${p.number}.csv`, header, rows);
}
