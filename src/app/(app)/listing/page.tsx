import Link from 'next/link';
import { ActionForm, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { saveBatch } from './actions';

const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);

export default async function ListingPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  await requireUser();
  const { new: isNew } = await searchParams;
  const [batches, brands, stores] = await Promise.all([
    db.listingBatch.findMany({
      orderBy: { createdAt: 'desc' },
      include: { createdBy: true, items: { select: { brandChoice: true, recommendation: true } } },
    }),
    isNew ? db.booking.findMany({ where: { brand: { not: null } }, distinct: ['brand'], select: { brand: true }, orderBy: { brand: 'asc' } }) : [],
    isNew ? db.booking.findMany({ where: { store: { not: null } }, distinct: ['store'], select: { store: true }, orderBy: { store: 'asc' } }) : [],
  ]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Listing</h1>
        <Link href="?new=1" className="btn btn-primary">Tạo đợt listing</Link>
      </div>

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
            <div>
              <label className="label" htmlFor="brand">Brand</label>
              <input id="brand" name="brand" list="brands" className="input" />
              <datalist id="brands">{brands.map((b) => <option key={b.brand} value={b.brand!} />)}</datalist>
            </div>
            <div>
              <label className="label" htmlFor="store">Store</label>
              <input id="store" name="store" list="stores" className="input" />
              <datalist id="stores">{stores.map((s) => <option key={s.store} value={s.store!} />)}</datalist>
            </div>
            <div className="col-span-full">
              <label className="label" htmlFor="product">Sản phẩm</label>
              <input id="product" name="product" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="month">Tháng</label>
              <input id="month" name="month" type="month" required defaultValue={thisMonth()} className="input" />
            </div>
            <div />
            <div>
              <label className="label" htmlFor="cr">CR sản phẩm theo gian hàng (%)</label>
              <input id="cr" name="cr" inputMode="decimal" placeholder="VD: 5" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="aov">AOV sản phẩm theo gian hàng (₫)</label>
              <input id="aov" name="aov" type="number" min={0} step={1000} placeholder="VD: 139000" className="input" />
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
