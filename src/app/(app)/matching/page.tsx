import Link from 'next/link';
import { Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate, fmtNum } from '@/lib/format';
import { requireUser } from '@/lib/auth/session';
import { warehouseStatus } from '@/lib/warehouse/creatorSync';
import { STAGES, STAGE_TONE, STEPS, type Stage } from '@/lib/matching/spec';
import { BriefForm } from './BriefForm';
import { currentStep } from './parts';

// Creator matching theo 10 bước của "Tổng hợp tiêu chí chuẩn hóa – AI Creator Matching (v0.1)": mỗi đợt booking một bản ghi.
export default async function MatchingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const [briefs, counts, brands, wh] = await Promise.all([
    db.matchBrief.findMany({
      where: { template: false },
      include: { createdBy: { select: { name: true } }, product: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    db.matchCandidate.groupBy({ by: ['briefId', 'stage'], _count: true }),
    sp.new ? db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, products: { select: { id: true, name: true, sku: true }, orderBy: { name: 'asc' } } } }) : [],
    warehouseStatus(),
  ]);
  const countOf = (briefId: string) => Object.fromEntries(counts.filter((c) => c.briefId === briefId).map((c) => [c.stage, c._count])) as Partial<Record<Stage, number>>;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Creator matching</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-ink-2">
            Mỗi đợt booking đi qua 10 bước: đầu vào brand / SKU / nhu cầu → pool ứng viên (Danh bạ + kho creator) → loại bằng dữ liệu và theo nội dung →
            chấm 6 nhóm (0, A–E) → shortlist → KOC báo giá → chấm hoàn chỉnh → B2C duyệt → xuất list cho brand → đánh giá sau air.
          </p>
          {wh && <p className="mt-1 text-xs text-ink-3">Kho dữ liệu: {fmtNum(wh.count)} creator{wh.at && ` · đồng bộ ${fmtDate(wh.at)}`}{wh.message && ` · ${wh.message}`}</p>}
        </div>
        <Link href="?new=1" className="btn btn-primary">Tạo đợt matching</Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr><th>Đợt</th><th>Brand · SKU</th><th>Kênh · mục tiêu</th><th>Tháng air</th><th>Ứng viên</th><th>Bước</th><th>Người tạo</th><th>Cập nhật</th></tr>
          </thead>
          <tbody>
            {briefs.map((b) => {
              const n = countOf(b.id);
              const step = currentStep(b, n);
              return (
                <tr key={b.id}>
                  <td><Link href={`/matching/${b.id}?step=${step}`} className="font-medium text-accent hover:underline">{b.name}</Link></td>
                  <td>{b.brand ?? '—'}{b.product && <span className="text-ink-3"> · {b.product.name}</span>}</td>
                  <td>{b.channel} · {b.objective}{b.gmvMax && ' · GMV Max'}</td>
                  <td>{b.airMonth ? b.airMonth.split('-').reverse().join('/') : '—'}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {(Object.keys(STAGES) as Stage[]).filter((s) => n[s]).map((s) => <span key={s} className={`pill ${STAGE_TONE[s]}`}>{STAGES[s]} {fmtNum(n[s])}</span>)}
                      {!Object.keys(n).length && <span className="text-xs text-ink-3">Chưa chạy</span>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-xs">{step}. {STEPS[step - 1].title}</td>
                  <td>{b.createdBy.name ?? '—'}</td>
                  <td className="whitespace-nowrap">{fmtDate(b.updatedAt)}</td>
                </tr>
              );
            })}
            {!briefs.length && <tr><td colSpan={8} className="py-10 text-center text-ink-3">Chưa có đợt nào. Bấm "Tạo đợt matching", hoặc "Tìm KOC" ở một dòng Plan.</td></tr>}
          </tbody>
        </table>
      </div>

      {sp.new && (
        <Dialog title="Tạo đợt matching" closeHref="/matching" wide>
          <p className="mb-3 text-xs text-ink-3">Brand profile (Khối 1), cấu hình SKU (Khối 2) và quy tắc lọc (Khối 3) khai một lần ở Danh mục; ở đây chỉ khai nhu cầu của đợt (Khối 4).</p>
          <BriefForm brands={brands} cancel="/matching" />
        </Dialog>
      )}
    </>
  );
}
