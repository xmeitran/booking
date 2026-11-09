import Link from 'next/link';
import { ActionForm, Dialog } from '@/components/ui';
import { CANCELLED } from '@/lib/jobs';
import { db } from '@/lib/db';
import { fmtNum, fmtPct, fmtShort } from '@/lib/format';
import { fromLark } from '@/lib/planSync';
import { jobScope, lineScope, planScope, scopeOf } from '@/lib/scope';
import { can, requireUser } from '@/lib/session';
import { ScopeNote } from '@/components/ScopeNote';
import { savePlan, syncPlansNow } from './actions';

const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);

// Plan: plan tổng theo tháng → plan chi tiết theo brand, tuần, tier, loại content, ngân sách, PIC; theo dõi đã book bao nhiêu.
export default async function PlanList({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const scope = await scopeOf(me);
  const plans = await db.plan.findMany({
    where: planScope(scope),
    include: { lines: { where: lineScope(scope), select: { id: true, quantity: true, budget: true, jobs: { where: { stage: { not: CANCELLED } }, select: { price: true } } } } },
    orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
  });
  const canEdit = can(me, 'plan.edit');
  const sync = await db.syncState.findUnique({ where: { id: 'plans' } });
  const syncing = Boolean(sync?.startedAt && !sync.finishedAt);
  // Job ngoài plan (tier không có dòng nào): tính vào "Đã chốt" như trang chi tiết plan.
  const outside = await db.job.findMany({
    where: { planLineId: null, stage: { not: CANCELLED }, listingItem: { batch: { planLineId: { not: null } } }, AND: [jobScope(scope)] },
    select: { price: true, listingItem: { select: { batch: { select: { planLineId: true } } } } },
  });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Plan</h1>
          <p className="mt-1 text-[13px] text-ink-2">Plan tổng theo tháng, tách chi tiết theo brand, tuần, tier KOC, loại content, ngân sách và PIC. Mỗi dòng plan bấm &quot;Tìm KOC&quot; để sang Creator matching; tiến độ tính theo job đã tạo.</p>
          <p className="mt-1 text-xs text-ink-3">
            {syncing ? 'Đang đồng bộ danh mục và plan từ Lark Base, tải lại trang sau 1 phút'
              : sync?.finishedAt ? `Lark Base · đồng bộ ${fmtTime(sync.finishedAt)} · ${sync.message}` : 'Chưa đồng bộ plan từ Lark Base'}
          </p>
          <ScopeNote scope={scope} />
        </div>
        <div className="flex gap-2">
          <form action={syncPlansNow}><button className="btn" disabled={syncing}>{syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay từ Lark'}</button></form>
          {canEdit && <Link href="?new=1" className="btn btn-primary">Tạo plan</Link>}
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead><tr><th>Plan</th><th>Tháng</th><th className="text-right">KOC cần book</th><th className="text-right">Đã có job</th><th className="text-right">Ngân sách</th><th className="text-right">Đã chốt</th></tr></thead>
          <tbody>
            {plans.map((p) => {
              const qty = p.lines.reduce((s, l) => s + l.quantity, 0);
              const jobs = p.lines.flatMap((l) => l.jobs);
              const budget = (!scope && p.budget) || p.lines.reduce((s, l) => s + (l.budget ?? 0), 0);
              const ids = new Set(p.lines.map((l) => l.id));
              const spent = [...jobs, ...outside.filter((j) => ids.has(j.listingItem!.batch.planLineId!))].reduce((s, j) => s + (j.price ?? 0), 0);
              return (
                <tr key={p.id}>
                  <td><Link href={`/plan/${p.id}`} className="font-medium text-accent hover:underline">{p.name}</Link><div className="text-xs text-ink-3">{p.lines.length} dòng chi tiết{fromLark(p.id) ? ' · Lark Base' : ''}</div></td>
                  <td>{p.month.split('-').reverse().join('/')}</td>
                  <td className="text-right tabular-nums">{fmtNum(qty)}</td>
                  <td className="text-right tabular-nums">{fmtNum(jobs.length)} <span className="text-xs text-ink-3">{qty ? fmtPct(jobs.length / qty, 0) : ''}</span></td>
                  <td className="text-right tabular-nums">{fmtShort(budget || null)}</td>
                  <td className="text-right tabular-nums">{spent ? fmtShort(spent) : 0} <span className="text-xs text-ink-3">{budget ? fmtPct(spent / budget, 0) : ''}</span></td>
                </tr>
              );
            })}
            {!plans.length && <tr><td colSpan={6} className="py-12 text-center text-ink-3">Chưa có plan.</td></tr>}
          </tbody>
        </table>
      </div>

      {sp.new && canEdit && (
        <Dialog title="Tạo plan" closeHref="/plan">
          <ActionForm action={savePlan} className="grid gap-4 sm:grid-cols-2">
            <label className="col-span-full block"><span className="label">Tên plan</span><input name="name" required placeholder="Plan booking T12/2026" className="input" /></label>
            <label className="block"><span className="label">Tháng</span><input name="month" type="month" required defaultValue={thisMonth()} className="input" /></label>
            <label className="block"><span className="label">Ngân sách tổng (₫)</span><input name="budget" inputMode="numeric" placeholder="Để trống = cộng từ các dòng" className="input" /></label>
            <label className="col-span-full block"><span className="label">Ghi chú</span><textarea name="note" rows={2} className="input" /></label>
            <div className="col-span-full flex justify-end gap-2"><Link href="/plan" className="btn">Hủy</Link><button className="btn btn-primary">Tạo</button></div>
          </ActionForm>
        </Dialog>
      )}
    </>
  );
}
