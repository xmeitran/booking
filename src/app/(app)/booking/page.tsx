import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { pageOf, Pager } from '@/components/Pager';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/session';

const PER_PAGE = 50;
const vnd = new Intl.NumberFormat('vi-VN');
const fmtDate = (d: Date) => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const PIPELINE_TONE: Record<string, string> = { Done: 'bg-positive-soft text-positive', 'On Air': 'bg-accent-soft text-accent' };

type Search = { q?: string; month?: string; brand?: string; pipeline?: string; owner?: string; page?: string };
type Extra = { product?: string | null; niche?: string | null; platform?: string | null };

// ponytail: chỉ đọc. Dữ liệu gốc ở Lark Base, đồng bộ mỗi giờ (src/lib/bookingSync.ts); sửa trên Lark.
export default async function BookingPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const { q = '', month = '', brand = '', pipeline = '', owner = '' } = sp;
  const page = pageOf(sp.page);

  const contains = { contains: q.trim(), mode: 'insensitive' as const };
  const where: Prisma.BookingWhereInput = {
    ...(month && { planMonth: month }),
    ...(brand && { brand }),
    ...(pipeline && { pipeline }),
    ...(owner && { owner }),
    ...(q.trim() && { OR: [{ code: contains }, { channel: contains }, { store: contains }, { brand: contains }] }),
  };

  const distinct = async (field: 'planMonth' | 'brand' | 'pipeline' | 'owner') =>
    (await db.booking.findMany({ where: { [field]: { not: null } }, distinct: [field], select: { [field]: true }, orderBy: { [field]: field === 'planMonth' ? 'desc' : 'asc' } }))
      .map((r) => r[field] as string);

  const [rows, total, months, brands, pipelines, owners, sync] = await Promise.all([
    db.booking.findMany({ where, orderBy: { larkUpdatedAt: 'desc' }, skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    db.booking.count({ where }),
    distinct('planMonth'),
    distinct('brand'),
    distinct('pipeline'),
    distinct('owner'),
    db.syncState.findUnique({ where: { id: 'bookings' } }),
  ]);

  const params = new URLSearchParams(Object.entries({ q, month, brand, pipeline, owner }).filter(([, v]) => v));
  const select = (name: string, value: string, label: string, options: string[]) => (
    <select name={name} defaultValue={value} aria-label={label} className="input w-auto max-w-52">
      <option value="">{label}</option>
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold">Booking</h1>
        <p className="text-xs text-ink-3">
          {sync?.finishedAt ? <>Lark Base · đồng bộ {fmtTime(sync.finishedAt)} · {sync.message}</> : 'Chưa đồng bộ từ Lark Base'}
        </p>
      </div>

      <form className="mb-3 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Tìm mã BO, kênh, store, brand" aria-label="Tìm kiếm" className="input max-w-xs" />
        {select('month', month, 'Mọi tháng plan', months)}
        {select('brand', brand, 'Mọi brand', brands)}
        {select('pipeline', pipeline, 'Mọi pipeline', pipelines)}
        {select('owner', owner, 'Mọi người phụ trách', owners)}
        <button className="btn">Lọc</button>
        {params.size > 0 && <Link href="/booking" className="btn border-transparent text-ink-3">Xóa lọc</Link>}
      </form>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr><th>Mã booking</th><th>Kênh</th><th>Brand</th><th>Người phụ trách</th><th>Pipeline</th><th>Ngày air</th><th className="text-right">Chi phí</th></tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const x = b.extra as Extra;
              return (
                <tr key={b.id}>
                  <td>
                    <div className="font-mono text-xs">{b.code}</div>
                    {b.planMonth && <div className="text-xs text-ink-3">Plan {b.planMonth}</div>}
                  </td>
                  <td>
                    {b.channel ? (b.channelUrl ? <a href={b.channelUrl} target="_blank" rel="noreferrer" className="link">{b.channel}</a> : b.channel) : '—'}
                    <div className="text-xs text-ink-3">{[x.platform, x.niche].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td>
                    <div>{b.brand ?? '—'}</div>
                    {x.product && <div className="max-w-56 truncate text-xs text-ink-3" title={x.product}>{x.product}</div>}
                  </td>
                  <td>{b.owner ?? '—'}</td>
                  <td>{b.pipeline ? <span className={`pill ${PIPELINE_TONE[b.pipeline] ?? 'bg-sunken text-ink-2'}`}>{b.pipeline}</span> : '—'}</td>
                  <td className="whitespace-nowrap">
                    {b.airDate ? (
                      b.linkAir?.startsWith('http') ? <a href={b.linkAir} target="_blank" rel="noreferrer" className="link">{fmtDate(b.airDate)}</a> : fmtDate(b.airDate)
                    ) : b.planAirDate ? <span className="text-ink-3">Dự kiến {fmtDate(b.planAirDate)}</span> : '—'}
                  </td>
                  <td className="text-right">{b.cost == null ? '—' : vnd.format(b.cost)}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={7} className="py-12 text-center text-ink-3">{params.size ? 'Không có booking khớp bộ lọc.' : 'Chưa có booking. Dữ liệu sẽ có sau lần đồng bộ đầu tiên từ Lark Base.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager params={params} page={page} perPage={PER_PAGE} total={total} />
    </>
  );
}
