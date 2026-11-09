import Link from 'next/link';
import { pageOf, Pager } from '@/components/Pager';
import { bookingWhere, FLAGS, isPayIssue, PIPELINE, PIPELINE_TONE, type BookingFilters } from '@/lib/bookings';
import { db } from '@/lib/db';
import { fmtDate, fmtNum, fmtShort } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { syncNow } from './actions';

const PER_PAGE = 50;
const KANBAN_CARDS = 30;
const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

type Search = BookingFilters & { view?: string; page?: string };
type Row = Awaited<ReturnType<typeof db.booking.findMany>>[number];

// Dữ liệu gốc ở Lark Base, đồng bộ mỗi giờ (src/lib/bookingSync.ts); sửa trên Lark.
export default async function BookingPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const { q = '', month = '', brand = '', pipeline = '', owner = '', person = '', flag = '' } = sp;
  const kanban = sp.view === 'kanban';
  const page = pageOf(sp.page);
  const base = { q, month, brand, pipeline, owner, person };
  const where = bookingWhere({ ...base, flag });

  const distinct = async (field: 'planMonth' | 'brand' | 'owner') =>
    (await db.booking.findMany({ where: { [field]: { not: null } }, distinct: [field], select: { [field]: true }, orderBy: { [field]: field === 'planMonth' ? 'desc' : 'asc' } }))
      .map((r) => r[field] as string);

  const [rows, total, allCount, months, brands, owners, sync, flagCounts, byStage] = await Promise.all([
    kanban ? Promise.resolve([] as Row[]) : db.booking.findMany({ where, orderBy: { larkUpdatedAt: 'desc' }, skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    db.booking.count({ where }),
    db.booking.count({ where: bookingWhere(base) }),
    distinct('planMonth'),
    distinct('brand'),
    distinct('owner'),
    db.syncState.findUnique({ where: { id: 'bookings' } }),
    Promise.all(Object.keys(FLAGS).map(async (k) => [k, await db.booking.count({ where: bookingWhere({ ...base, flag: k }) })] as const)),
    kanban
      ? Promise.all(PIPELINE.map(async (st) => {
          const w = bookingWhere({ ...base, flag, pipeline: st });
          return { stage: st, count: await db.booking.count({ where: w }), cards: await db.booking.findMany({ where: w, orderBy: { larkUpdatedAt: 'desc' }, take: KANBAN_CARDS }) };
        }))
      : Promise.resolve([]),
  ]);

  // Link sang hồ sơ KOC: kênh trong booking khớp handle trong Danh bạ (không phân biệt hoa thường).
  const shown = kanban ? byStage.flatMap((s) => s.cards) : rows;
  const kocs = await db.koc.findMany({ where: { platform: 'TikTok', handle: { in: [...new Set(shown.map((r) => r.channel?.toLowerCase()).filter(Boolean) as string[])] } }, select: { id: true, handle: true } });
  const kocId = new Map(kocs.map((k) => [k.handle, k.id]));

  const params = new URLSearchParams(Object.entries({ q, month, brand, pipeline, owner, person, flag, view: kanban ? 'kanban' : '' }).filter(([, v]) => v));
  const withParam = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v); else p.delete(k);
    p.delete('page');
    return p.size ? `?${p}` : '/booking';
  };
  const select = (name: string, value: string, label: string, options: string[]) => (
    <select name={name} defaultValue={value} aria-label={label} className="input w-auto max-w-52">
      <option value="">{label}</option>
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Booking</h1>
          <p className="text-xs text-ink-3">
            {sync?.startedAt && !sync.finishedAt ? 'Đang đồng bộ từ Lark Base, tải lại trang sau 2–3 phút'
              : sync?.finishedAt ? `Lark Base · đồng bộ ${fmtTime(sync.finishedAt)} · ${sync.message}` : 'Chưa đồng bộ từ Lark Base'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md bg-sunken p-0.5 text-[13px]">
            <Link href={withParam('view', '')} className={`rounded px-3 py-1 ${!kanban ? 'bg-surface font-medium shadow-sm' : 'text-ink-3'}`}>Danh sách</Link>
            <Link href={withParam('view', 'kanban')} className={`rounded px-3 py-1 ${kanban ? 'bg-surface font-medium shadow-sm' : 'text-ink-3'}`}>Kanban</Link>
          </div>
          {/* Dữ liệu chỉ cập nhật khi bấm nút này (đã tắt Lark automation vì tốn hạn mức) hoặc khi lịch GitHub chạy. */}
          <form action={syncNow}>
            <button className="btn btn-primary" disabled={Boolean(sync?.startedAt && !sync.finishedAt)}>
              {sync?.startedAt && !sync.finishedAt ? 'Đang đồng bộ…' : 'Đồng bộ ngay từ Lark'}
            </button>
          </form>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {person && <Link href={withParam('person', '')} className="pill bg-accent-soft px-2.5 py-1 text-accent" title="Bỏ lọc">Việc của {person} ✕</Link>}
        <Link href={withParam('flag', '')} className={`pill px-2.5 py-1 ${!flag ? 'bg-ink text-white' : 'bg-surface text-ink-2 ring-1 ring-line'}`}>Tất cả · {fmtNum(allCount)}</Link>
        {flagCounts.map(([k, n]) => (
          <Link key={k} href={withParam('flag', flag === k ? '' : k)} className={`pill px-2.5 py-1 ${flag === k ? 'bg-ink text-white' : n ? 'bg-warning-soft text-warning' : 'bg-surface text-ink-3 ring-1 ring-line'}`}>
            {FLAGS[k].label} · {fmtNum(n)}
          </Link>
        ))}
      </div>

      <form className="mb-3 flex flex-wrap gap-2">
        {kanban && <input type="hidden" name="view" value="kanban" />}
        {flag && <input type="hidden" name="flag" value={flag} />}
        {person && <input type="hidden" name="person" value={person} />}
        <input name="q" defaultValue={q} placeholder="Tìm mã BO, kênh, store, brand" aria-label="Tìm kiếm" className="input max-w-xs" />
        {select('month', month, 'Mọi tháng plan', months)}
        {select('brand', brand, 'Mọi brand', brands)}
        {!kanban && select('pipeline', pipeline, 'Mọi pipeline', PIPELINE)}
        {select('owner', owner, 'Mọi người phụ trách', owners)}
        <button className="btn">Lọc</button>
        {params.size > (kanban ? 1 : 0) && <Link href={kanban ? '/booking?view=kanban' : '/booking'} className="btn border-transparent text-ink-3">Xóa lọc</Link>}
      </form>

      {kanban ? (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {byStage.map((col) => (
            <div key={col.stage} className="w-64 shrink-0 rounded-lg bg-sunken p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className={`pill ${PIPELINE_TONE[col.stage] ?? 'bg-surface text-ink-2'}`}>{col.stage}</span>
                <span className="text-xs text-ink-3">{fmtNum(col.count)}</span>
              </div>
              <div className="space-y-2">
                {col.cards.map((b) => <Card key={b.id} b={b} />)}
                {col.count > col.cards.length && (
                  <Link href={`/booking?${new URLSearchParams([...[...params].filter(([k]) => k !== 'view' && k !== 'pipeline'), ['pipeline', col.stage]])}`} className="block px-1 text-xs text-accent hover:underline">
                    Xem cả {fmtNum(col.count)} booking →
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="tbl">
              <thead>
                <tr><th>Mã booking</th><th>Kênh</th><th>Brand</th><th>Người phụ trách</th><th>Pipeline</th><th>Ngày air</th><th className="text-right">Chi phí</th></tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const x = b.extra as { product?: string; niche?: string; platform?: string };
                  const kid = kocId.get(b.channel?.toLowerCase() ?? '');
                  return (
                    <tr key={b.id}>
                      <td>
                        <Link href={`/booking/${b.id}`} className="font-mono text-xs text-accent hover:underline">{b.code}</Link>
                        {b.planMonth && <div className="text-xs text-ink-3">Plan {b.planMonth}</div>}
                      </td>
                      <td>
                        {b.channel ? (kid ? <Link href={`/contacts/${kid}`} className="link">{b.channel}</Link> : b.channel) : '—'}
                        <div className="text-xs text-ink-3">{[x.platform, x.niche].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>
                        <div>{b.brand ?? '—'}</div>
                        {x.product && <div className="max-w-56 truncate text-xs text-ink-3" title={x.product}>{x.product}</div>}
                      </td>
                      <td>{b.owner ?? '—'}</td>
                      <td>
                        {b.pipeline ? <span className={`pill ${PIPELINE_TONE[b.pipeline] ?? 'bg-sunken text-ink-2'}`}>{b.pipeline}</span> : '—'}
                        <Flags b={b} />
                      </td>
                      <td className="whitespace-nowrap">
                        {b.airDate ? (
                          b.linkAir?.startsWith('http') ? <a href={b.linkAir} target="_blank" rel="noreferrer" className="link">{fmtDate(b.airDate)}</a> : fmtDate(b.airDate)
                        ) : b.planAirDate ? <span className="text-ink-3">Dự kiến {fmtDate(b.planAirDate)}</span> : '—'}
                      </td>
                      <td className="text-right">{fmtNum(b.cost)}</td>
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
      )}
    </>
  );
}

const today = () => new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) + 'T00:00:00+07:00');

function Flags({ b }: { b: Row }) {
  const done = b.pipeline === 'Done' || b.pipeline === 'Làm ĐNTT';
  const airLate = !b.airDate && b.planAirDate && b.planAirDate < today() && !done;
  const noLink = b.airDate && !b.linkAir?.startsWith('http');
  const payIssue = isPayIssue(b.paymentStatus);
  if (!airLate && !noLink && !payIssue) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {airLate && <span className="pill bg-critical-soft text-critical">Trễ air</span>}
      {noLink && <span className="pill bg-warning-soft text-warning">Thiếu link</span>}
      {payIssue && <span className="pill bg-critical-soft text-critical">{b.paymentStatus}</span>}
    </div>
  );
}

function Card({ b }: { b: Row }) {
  return (
    <Link href={`/booking/${b.id}`} className="block rounded-md bg-surface p-2.5 text-xs shadow-sm ring-1 ring-line hover:ring-accent">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-ink-3">{b.code}</span>
        <span className="font-medium">{fmtShort(b.cost)}</span>
      </div>
      <div className="mt-1 truncate text-[13px] font-medium" title={b.channel ?? ''}>{b.channel ?? '—'}</div>
      <div className="truncate text-ink-3">{b.brand ?? '—'} · {b.owner ?? '—'}</div>
      <div className="mt-1 text-ink-3">{b.airDate ? `Air ${fmtDate(b.airDate)}` : b.planAirDate ? `Dự kiến ${fmtDate(b.planAirDate)}` : 'Chưa có lịch air'}</div>
      <Flags b={b} />
    </Link>
  );
}
