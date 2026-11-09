import Link from 'next/link';
import { CatalogPick } from '@/components/CatalogPick';
import { ActionForm, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { listingScope, scopeOf } from '@/lib/scope';
import { requireUser } from '@/lib/session';
import { ScopeNote } from '@/components/ScopeNote';
import { saveBatch } from './actions';

const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);

export default async function ListingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const me = await requireUser();
  const { new: isNew } = await searchParams;
  const scope = await scopeOf(me);
  const [batches, brands] = await Promise.all([
    db.listingBatch.findMany({
      where: listingScope(scope),
      orderBy: { createdAt: 'desc' },
      include: { createdBy: true, items: { select: { brandChoice: true, recommendation: true } } },
    }),
    isNew ? db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, stores: { select: { id: true, name: true }, orderBy: { name: 'asc' } }, products: { select: { id: true, name: true }, orderBy: { name: 'asc' } } } }) : [],
  ]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Listing</h1>
        <Link href="?new=1" className="btn btn-primary">Tạo đợt listing</Link>
      </div>
      <ScopeNote scope={scope} className="-mt-2 mb-3" />

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
                    {b.brand && <div className="text-xs text-ink-3">{b.brand}</div>}
                  </td>
                  <td>{b.store ?? '—'}<div className="max-w-64 truncate text-xs text-ink-3">{b.product}</div></td>
                  <td>{b.month.split('-').reverse().join('/')}</td>
                  <td className="text-right">{b.items.length}</td>
                  <td className="text-right">{decided ? `${yes}/${decided} chọn` : <span className="text-ink-3">Chưa phản hồi</span>}</td>
                  <td>{b.createdBy.name ?? '—'}<div className="text-xs text-ink-3">{fmtDate(b.createdAt)}</div></td>
                </tr>
              );
            })}
            {!batches.length && <tr><td colSpan={6} className="py-12 text-center text-ink-3">Chưa có đợt listing nào.</td></tr>}
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
