import Link from 'next/link';
import { ActionForm } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate, fmtNum } from '@/lib/format';
import { jobCode } from '@/lib/jobs';
import { FEE_DIVISOR } from '@/lib/kocInsights';
import { PAY_TONE } from '@/lib/payments';
import { requireUser } from '@/lib/session';
import { createPayment } from './actions';

// Nghiệm thu đạt → đề nghị thanh toán (ĐNTT). Đẩy sang Lark Approval làm khi có mã quy trình duyệt của kế toán.
export default async function PaymentsPage() {
  await requireUser();
  const [ready, payments] = await Promise.all([
    db.job.findMany({
      where: { stage: 'Nghiệm thu', reviewResult: 'Đạt', paymentId: null },
      include: { koc: { select: { handle: true, name: true, nickname: true, bankAccount: true } }, brand: { select: { name: true } } },
      orderBy: [{ brand: { name: 'asc' } }, { reviewedAt: 'asc' }],
    }),
    db.paymentRequest.findMany({ include: { jobs: { select: { price: true } } }, orderBy: { number: 'desc' } }),
  ]);
  const users = new Map((await db.user.findMany({ where: { id: { in: payments.map((p) => p.createdById) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Thanh toán</h1>
        <p className="mt-1 text-[13px] text-ink-2">Job nghiệm thu Đạt được gom thành đề nghị thanh toán (ĐNTT), tải file gửi kế toán và theo dõi trạng thái.</p>
      </div>

      <section className="mb-6 rounded-lg border border-line bg-surface px-5 py-4">
        <h2 className="mb-2 text-base font-semibold">Job chờ đề nghị thanh toán · {ready.length}</h2>
        {ready.length ? (
          <ActionForm action={createPayment} className="grid gap-3">
            <table className="tbl">
              <thead><tr><th className="w-8" /><th>Job</th><th>KOC</th><th>Brand</th><th>Nghiệm thu</th><th className="text-right">Giá net</th><th className="text-right">Kèm TNCN</th><th>Tài khoản</th></tr></thead>
              <tbody>
                {ready.map((j) => (
                  <tr key={j.id}>
                    <td><input type="checkbox" name="jobId" value={j.id} defaultChecked aria-label={`Chọn ${jobCode(j.number)}`} /></td>
                    <td><Link href={`/jobs/${j.id}`} className="font-mono text-xs text-accent hover:underline">{jobCode(j.number)}</Link></td>
                    <td>{j.koc.nickname ?? j.koc.name} <span className="text-xs text-ink-3">@{j.koc.handle}</span></td>
                    <td>{j.brand?.name ?? '—'}</td>
                    <td className="text-xs">{fmtDate(j.reviewedAt)}</td>
                    <td className="text-right tabular-nums">{fmtNum(j.price)}</td>
                    <td className="text-right tabular-nums">{j.price == null ? '—' : fmtNum(Math.round(j.price / FEE_DIVISOR))}</td>
                    <td className="text-xs">{j.koc.bankAccount ? 'Có' : <span className="text-warning">Thiếu, bổ sung ở Danh bạ</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-end justify-end gap-2">
              <input name="note" placeholder="Ghi chú ĐNTT (VD: đợt 1 tháng 12, brand pH Care)" aria-label="Ghi chú ĐNTT" className="input h-9 max-w-md text-[13px]" />
              <button className="btn btn-primary">Tạo đề nghị thanh toán</button>
            </div>
          </ActionForm>
        ) : <p className="text-[13px] text-ink-3">Chưa có job nghiệm thu Đạt chờ thanh toán.</p>}
      </section>

      <h2 className="mb-2 text-base font-semibold">Đề nghị thanh toán</h2>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead><tr><th>ĐNTT</th><th>Trạng thái</th><th className="text-right">Job</th><th className="text-right">Tổng giá net</th><th className="text-right">Tổng kèm TNCN</th><th>Tạo bởi</th></tr></thead>
          <tbody>
            {payments.map((p) => {
              const net = p.jobs.reduce((s, j) => s + (j.price ?? 0), 0);
              return (
                <tr key={p.id}>
                  <td><Link href={`/payments/${p.id}`} className="font-medium text-accent hover:underline">ĐNTT #{p.number}</Link>{p.note && <div className="text-xs text-ink-3">{p.note}</div>}</td>
                  <td><span className={`pill ${PAY_TONE[p.status] ?? 'bg-sunken text-ink-2'}`}>{p.status}</span></td>
                  <td className="text-right tabular-nums">{p.jobs.length}</td>
                  <td className="text-right tabular-nums">{fmtNum(net)}</td>
                  <td className="text-right tabular-nums">{fmtNum(Math.round(net / FEE_DIVISOR))}</td>
                  <td className="text-xs">{users.get(p.createdById) ?? '—'} · {fmtDate(p.createdAt)}</td>
                </tr>
              );
            })}
            {!payments.length && <tr><td colSpan={6} className="py-10 text-center text-ink-3">Chưa có đề nghị thanh toán.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
