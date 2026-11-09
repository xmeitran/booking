import Link from 'next/link';
import { ActionForm, Avatar, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtNum } from '@/lib/format';
import { can, requireUser } from '@/lib/session';
import { KL_LEVELS } from '../contacts/platforms';
import { importFromBookings, saveBrand, saveTierPrices } from './actions';

const PRICE_COLS = ['Video', 'Phiên livestream'];

// Master data: brand → gian hàng → sản phẩm (USP, guideline, checklist nghiệm thu, nhân sự phụ trách) và bảng giá theo tier.
export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ tab?: string; new?: string; q?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const canEdit = can(me, 'catalog.edit');
  const tab = sp.tab === 'prices' ? 'prices' : 'brands';
  const q = sp.q?.trim() ?? '';
  const [brands, prices, bookingBrands] = await Promise.all([
    db.brand.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : {},
      include: { _count: { select: { stores: true, products: true, jobs: true } }, members: { include: { user: { select: { name: true, avatarUrl: true } } } } },
      orderBy: { name: 'asc' },
    }),
    db.tierPrice.findMany(),
    db.booking.findMany({ where: { brand: { not: null } }, distinct: ['brand'], select: { brand: true } }),
  ]);
  const priceOf = (tier: string, type: string) => prices.find((p) => p.tier === tier && p.priceType === type);
  const tabCls = (on: boolean) => `rounded px-3 py-1 ${on ? 'bg-surface font-medium shadow-sm' : 'text-ink-3'}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Danh mục</h1>
          <p className="mt-1 text-[13px] text-ink-2">Brand, gian hàng, sản phẩm (USP, guideline, checklist nghiệm thu), nhân sự phụ trách và bảng giá theo tier KOC. Plan, matching, job đều lấy từ đây.</p>
        </div>
        <div className="flex rounded-md bg-sunken p-0.5 text-[13px]">
          <Link href="/catalog" className={tabCls(tab === 'brands')}>Brand · {brands.length}</Link>
          <Link href="/catalog?tab=prices" className={tabCls(tab === 'prices')}>Bảng giá theo tier</Link>
        </div>
      </div>

      {tab === 'brands' ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <form className="flex gap-2">
              <input name="q" defaultValue={q} placeholder="Tìm brand" aria-label="Tìm brand" className="input h-8 w-56 text-[13px]" />
              <button className="btn h-8 px-3 text-xs">Tìm</button>
            </form>
            {canEdit && (
              <div className="flex gap-2">
                <form action={importFromBookings}>
                  <button className="btn h-8 px-3 text-xs" title="Tạo brand và gian hàng từ cột Brand, Store của booking trên Lark">Lấy {bookingBrands.length} brand từ booking Lark</button>
                </form>
                <Link href="?new=1" className="btn btn-primary h-8 px-3 text-xs">Thêm brand</Link>
              </div>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="tbl">
              <thead><tr><th>Brand</th><th className="text-right">Gian hàng</th><th className="text-right">Sản phẩm</th><th>Phụ trách</th><th className="text-right">Job</th><th>Hồ sơ</th></tr></thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link href={`/catalog/${b.id}`} className="flex items-center gap-2">
                        <Avatar src={b.logoUrl} name={b.name} size={28} />
                        <span className="font-medium text-accent hover:underline">{b.name}</span>
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">{fmtNum(b._count.stores)}</td>
                    <td className="text-right tabular-nums">{fmtNum(b._count.products)}</td>
                    <td className="text-xs">{b.members.length ? b.members.map((m) => `${m.user.name ?? '—'} (${m.role})`).join(', ') : <span className="text-ink-3">Chưa giao</span>}</td>
                    <td className="text-right tabular-nums">{fmtNum(b._count.jobs)}</td>
                    <td className="text-xs">
                      {[b.usp && 'USP', b.guideline && 'Guideline', b.checklist && 'Checklist'].filter(Boolean).join(' · ') || <span className="text-warning">Thiếu USP, guideline, checklist</span>}
                    </td>
                  </tr>
                ))}
                {!brands.length && <tr><td colSpan={6} className="py-12 text-center text-ink-3">Chưa có brand. Bấm &quot;Lấy brand từ booking Lark&quot; để bắt đầu nhanh.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <ActionForm action={saveTierPrices}>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="tbl">
              <thead>
                <tr><th>Tier KOC</th>{PRICE_COLS.map((c) => <th key={c} className="text-center">{c} (₫, từ – đến)</th>)}</tr>
              </thead>
              <tbody>
                {KL_LEVELS.map((tier) => (
                  <tr key={tier}>
                    <td className="font-medium">{tier}</td>
                    {PRICE_COLS.map((type) => {
                      const p = priceOf(tier, type);
                      return (
                        <td key={type}>
                          <div className="flex items-center gap-1.5">
                            <input name={`min|${tier}|${type}`} defaultValue={p?.minPrice ?? ''} inputMode="numeric" disabled={!canEdit} aria-label={`${tier} ${type} từ`} className="input h-8 w-32 text-right text-[13px]" />
                            <span className="text-ink-3">–</span>
                            <input name={`max|${tier}|${type}`} defaultValue={p?.maxPrice ?? ''} inputMode="numeric" disabled={!canEdit} aria-label={`${tier} ${type} đến`} className="input h-8 w-32 text-right text-[13px]" />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-ink-3">Dùng để đề xuất giá khi tạo job và cảnh báo giá vượt khung ở Listing / Job.</p>
            {canEdit && <button className="btn btn-primary">Lưu bảng giá</button>}
          </div>
        </ActionForm>
      )}

      {sp.new && canEdit && (
        <Dialog title="Thêm brand" closeHref="/catalog">
          <ActionForm action={saveBrand} className="grid gap-4">
            <label className="block"><span className="label">Tên brand</span><input name="name" required className="input" /></label>
            <div className="flex justify-end gap-2"><Link href="/catalog" className="btn">Hủy</Link><button className="btn btn-primary">Tạo</button></div>
          </ActionForm>
        </Dialog>
      )}
    </>
  );
}
