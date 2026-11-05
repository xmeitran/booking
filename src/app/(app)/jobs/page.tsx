import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { Avatar } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate, fmtNum, fmtShort } from '@/lib/format';
import { CANCELLED, jobCode, STAGE_HINT, STAGE_TONE, STAGES } from '@/lib/jobs';
import { requireUser } from '@/lib/session';

type Search = { view?: string; brand?: string; pic?: string; mine?: string; line?: string; batch?: string; late?: string };
const today = () => new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) + 'T00:00:00+07:00');
const BEFORE_SUBMIT = ['Đã duyệt', 'Đã chốt', 'Gửi hàng', 'Đang quay'];

// Job: booking quản lý trong app, từ KOC Brand duyệt tới thanh toán. Kanban theo chặng, lọc theo brand / nhân sự.
export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const list = sp.view === 'list';
  const where: Prisma.JobWhereInput = {
    AND: [
      sp.brand ? { brandId: sp.brand } : {},
      sp.mine ? { picId: me.id } : sp.pic ? { picId: sp.pic } : {},
      sp.line ? { planLineId: sp.line } : {},
      sp.batch ? { listingItem: { batchId: sp.batch } } : {},
      sp.late ? { deadline: { lt: today() }, stage: { in: BEFORE_SUBMIT } } : {},
      list ? {} : { stage: { not: CANCELLED } },
    ],
  };
  const [jobs, brands, pics, lateCount, waitingReview] = await Promise.all([
    db.job.findMany({
      where, orderBy: [{ deadline: { sort: 'asc', nulls: 'last' } }, { number: 'desc' }], take: 500,
      include: { koc: { select: { handle: true, name: true, nickname: true, avatarUrl: true } }, brand: { select: { name: true } }, pic: { select: { name: true, avatarUrl: true } } },
    }),
    db.brand.findMany({ where: { jobs: { some: {} } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.user.findMany({ where: { jobs: { some: {} } }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    db.job.count({ where: { deadline: { lt: today() }, stage: { in: BEFORE_SUBMIT } } }),
    db.job.count({ where: { stage: 'Đã nộp' } }),
  ]);
  const params = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  const withParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    return p.size ? `/jobs?${p}` : '/jobs';
  };
  const late = (j: (typeof jobs)[number]) => j.deadline && j.deadline < today() && BEFORE_SUBMIT.includes(j.stage);
  const tab = (on: boolean) => `rounded px-3 py-1 ${on ? 'bg-surface font-medium shadow-sm' : 'text-ink-3'}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Job</h1>
          <p className="mt-1 text-[13px] text-ink-2">Mỗi KOC Brand chọn &quot;Yes&quot; ở Listing thành một job: chốt giá, gửi hàng, brief, KOC nộp video, nghiệm thu, đề nghị thanh toán.</p>
        </div>
        <div className="flex rounded-md bg-sunken p-0.5 text-[13px]">
          <Link href={withParam('view', '')} className={tab(!list)}>Kanban</Link>
          <Link href={withParam('view', 'list')} className={tab(list)}>Danh sách</Link>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={withParam('mine', sp.mine ? '' : '1')} className={`pill px-2.5 py-1 ${sp.mine ? 'bg-ink text-white' : 'bg-surface text-ink-2 ring-1 ring-line'}`}>Job của tôi</Link>
        <Link href={withParam('late', sp.late ? '' : '1')} className={`pill px-2.5 py-1 ${sp.late ? 'bg-ink text-white' : lateCount ? 'bg-critical-soft text-critical' : 'bg-surface text-ink-3 ring-1 ring-line'}`}>Trễ deadline · {lateCount}</Link>
        <span className={`pill px-2.5 py-1 ${waitingReview ? 'bg-warning-soft text-warning' : 'bg-surface text-ink-3 ring-1 ring-line'}`}>Chờ nghiệm thu · {waitingReview}</span>
        <form className="flex gap-2">
          {[...params].filter(([k]) => k !== 'brand' && k !== 'pic').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <select name="brand" defaultValue={sp.brand ?? ''} aria-label="Brand" className="input h-8 w-auto text-xs">
            <option value="">Mọi brand</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select name="pic" defaultValue={sp.pic ?? ''} aria-label="Nhân sự" className="input h-8 w-auto text-xs">
            <option value="">Mọi nhân sự</option>{pics.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button className="btn h-8 px-2.5 text-xs">Lọc</button>
        </form>
        {(sp.line || sp.batch) && <Link href="/jobs" className="link text-xs">Bỏ lọc plan / listing</Link>}
      </div>

      {list ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="tbl">
            <thead><tr><th>Job</th><th>KOC</th><th>Brand</th><th>PIC</th><th>Chặng</th><th>Deadline</th><th className="text-right">Giá</th><th>Nghiệm thu</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td><Link href={`/jobs/${j.id}`} className="font-mono text-xs text-accent hover:underline">{jobCode(j.number)}</Link></td>
                  <td>{j.koc.nickname ?? j.koc.name} <span className="text-xs text-ink-3">@{j.koc.handle}</span></td>
                  <td>{j.brand?.name ?? '—'}</td>
                  <td>{j.pic?.name ?? '—'}</td>
                  <td><span className={`pill ${STAGE_TONE[j.stage] ?? 'bg-sunken text-ink-2'}`}>{j.stage}</span></td>
                  <td className={late(j) ? 'text-critical' : ''}>{fmtDate(j.deadline)}</td>
                  <td className="text-right tabular-nums">{fmtNum(j.price)}</td>
                  <td>{j.reviewResult ?? '—'}</td>
                </tr>
              ))}
              {!jobs.length && <tr><td colSpan={8} className="py-12 text-center text-ink-3">Chưa có job. Ở Listing, bấm &quot;Tạo job cho KOC Brand chọn Yes&quot;.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {STAGES.map((st) => {
            const col = jobs.filter((j) => j.stage === st);
            return (
              <div key={st} className="w-60 shrink-0 rounded-lg bg-sunken p-2">
                <div className="mb-2 px-1" title={STAGE_HINT[st]}>
                  <div className="flex items-center justify-between">
                    <span className={`pill ${STAGE_TONE[st] ?? 'bg-surface text-ink-2'}`}>{st}</span>
                    <span className="text-xs text-ink-3">{col.length}</span>
                  </div>
                  <div className="mt-1 text-[11px] leading-tight text-ink-3">{STAGE_HINT[st]}</div>
                </div>
                <div className="space-y-2">
                  {col.map((j) => (
                    <Link key={j.id} href={`/jobs/${j.id}`} className="block rounded-md bg-surface p-2.5 text-xs shadow-sm ring-1 ring-line hover:ring-accent">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-ink-3">{jobCode(j.number)}</span>
                        <span className="font-medium">{fmtShort(j.price)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Avatar src={j.koc.avatarUrl} name={j.koc.nickname ?? j.koc.name} size={20} />
                        <span className="truncate text-[13px] font-medium">{j.koc.nickname ?? j.koc.name}</span>
                      </div>
                      <div className="mt-0.5 truncate text-ink-3">{j.brand?.name ?? '—'} · {j.pic?.name ?? 'chưa giao'}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {j.deadline && <span className={`pill ${late(j) ? 'bg-critical-soft text-critical' : 'bg-sunken text-ink-2'}`}>Air {fmtDate(j.deadline)}</span>}
                        {j.sample && j.sample !== 'Không cần' && BEFORE_SUBMIT.includes(j.stage) && <span className="pill bg-sunken text-ink-2">Mẫu: {j.sample}</span>}
                        {j.reviewResult && j.reviewResult !== 'Đạt' && <span className="pill bg-warning-soft text-warning">Lần trước: {j.reviewResult}</span>}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
