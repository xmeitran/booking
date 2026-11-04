import Link from 'next/link';
import { Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { describe, TIKTOK_CATEGORIES, type Criteria } from '@/lib/matching';
import { requireUser } from '@/lib/session';
import { BriefForm } from './BriefForm';

type Search = { new?: string; from?: string };

// Creator matching: B2C soạn best practice theo ngành hàng; brief brand chép tiêu chí từ đó + guideline / content strategy / content plan.
export default async function MatchingPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const creating = sp.new === 'template' || sp.new === 'brief' ? sp.new : null;
  const [briefs, niches, from] = await Promise.all([
    db.matchBrief.findMany({ include: { createdBy: { select: { name: true } } }, orderBy: { updatedAt: 'desc' } }),
    creating ? db.koc.findMany({ where: { niche: { not: null } }, distinct: ['niche'], select: { niche: true }, orderBy: { niche: 'asc' } }) : [],
    sp.from ? db.matchBrief.findUnique({ where: { id: sp.from } }) : null,
  ]);
  const templates = briefs.filter((b) => b.template);
  const list = briefs.filter((b) => !b.template);
  const categories = [...new Set([...TIKTOK_CATEGORIES, ...briefs.map((b) => b.category).filter(Boolean)])] as string[];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Creator matching</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-ink-2">
            B2C soạn best practice và bộ tiêu chí cho từng ngành hàng. Mỗi brief của brand chép tiêu chí từ đó, thêm brand guideline,
            content strategy, content plan; app lọc KOC trong Danh bạ theo tiêu chí, đưa thẳng vào listing hoặc tải Excel.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="?new=template" className="btn">Thêm best practice</Link>
          <Link href="?new=brief" className="btn btn-primary">Tạo brief</Link>
        </div>
      </div>

      <h2 className="mb-2 text-base font-semibold">Best practice theo ngành hàng</h2>
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((t) => (
          <Link key={t.id} href={`/matching/${t.id}`} className="block rounded-lg border border-line bg-surface px-4 py-3 hover:border-accent">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{t.name}</span>
              {t.category && <span className="pill bg-accent-soft text-accent">{t.category}</span>}
            </div>
            <Chips c={t.criteria as Criteria} />
            {t.note && <p className="mt-2 line-clamp-2 text-xs text-ink-3">{t.note}</p>}
          </Link>
        ))}
        {!templates.length && <p className="text-[13px] text-ink-3">Chưa có best practice. Bấm "Thêm best practice" để soạn cho một ngành hàng.</p>}
      </div>

      <h2 className="mb-2 text-base font-semibold">Brief theo brand</h2>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead><tr><th>Brief</th><th>Brand</th><th>Ngành hàng</th><th>Bộ tiêu chí</th><th>Người tạo</th><th>Cập nhật</th></tr></thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td><Link href={`/matching/${b.id}`} className="font-medium text-accent hover:underline">{b.name}</Link></td>
                <td>{b.brand ?? '—'}</td>
                <td>{b.category ?? '—'}</td>
                <td><Chips c={b.criteria as Criteria} /></td>
                <td>{b.createdBy.name ?? '—'}</td>
                <td className="whitespace-nowrap">{fmtDate(b.updatedAt)}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={6} className="py-10 text-center text-ink-3">Chưa có brief nào.</td></tr>}
          </tbody>
        </table>
      </div>

      {creating && (
        <Dialog title={creating === 'template' ? 'Thêm best practice ngành hàng' : 'Tạo brief brand'} closeHref="/matching">
          {creating === 'brief' && templates.length > 0 && (
            <form className="mb-4 flex flex-wrap items-end gap-2 rounded-md bg-sunken p-3">
              <input type="hidden" name="new" value="brief" />
              <label className="min-w-0 flex-1">
                <span className="label">Bắt đầu từ best practice</span>
                <select name="from" defaultValue={from?.id ?? ''} className="input">
                  <option value="">— Không dùng —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.category ? ` · ${t.category}` : ''}</option>)}
                </select>
              </label>
              <button className="btn">Chép tiêu chí</button>
            </form>
          )}
          <BriefForm
            key={from?.id ?? 'blank'}
            template={creating === 'template'}
            brief={{ category: from?.category ?? null, note: creating === 'template' ? null : from?.note ?? null }}
            criteria={(from?.criteria ?? {}) as Criteria}
            niches={niches.map((n) => n.niche!)}
            categories={categories}
            cancel="/matching"
          />
        </Dialog>
      )}
    </>
  );
}

function Chips({ c }: { c: Criteria }) {
  const d = describe(c);
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {d.length ? d.map((x) => <span key={x} className="pill bg-sunken text-ink-2">{x}</span>) : <span className="text-xs text-ink-3">Chưa đặt tiêu chí</span>}
    </div>
  );
}
