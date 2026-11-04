import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { bookingWhere, FLAGS } from '@/lib/bookings';
import { extraNum } from '@/lib/dataSources';
import { db } from '@/lib/db';
import { fmtDate, fmtNum, fmtPct, fmtShort } from '@/lib/format';
import { requireUser } from '@/lib/session';

const vnDay = (offset = 0) => {
  const d = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) + 'T00:00:00+07:00');
  return new Date(d.getTime() + offset * 86_400_000);
};
const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7).replace('-', '/'); // "2026/11" như cột Tháng plan

type Agg = { brand: string | null; owner: string | null; gb: number; go: number; n: number; cost: number; aired: number; done: number; views: number; gmv: number };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const months = (await db.booking.findMany({ where: { planMonth: { not: null } }, distinct: ['planMonth'], select: { planMonth: true }, orderBy: { planMonth: 'desc' } })).map((r) => r.planMonth!);
  const month = sp.month && months.includes(sp.month) ? sp.month : months.includes(thisMonth()) ? thisMonth() : months[0] ?? thisMonth();

  // "Của tôi": tên trên Lark khớp người phụ trách hoặc nằm trong Booking PIC / Account PIC / Leader.
  const name = me.name ?? '';
  const mine: Prisma.BookingWhereInput = name ? bookingWhere({ person: name }) : { id: '' };
  const pick = { id: true, code: true, channel: true, brand: true, planAirDate: true, airDate: true, pipeline: true } as const;
  const upcoming: Prisma.BookingWhereInput = { airDate: null, planAirDate: { gte: vnDay(), lt: vnDay(8) }, pipeline: { notIn: ['Làm ĐNTT', 'Done'] } };

  const [airLate, noLink, soon, follow, listings, flagCounts, agg] = await Promise.all([
    db.booking.findMany({ where: { AND: [mine, FLAGS.airLate.where()] }, select: pick, orderBy: { planAirDate: 'asc' } }),
    db.booking.findMany({ where: { AND: [mine, FLAGS.noLink.where()] }, select: pick, orderBy: { airDate: 'desc' } }),
    db.booking.findMany({ where: { AND: [mine, upcoming] }, select: pick, orderBy: { planAirDate: 'asc' } }),
    db.kocNote.findMany({
      where: { doneAt: null, followUpAt: { lt: vnDay(1) }, OR: [{ authorId: me.id }, { koc: { picId: me.id } }] },
      include: { koc: { select: { id: true, handle: true, name: true, nickname: true } } }, orderBy: { followUpAt: 'asc' },
    }),
    db.listingBatch.findMany({
      where: { createdById: me.id, items: { some: { brandChoice: null } } },
      select: { id: true, name: true, brand: true, shareToken: true, items: { select: { brandChoice: true } } }, orderBy: { updatedAt: 'desc' },
    }),
    Promise.all(Object.keys(FLAGS).map(async (k) => [k, await db.booking.count({ where: bookingWhere({ flag: k }) })] as const)),
    db.$queryRaw<Agg[]>`
      select brand, owner, grouping(brand)::int gb, grouping(owner)::int go, count(*)::int n, coalesce(sum(cost), 0)::float cost,
        count("airDate")::int aired, (count(*) filter (where pipeline = 'Done'))::int done,
        coalesce(sum(${extraNum('views30')}), 0)::float views, coalesce(sum(${extraNum('gmv30')}), 0)::float gmv
      from "Booking" where "planMonth" = ${month}
      group by grouping sets ((brand), (owner), ())`,
  ]);
  const total = agg.find((a) => a.gb && a.go);
  const byBrand = agg.filter((a) => !a.gb).sort((a, b) => b.cost - a.cost);
  const byOwner = agg.filter((a) => !a.go).sort((a, b) => b.n - a.n);
  const roi = (a?: Agg) => (a && a.cost ? a.gmv / a.cost : null);
  const myBookings = `/booking?person=${encodeURIComponent(name)}`;

  return (
    <>
      <div className="mb-4">
        <h1 className="text-xl font-semibold">Chào {name || 'bạn'}</h1>
        <p className="text-[13px] text-ink-2">{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' })}</p>
      </div>

      <h2 className="mb-2 text-base font-semibold">Việc của bạn</h2>
      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Trễ air" tone="critical" count={airLate.length} href={`${myBookings}&flag=airLate`} empty="Không có booking trễ air.">
          {airLate.slice(0, 5).map((b) => <BookingLine key={b.id} b={b} note={`dự kiến ${fmtDate(b.planAirDate)}`} />)}
        </Card>
        <Card title="Air trong 7 ngày tới" count={soon.length} href={myBookings} empty="Chưa có lịch air tuần này.">
          {soon.slice(0, 5).map((b) => <BookingLine key={b.id} b={b} note={fmtDate(b.planAirDate)} />)}
        </Card>
        <Card title="Đã air, thiếu link" tone="warning" count={noLink.length} href={`${myBookings}&flag=noLink`} empty="Booking đã air đều có link.">
          {noLink.slice(0, 5).map((b) => <BookingLine key={b.id} b={b} note={`air ${fmtDate(b.airDate)}`} />)}
        </Card>
        <Card title="Hẹn liên hệ KOL" tone="critical" count={follow.length} href="/contacts?flag=followUp" empty="Không có hẹn đến hạn.">
          {follow.slice(0, 5).map((n) => (
            <Line key={n.id} href={`/contacts/${n.koc.id}`} main={n.koc.nickname ?? n.koc.name} sub={`${fmtDate(n.followUpAt)} · ${n.body}`} />
          ))}
        </Card>
        <Card title="Listing chờ Brand chọn" count={listings.length} href="/listing" empty="Không có đợt listing nào chờ Brand.">
          {listings.slice(0, 5).map((l) => (
            <Line key={l.id} href={`/listing/${l.id}`} main={l.name}
              sub={`${l.items.filter((i) => !i.brandChoice).length}/${l.items.length} KOC chưa chọn${l.shareToken ? ' · đã gửi link' : ' · chưa gửi link'}`} />
          ))}
        </Card>
      </div>
      {!name && <p className="-mt-4 mb-6 text-xs text-ink-3">Tài khoản chưa có tên Lark nên không khớp được booking của bạn.</p>}

      <h2 className="mb-2 text-base font-semibold">Hàng đợi cả team</h2>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {flagCounts.map(([k, n]) => (
          <Link key={k} href={`/booking?flag=${k}`} className={`pill px-2.5 py-1 ${n ? 'bg-warning-soft text-warning' : 'bg-surface text-ink-3 ring-1 ring-line'}`}>
            {FLAGS[k].label} · {fmtNum(n)}
          </Link>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Tháng plan {month}</h2>
        <form className="flex gap-2">
          <select name="month" defaultValue={month} aria-label="Tháng plan" className="input h-8 w-auto text-xs">
            {months.map((m) => <option key={m}>{m}</option>)}
          </select>
          <button className="btn h-8 px-2.5 text-xs">Xem</button>
        </form>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Booking" value={fmtNum(total?.n)} href={`/booking?month=${encodeURIComponent(month)}`} />
        <Kpi label="Chi phí" value={`${fmtShort(total?.cost)} ₫`} />
        <Kpi label="Đã air" value={fmtNum(total?.aired)} sub={total?.n ? `${fmtPct(total.aired / total.n, 0)} số booking` : undefined} />
        <Kpi label="Done" value={fmtNum(total?.done)} />
        <Kpi label="View 30 ngày" value={fmtShort(total?.views)} />
        <Kpi label="GMV 30 ngày" value={`${fmtShort(total?.gmv)} ₫`} sub={roi(total) ? `GMV / chi phí ${roi(total)!.toFixed(2).replace('.', ',')}` : undefined} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <AggTable title="Theo brand" rows={byBrand} label={(a) => a.brand} link={(v) => `/booking?month=${encodeURIComponent(month)}&brand=${encodeURIComponent(v)}`} />
        <AggTable title="Theo người phụ trách" rows={byOwner} label={(a) => a.owner} link={(v) => `/booking?month=${encodeURIComponent(month)}&owner=${encodeURIComponent(v)}`} />
      </div>
      <p className="mt-2 text-xs text-ink-3">Theo cột Tháng plan trên Lark. View / GMV 30 ngày do team điền trên Lark; booking chưa điền số tính là 0.</p>
    </>
  );
}

function Card({ title, count, href, tone, empty, children }: { title: string; count: number; href: string; tone?: 'critical' | 'warning'; empty: string; children: React.ReactNode }) {
  const toneCls = count && tone === 'critical' ? 'text-critical' : count && tone === 'warning' ? 'text-warning' : '';
  return (
    <section className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <Link href={href} className={`text-lg font-semibold tabular-nums hover:underline ${toneCls}`}>{fmtNum(count)}</Link>
      </div>
      {count ? <ul className="space-y-1.5">{children}</ul> : <p className="text-[13px] text-ink-3">{empty}</p>}
    </section>
  );
}

function Line({ href, main, sub }: { href: string; main: string; sub: string }) {
  return (
    <li className="text-[13px]">
      <Link href={href} className="font-medium hover:text-accent hover:underline">{main}</Link>
      <div className="truncate text-xs text-ink-3" title={sub}>{sub}</div>
    </li>
  );
}

function BookingLine({ b, note }: { b: { id: string; code: string; channel: string | null; brand: string | null }; note: string }) {
  return <Line href={`/booking/${b.id}`} main={`${b.channel ?? '—'} · ${b.brand ?? '—'}`} sub={`${b.code} · ${note}`} />;
}

function Kpi({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const v = <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>;
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-xs text-ink-3">{label}</div>
      {href ? <Link href={href} className="hover:text-accent">{v}</Link> : v}
      {sub && <div className="text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function AggTable({ title, rows, label, link }: { title: string; rows: Agg[]; label: (a: Agg) => string | null; link: (v: string) => string }) {
  return (
    <section className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="tbl">
        <thead>
          <tr><th>{title}</th><th className="text-right">Booking</th><th className="text-right">Chi phí</th><th className="text-right">Đã air</th><th className="text-right">GMV 30 ngày</th><th className="text-right">GMV / chi phí</th></tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const v = label(a);
            return (
              <tr key={v ?? '(trống)'}>
                <td>{v ? <Link href={link(v)} className="link">{v}</Link> : <span className="text-ink-3">(trống)</span>}</td>
                <td className="text-right tabular-nums">{fmtNum(a.n)}</td>
                <td className="text-right tabular-nums">{fmtShort(a.cost)}</td>
                <td className="text-right tabular-nums">{fmtPct(a.n ? a.aired / a.n : null, 0)}</td>
                <td className="text-right tabular-nums">{fmtShort(a.gmv)}</td>
                <td className="text-right tabular-nums">{a.cost && a.gmv ? (a.gmv / a.cost).toFixed(2).replace('.', ',') : '—'}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={6} className="py-8 text-center text-ink-3">Không có booking trong tháng này.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
