import Link from 'next/link';
import { Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate, fmtNum } from '@/lib/format';
import { requireUser } from '@/lib/auth/session';
import { aiOn } from '@/lib/matching/ai';
import { OBJECTIVE_LABEL, STAGES, STAGE_TONE, STEPS, type Stage } from '@/lib/matching/spec';
import { AiBriefBox, BriefForm } from './BriefForm';
import { currentStep } from './parts';

// Creator matching: mỗi đợt booking một bản ghi, đi qua 10 bước (spec.ts STEPS).
export default async function MatchingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [briefs, counts, brands, ai] = await Promise.all([
    db.matchBrief.findMany({
      where: { template: false },
      include: { createdBy: { select: { name: true } }, product: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    db.matchCandidate.groupBy({ by: ['briefId', 'stage'], _count: true }),
    sp.new ? db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, products: { select: { id: true, name: true, sku: true }, orderBy: { name: 'asc' } } } }) : [],
    aiOn(),
  ]);
  const countOf = (briefId: string) => Object.fromEntries(counts.filter((c) => c.briefId === briefId).map((c) => [c.stage, c._count])) as Partial<Record<Stage, number>>;
  const shown: Stage[] = ['APPROVED', 'CONFIRMED', 'SHORTLIST', 'POOL'];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Creator matching</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-ink-2">
            Tìm KOC cho một đợt booking qua 7 bước: nhập yêu cầu → tìm & lọc KOC → kiểm tra nội dung → hỏi giá → chấm điểm → Lead B2C duyệt, đẩy sang Listing → ghi kết quả sau air.
          </p>
        </div>
        <Link href="?new=1" className="btn btn-primary">+ Tạo đợt mới</Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr><th>Đợt</th><th>Brand · sản phẩm</th><th>Air</th><th>Đang ở bước</th><th>KOC</th><th>Người tạo</th><th>Cập nhật</th></tr>
          </thead>
          <tbody>
            {briefs.map((b) => {
              const n = countOf(b.id);
              const step = currentStep(b, n);
              return (
                <tr key={b.id}>
                  <td>
                    <Link href={`/matching/${b.id}?step=${step}`} className="font-medium text-accent hover:underline">{b.name}</Link>
                    <div className="text-xs text-ink-3">{b.channel} · {OBJECTIVE_LABEL[b.objective] ?? b.objective}</div>
                  </td>
                  <td>{b.brand ?? '—'}{b.product && <span className="text-ink-3"> · {b.product.name}</span>}</td>
                  <td className="whitespace-nowrap">{b.airMonth ? b.airMonth.split('-').reverse().join('/') : '—'}</td>
                  <td className="whitespace-nowrap text-[13px]">{step}. {STEPS[step - 1].title}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {shown.filter((s) => n[s]).map((s) => <span key={s} className={`pill ${STAGE_TONE[s]}`}>{STAGES[s]} {fmtNum(n[s])}</span>)}
                      {!Object.keys(n).length && <span className="text-xs text-ink-3">Chưa tìm KOC</span>}
                    </div>
                  </td>
                  <td>{b.createdBy.name ?? '—'}</td>
                  <td className="whitespace-nowrap">{fmtDate(b.updatedAt)}</td>
                </tr>
              );
            })}
            {!briefs.length && <tr><td colSpan={7} className="py-10 text-center text-ink-3">Chưa có đợt nào. Bấm "+ Tạo đợt mới", hoặc "Tìm KOC" ở một dòng Plan.</td></tr>}
          </tbody>
        </table>
      </div>

      {sp.new && (
        <Dialog title="Tạo đợt mới" closeHref="/matching" wide>
          {ai && <div className="mb-4"><AiBriefBox /></div>}
          <p className="mb-3 text-xs text-ink-3">{ai ? 'Hoặc tự điền:' : 'Điền yêu cầu của đợt.'} Thông tin cố định của brand (ngành, đối thủ, ngưỡng follower…) khai một lần ở Danh mục.</p>
          <BriefForm brands={brands} cancel="/matching" />
        </Dialog>
      )}
    </>
  );
}
