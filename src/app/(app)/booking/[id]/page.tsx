import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/ui';
import { isPayIssue, PIPELINE, PIPELINE_TONE } from '@/lib/bookings';
import { db } from '@/lib/db';
import { fmtDate, fmtNum, fmtShort, fmtVnd } from '@/lib/format';
import { FEE_DIVISOR } from '@/lib/kocInsights';
import { requireUser } from '@/lib/session';

const LARK_BASE = 'https://upbasevn.sg.larksuite.com/base/W6vRbbuOVar3qtsV18dlan1xgXb?table=tbluWrjJd9Pt9uzb';
const today = () => new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) + 'T00:00:00+07:00');
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

type Extra = Record<string, string | null | undefined>;

export default async function BookingDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const b = await db.booking.findUnique({ where: { id } });
  if (!b) notFound();
  const x = b.extra as Extra;
  const koc = b.channel ? await db.koc.findFirst({ where: { platform: 'TikTok', handle: b.channel.toLowerCase() } }) : null;
  const stage = b.pipeline ? PIPELINE.indexOf(b.pipeline) : -1;

  // Mốc kế hoạch (công thức P.Ngày trên Lark) và lúc coi là đã qua mốc, theo chặng pipeline hiện tại.
  const milestones: { label: string; plan: Date | null; actual?: Date | null; doneAt: number; note?: string | null }[] = [
    { label: 'Gửi hàng', plan: b.planShipDate, doneAt: 1 },
    { label: 'KOC nhận hàng', plan: b.planReceiveDate, doneAt: 2 },
    { label: 'KOC gửi kịch bản', plan: b.planScriptDate, doneAt: 2 },
    { label: 'KOC gửi demo', plan: b.planDemoDate, doneAt: 3 },
    { label: 'Air video', plan: b.planAirDate, actual: b.airDate, doneAt: 3 },
    { label: 'Điền link air', plan: null, actual: x.airLinkFilledAt ? new Date(Number(x.airLinkFilledAt)) : null, doneAt: 4, note: x.airLinkOnTime },
    { label: 'Làm ĐNTT', plan: b.planPaymentDate, doneAt: 5 },
  ];
  const personal = /TNCN/i.test(x.accountType ?? '');

  return (
    <>
      <Link href="/booking" className="text-xs text-ink-3 hover:text-ink">← Booking</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold">{b.code}</h1>
            {b.pipeline && <span className={`pill ${PIPELINE_TONE[b.pipeline] ?? 'bg-sunken text-ink-2'}`}>{b.pipeline}</span>}
            {b.slaLate && b.pipeline !== 'Done' && <span className="pill bg-critical-soft text-critical">Lark: trễ SLA</span>}
            {b.paymentStatus && <span className={`pill ${isPayIssue(b.paymentStatus) ? 'bg-critical-soft text-critical' : 'bg-sunken text-ink-2'}`}>Phiếu TT: {b.paymentStatus}</span>}
          </div>
          <p className="mt-1 text-[13px] text-ink-2">{[b.brand, b.store, x.product].filter(Boolean).join(' · ')}</p>
        </div>
        <a href={`${LARK_BASE}&record=${b.id}`} target="_blank" rel="noreferrer" className="btn">Mở trên Lark</a>
      </div>

      {/* Thanh chặng */}
      <ol className="mb-4 grid grid-cols-6 gap-1 text-center text-xs">
        {PIPELINE.map((p, i) => (
          <li key={p} className={`rounded px-1 py-1.5 ${i < stage ? 'bg-positive-soft text-positive' : i === stage ? 'bg-accent text-white font-medium' : 'bg-sunken text-ink-3'}`}>{p}</li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="KOC & phân công">
          {koc ? (
            <Link href={`/contacts/${koc.id}`} className="mb-3 flex items-center gap-3 rounded-md p-2 ring-1 ring-line hover:ring-accent">
              <Avatar src={koc.avatarUrl} name={koc.nickname ?? koc.name} size={40} />
              <div className="min-w-0">
                <div className="font-medium">{koc.nickname ?? koc.name}</div>
                <div className="text-xs text-ink-3">@{koc.handle} · {fmtShort(koc.followers)} follower · {koc.bookingCount} booking với UB</div>
              </div>
            </Link>
          ) : <p className="mb-3 text-[13px] text-ink-3">Kênh {b.channel ?? '—'} chưa có trong Danh bạ.</p>}
          <Info rows={[
            ['Cấp KOL', x.kl], ['Tệp kênh', x.niche], ['Nền tảng', x.platform], ['Hình thức hợp tác', x.coopType],
            ['Định dạng nghiệm thu', x.format], ['Tháng plan', b.planMonth], ['Đợt listing', x.listingRound],
            ['Người phụ trách', b.owner], ['Booking PIC', b.bookingPic], ['Account PIC', b.accountPic], ['Leader', b.leader],
          ]} />
        </Section>

        <Section title="Mốc thời gian" meta="Kế hoạch theo công thức trên Lark">
          <table className="tbl">
            <thead><tr><th>Mốc</th><th>Kế hoạch</th><th>Thực tế</th><th /></tr></thead>
            <tbody>
              {milestones.map((m) => {
                const passed = m.actual != null || (stage >= m.doneAt);
                const late = !passed && m.plan && m.plan < today();
                return (
                  <tr key={m.label}>
                    <td>{m.label}</td>
                    <td>{fmtDate(m.plan)}</td>
                    <td>{m.actual ? fmtDate(m.actual) : passed ? <span className="text-ink-3">Đã qua chặng</span> : '—'}</td>
                    <td className="text-right">
                      {late && <span className="pill bg-critical-soft text-critical">Quá hạn</span>}
                      {m.note && <span className={`pill ${m.note === 'Trễ' ? 'bg-warning-soft text-warning' : 'bg-positive-soft text-positive'}`}>{m.note}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {x.slaNote && <p className="mt-2 text-[13px]">Giải trình trễ SLA: {x.slaNote}</p>}
        </Section>

        <Section title="Chi phí & thanh toán">
          <Info rows={[
            ['Chi phí booking', fmtVnd(b.cost)],
            ['Kèm thuế TNCN', personal && b.cost ? fmtVnd(b.cost / FEE_DIVISOR) : '—'],
            ['Loại tài khoản', x.accountType],
            ['Tạm ứng trước', num(x.advance) ? fmtVnd(num(x.advance)) : '—'],
            ['Trạng thái tạm ứng', x.advanceStatus],
            ['Cần thanh toán', fmtVnd(num(x.amountDue))],
            ['Đã thanh toán', fmtVnd(num(x.amountPaid))],
            ['Chờ thanh toán', fmtVnd(num(x.amountPending))],
            ['Phiếu thanh toán', b.paymentStatus],
          ]} />
          {x.contractLink && <a href={x.contractLink.split(', ')[0]} target="_blank" rel="noreferrer" className="link mt-2 inline-block text-[13px]">Mở hợp đồng</a>}
        </Section>

        <Section title="Kết quả video">
          <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Stat label="View 14 ngày" value={fmtShort(num(x.views14))} />
            <Stat label="GMV 14 ngày" value={fmtShort(num(x.gmv14))} />
            <Stat label="View 30 ngày" value={fmtShort(num(x.views30))} />
            <Stat label="GMV 30 ngày" value={fmtShort(num(x.gmv30))} sub={num(x.orders30) != null ? `${fmtNum(num(x.orders30))} đơn` : undefined} />
          </div>
          <Info rows={[
            ['Link air', b.linkAir],
            ['Ngày air thật', fmtDate(b.airDate)],
            ['Mã ủy quyền ads', x.adsCode],
            ['Ghi chú', x.note],
          ]} />
        </Section>
      </div>
    </>
  );
}

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {meta && <span className="text-xs text-ink-3">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function Info({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className={`min-w-0 break-words ${v && v !== '—' ? '' : 'text-ink-3'}`}>
            {v?.startsWith?.('http') ? <a href={v} target="_blank" rel="noreferrer" className="link">{v}</a> : v || '—'}
          </dd>
        </div>
      ))}
    </dl>
  );
}
