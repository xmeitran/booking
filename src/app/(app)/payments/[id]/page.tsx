import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { fmtDate, fmtNum } from '@/lib/format';
import { jobCode } from '@/lib/jobs';
import { FEE_DIVISOR } from '@/lib/kocInsights';
import { PAY_STATUS, PAY_TONE } from '@/lib/payments';
import { requireUser } from '@/lib/session';
import { removeFromPayment, setPaymentStatus } from '../actions';

export default async function PaymentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const { err } = await searchParams;
  const p = await db.paymentRequest.findUnique({
    where: { id },
    include: { jobs: { include: { koc: true, brand: { select: { name: true } } }, orderBy: { number: 'asc' } } },
  });
  if (!p) notFound();
  const bank = me.role !== 'STAFF'; // số tài khoản, CCCD: chỉ Admin / Leader
  const net = p.jobs.reduce((s, j) => s + (j.price ?? 0), 0);
  const step = PAY_STATUS.indexOf(p.status);

  return (
    <>
      <Link href="/payments" className="text-xs text-ink-3 hover:text-ink">← Thanh toán</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-xl font-semibold">ĐNTT #{p.number}</h1><span className={`pill ${PAY_TONE[p.status] ?? 'bg-sunken text-ink-2'}`}>{p.status}</span></div>
          <p className="text-xs text-ink-3">{p.jobs.length} job · tổng giá net {fmtNum(net)} ₫ · kèm thuế TNCN {fmtNum(Math.round(net / FEE_DIVISOR))} ₫ · tạo {fmtDate(p.createdAt)}{p.note ? ` · ${p.note}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/payments/${p.id}/export`} className="btn">Tải file ĐNTT</a>
          {PAY_STATUS[step + 1] && (
            <form action={setPaymentStatus}>
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="status" value={PAY_STATUS[step + 1]} />
              <button className="btn btn-primary">Chuyển &quot;{PAY_STATUS[step + 1]}&quot;</button>
            </form>
          )}
        </div>
      </div>
      {err && <p role="alert" className="mb-3 rounded-md bg-critical-soft px-3 py-2 text-critical">{err}</p>}
      <p className="mb-3 rounded-md bg-sunken px-3 py-2 text-xs text-ink-2">
        Chưa đẩy tự động sang Lark Approval: cần mã quy trình duyệt (approval code) của kế toán. Hiện tải file ĐNTT gửi kế toán, rồi cập nhật trạng thái ở đây.
      </p>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr>
              <th>Job</th><th>KOC</th><th>Brand</th><th>Video nghiệm thu</th><th className="text-right">Giá net</th><th className="text-right">Kèm TNCN</th>
              {bank && <><th>Chủ tài khoản</th><th>Số tài khoản</th><th>Ngân hàng</th><th>CCCD / MST</th></>}
              <th />
            </tr>
          </thead>
          <tbody>
            {p.jobs.map((j) => (
              <tr key={j.id}>
                <td><Link href={`/jobs/${j.id}`} className="font-mono text-xs text-accent hover:underline">{jobCode(j.number)}</Link></td>
                <td>{j.koc.nickname ?? j.koc.name} <span className="text-xs text-ink-3">@{j.koc.handle}</span></td>
                <td>{j.brand?.name ?? '—'}</td>
                <td className="text-xs">{j.submittedUrl ? <a href={j.submittedUrl} target="_blank" rel="noreferrer" className="link">Xem</a> : '—'} · {fmtDate(j.reviewedAt)}</td>
                <td className="text-right tabular-nums">{fmtNum(j.price)}</td>
                <td className="text-right tabular-nums">{j.price == null ? '—' : fmtNum(Math.round(j.price / FEE_DIVISOR))}</td>
                {bank && (
                  <>
                    <td>{j.koc.bankHolder ?? <span className="text-warning">Thiếu</span>}</td>
                    <td className="font-mono text-xs">{j.koc.bankAccount ?? <span className="text-warning">Thiếu</span>}</td>
                    <td>{j.koc.bankName ?? '—'}</td>
                    <td className="font-mono text-xs">{j.koc.idNumber ?? '—'}</td>
                  </>
                )}
                <td className="text-right">
                  {p.status === 'Nháp' && (
                    <form action={removeFromPayment}><input type="hidden" name="jobId" value={j.id} /><button className="link text-xs">Bỏ ra</button></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
