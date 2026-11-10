import Link from 'next/link';
import { CatalogPick } from '@/components/CatalogPick';
import { ActionForm, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { listingScope, scopeOf } from '@/lib/scope';
import { requireUser } from '@/lib/session';
import { ScopeNote } from '@/components/ScopeNote';
import { saveBatch, syncListingsNow } from './actions';
import { fromLarkListing } from '@/lib/listing';

const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);

type Search = { new?: string; month?: string; src?: string; q?: string };

export default async function ListingPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const isNew = sp.new;
  const scope = await scopeOf(me);
  // Mặc định tháng này; "all" = mọi tháng. Nguồn: Lark (3.1 Listing KOCs) / tạo trong app.
  const month = sp.month === 'all' ? '' : /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : thisMonth();
  const src = sp.src === 'lark' || sp.src === 'app' ? sp.src : '';
  const q = sp.q?.trim() ?? '';
  const where = {
    AND: [
      listingScope(scope),
      month ? { month } : {},
      src === 'lark' ? { id: { startsWith: 'lark-' } } : src === 'app' ? { NOT: { id: { startsWith: 'lark-' } } } : {},
      q ? { OR: [{ name: { contains: q, mode: 'insensitive' as const } }, { brand: { contains: q, mode: 'insensitive' as const } }, { store: { contains: q, mode: 'insensitive' as const } }] } : {},
    ],
  };
  const [batches, brands, months, synced] = await Promise.all([
    db.listingBatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { createdBy: true, items: { select: { brandChoice: true, recommendation: true, videos: true } } },
    }),
    isNew ? db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, stores: { select: { id: true, name: true }, orderBy: { name: 'asc' } }, products: { select: { id: true, name: true }, orderBy: { name: 'asc' } } } }) : [],
    db.listingBatch.findMany({ where: listingScope(scope), distinct: ['month'], select: { month: true }, orderBy: { month: 'desc' } }),
    db.syncState.findUnique({ where: { id: 'listings' } }),
  ]);
  const params = (o: Partial<Search>) => {
    const p = new URLSearchParams(Object.entries({ month: sp.month ?? '', src, q, ...o }).filter(([, v]) => v) as [string, string][]);
    return p.size ? `/listing?${p}` : '/listing';
  };
  const running = Boolean(synced?.startedAt && !synced.finishedAt);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Listing</h1>
          <p className="mt-0.5 text-xs text-ink-3">
            Đợt có nhãn <span className="pill bg-accent-soft text-accent">Lark</span> đồng bộ từ bảng 3.1 Listing KOCs mỗi giờ (chỉ xem, sửa trên Lark).
            {synced?.finishedAt && ` Lần gần nhất ${synced.finishedAt.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}: ${synced.message}.`}
          </p>
        </div>
        <div className="flex gap-2">
          <form action={syncListingsNow}><button className="btn" disabled={running}>{running ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}</button></form>
          <Link href="?new=1" className="btn btn-primary">Tạo đợt listing</Link>
        </div>
      </div>
      <ScopeNote scope={scope} className="-mt-2 mb-3" />

      <form className="mb-3 flex flex-wrap items-center gap-2">
        <select name="month" defaultValue={sp.month === 'all' ? 'all' : month} aria-label="Tháng" className="input w-auto">
          <option value="all">Mọi tháng</option>
          {[...new Set([thisMonth(), ...months.map((m) => m.month)])].sort().reverse().map((m) => <option key={m} value={m}>Tháng {m.split('-').reverse().join('/')}</option>)}
        </select>
        <select name="src" defaultValue={src} aria-label="Nguồn" className="input w-auto">
          <option value="">Mọi nguồn</option>
          <option value="lark">Từ Lark</option>
          <option value="app">Tạo trong app</option>
        </select>
        <input name="q" defaultValue={q} placeholder="Tìm brand, gian hàng, tên đợt" aria-label="Tìm đợt" className="input max-w-xs" />
        <button className="btn">Lọc</button>
        {(sp.month || src || q) && <Link href="/listing" className="btn border-transparent text-ink-3">Xóa lọc</Link>}
        <span className="ml-auto text-xs text-ink-3">{batches.length} đợt · {batches.reduce((s, b) => s + b.items.length, 0)} KOC</span>
      </form>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr><th>Đợt listing</th><th>Store / Sản phẩm</th><th>Tháng</th><th className="text-right">KOC</th><th className="text-right">Brand chọn</th><th>Người tạo</th></tr>
          </thead>
          <tbody>
            {batches.map((b) => {
              const yes = b.items.filter((i) => i.brandChoice === 'Yes').length;
              const decided = b.items.filter((i) => i.brandChoice).length;
              return (
                <tr key={b.id}>
                  <td>
                    <Link href={`/listing/${b.id}`} className="font-medium hover:text-accent hover:underline">{b.name}</Link>
                    {fromLarkListing(b.id) && <span className="pill ml-1.5 bg-accent-soft text-accent">Lark</span>}
                    {b.brand && <div className="text-xs text-ink-3">{b.brand}</div>}
                  </td>
                  <td>{b.store ?? '—'}<div className="max-w-64 truncate text-xs text-ink-3">{b.product}</div></td>
                  <td>{b.month.split('-').reverse().join('/')}</td>
                  <td className="text-right">{b.items.length}{b.items.some((i) => i.videos > 1) && <div className="text-xs text-ink-3">{b.items.reduce((s, i) => s + i.videos, 0)} video</div>}</td>
                  <td className="text-right">{decided ? `${yes}/${decided} chọn` : <span className="text-ink-3">Chưa phản hồi</span>}</td>
                  <td>{b.createdBy.name ?? '—'}<div className="text-xs text-ink-3">{fromLarkListing(b.id) ? 'Nhân sự điền (Lark)' : fmtDate(b.createdAt)}</div></td>
                </tr>
              );
            })}
            {!batches.length && (
              <tr><td colSpan={6} className="py-12 text-center text-ink-3">
                {month ? <>Tháng {month.split('-').reverse().join('/')} chưa có đợt listing nào. <Link href={params({ month: 'all' })} className="link">Xem mọi tháng</Link></> : 'Chưa có đợt listing nào.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {isNew && (
        <Dialog title="Tạo đợt listing" closeHref="/listing">
          <ActionForm action={saveBatch} className="grid gap-4 sm:grid-cols-2">
            <div className="col-span-full">
              <label className="label" htmlFor="name">Tên đợt</label>
              <input id="name" name="name" required placeholder="VD: pH Care – T11 – Đợt 1" className="input" />
            </div>
            <CatalogPick brands={brands} />
            <div>
              <label className="label" htmlFor="month">Tháng</label>
              <input id="month" name="month" type="month" required defaultValue={thisMonth()} className="input" />
            </div>
            <div />
            <div>
              <label className="label" htmlFor="cr">CR sản phẩm theo gian hàng (%)</label>
              <input id="cr" name="cr" inputMode="decimal" placeholder="Trống = lấy CR của gian hàng" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="aov">AOV sản phẩm theo gian hàng (₫)</label>
              <input id="aov" name="aov" type="number" min={0} step={1000} placeholder="Trống = lấy AOV của gian hàng" className="input" />
            </div>
            <div className="col-span-full flex justify-end gap-2">
              <Link href="/listing" className="btn">Hủy</Link>
              <button className="btn btn-primary">Tạo</button>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </>
  );
}
