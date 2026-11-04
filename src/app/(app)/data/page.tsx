import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { CHECKS, QUALITY_DAYS, qualityCounts, qualityRows } from '@/lib/dataQuality';
import { db } from '@/lib/db';
import { LARK, larkStats, MARKET, marketStats, sourceOf, STATION, topCreators, type Source, type SourceStats, type TopRow } from '@/lib/dataSources';
import { fmtDate, fmtNum, fmtPct, fmtShort } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { refreshData } from './actions';

type Search = { src?: string; ours?: string; by?: string; check?: string };
type Saved = SourceStats | { error: string } | undefined;

const GROUP = { lark: 'Lark Base', partner: 'TikTok Partner Center', seller: 'TikTok Seller Center' };
const val = (v: number, money?: boolean) => (money ? `${fmtShort(v)} ₫` : fmtShort(v));
const day = (s: string | null) => (s ? fmtDate(new Date(s)) : '—');
const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

export default async function DataPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const src = sp.src ? sourceOf(sp.src) : undefined;
  if (src) return <Drill s={src} ours={sp.ours === '1'} by={Math.min(Math.max(Math.trunc(Number(sp.by)) || 0, 0), src.metrics.length - 1)} />;
  if (sp.check && CHECKS.some((c) => c.key === sp.check)) return <CheckList check={sp.check} />;

  const [state, lark, market, kocTotal, quality] = await Promise.all([
    db.syncState.findUnique({ where: { id: 'data-sources' } }),
    larkStats(),
    marketStats(),
    db.koc.count({ where: { platform: 'TikTok' } }),
    qualityCounts(),
  ]);
  const saved = (state?.data ?? {}) as Record<string, Saved>;
  const running = Boolean(state?.startedAt && !state.finishedAt);
  const groups: { key: keyof typeof GROUP; note: string; rows: [Source, Saved, string?][] }[] = [
    { key: 'lark', note: 'Bảng "3.2 List duyệt book", đồng bộ mỗi giờ', rows: [[LARK, lark]] },
    { key: 'partner', note: 'Tài khoản MCN / TAP, đọc qua Trạm dữ liệu', rows: STATION.filter((s) => s.group === 'partner').map((s) => [s, saved[s.key]]) },
    {
      key: 'seller', note: 'Các shop VN, đọc qua Trạm dữ liệu',
      rows: [...STATION.filter((s) => s.group === 'seller').map((s): [Source, Saved] => [s, saved[s.key]]), [MARKET, market, `đã tra ${fmtNum(market.checked)} KOL`]],
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dữ liệu</h1>
          <p className="mt-1 text-[13px] text-ink-2">Mỗi nguồn có bao nhiêu creator, bao nhiêu KOL trong Danh bạ ({fmtNum(kocTotal)}) có mặt, và hiệu quả của họ. Bấm tên bảng để xem từng creator.</p>
        </div>
        <form action={refreshData} className="flex items-center gap-3">
          <span className="text-xs text-ink-3">
            {running ? 'Đang tổng hợp TikTok, tải lại trang sau 1–2 phút' : state?.finishedAt ? `TikTok tổng hợp ${fmtTime(state.finishedAt)} · ${state.message}` : 'TikTok chưa tổng hợp'}
          </span>
          <button className="btn" disabled={running}>Làm mới</button>
        </form>
      </div>

      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.key}>
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
              <h2 className="text-base font-semibold">{GROUP[g.key]}</h2>
              <span className="text-xs text-ink-3">{g.note}</span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-line bg-surface">
              <table className="tbl">
                <thead>
                  <tr><th>Bảng</th><th>Phủ dữ liệu</th><th className="text-right">Creator</th><th className="text-right">KOL Danh bạ có mặt</th><th>Hiệu quả · mọi creator</th><th>Hiệu quả · KOL Danh bạ</th></tr>
                </thead>
                <tbody>
                  {g.rows.map(([s, st, extra]) => (
                    <tr key={s.key} className="align-top">
                      <td className="min-w-52">
                        <Link href={`/data?src=${s.key}`} className="font-medium text-accent hover:underline">{s.name}</Link>
                        <div className="text-xs text-ink-3">{s.note}</div>
                      </td>
                      {!st || 'error' in st ? (
                        <td colSpan={5} className="text-[13px] text-ink-3">{st ? `Lỗi: ${st.error}` : 'Chưa tổng hợp, bấm Làm mới.'}</td>
                      ) : (
                        <>
                          <td className="whitespace-nowrap text-[13px]">
                            {day(st.from)} – {day(st.to)}
                            <div className="text-xs text-ink-3">{fmtNum(st.rows)} dòng{extra ? ` · ${extra}` : ''}</div>
                          </td>
                          <td className="text-right font-medium tabular-nums">{fmtNum(st.creators)}</td>
                          <td className="text-right tabular-nums">
                            {fmtNum(st.ours.creators)}
                            <div className="text-xs text-ink-3">{fmtPct(kocTotal ? st.ours.creators / kocTotal : null)} Danh bạ</div>
                          </td>
                          <td><Metrics s={s} m={st.m} /></td>
                          <td><Metrics s={s} m={st.ours.m} /></td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
      <section className="mt-5">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-base font-semibold">Kiểm soát nhập liệu</h2>
          <span className="text-xs text-ink-3">Booking trên Lark Base air / dự kiến air từ {QUALITY_DAYS} ngày trước hoặc tháng plan gần đây; sửa trên Lark, lượt đồng bộ sau tự hết</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="tbl">
            <thead><tr><th>Lỗi</th><th>Ảnh hưởng</th><th className="text-right">Booking</th></tr></thead>
            <tbody>
              {quality.map((q) => (
                <tr key={q.key}>
                  <td>{q.n ? <Link href={`/data?check=${q.key}`} className="font-medium text-accent hover:underline">{q.label}</Link> : q.label}</td>
                  <td className="text-[13px] text-ink-3">{q.hint}</td>
                  <td className={`text-right font-medium tabular-nums ${q.n ? 'text-warning' : 'text-positive'}`}>{fmtNum(q.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-4 text-xs text-ink-3">
        Các bảng chồng lấn nhau (cùng một đơn có thể nằm ở Đơn MCN, Đơn TAP và Đơn affiliate của shop), nên không cộng số giữa các bảng.
        Creator khớp Danh bạ theo username TikTok.
      </p>
    </>
  );
}

function Metrics({ s, m }: { s: Source; m: number[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-[13px] whitespace-nowrap">
      {s.metrics.map((x, i) => (
        <div key={x.label} className="contents">
          <dt className="text-ink-3">{x.label}</dt>
          <dd className="text-right tabular-nums">{val(m[i], x.money)}</dd>
        </div>
      ))}
    </dl>
  );
}

async function Drill({ s, ours, by }: { s: Source; ours: boolean; by: number }) {
  const local = s.group === 'lark' || s.key === 'marketplace'; // nguồn chỉ gồm KOL Danh bạ
  let rows: TopRow[] = [];
  let error = '';
  try {
    rows = await topCreators(s, ours, by, ours ? 1000 : 100);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const kocs = await db.koc.findMany({
    where: { platform: 'TikTok', handle: { in: rows.map((r) => r.handle.toLowerCase()) } },
    select: { id: true, handle: true, name: true, nickname: true, avatarUrl: true },
  });
  const kocOf = new Map(kocs.map((k) => [k.handle, k]));
  const href = (o: { ours?: boolean; by?: number }) => {
    const p = new URLSearchParams({ src: s.key });
    if (o.ours ?? ours) p.set('ours', '1');
    if (o.by ?? by) p.set('by', String(o.by ?? by));
    return `/data?${p}`;
  };

  return (
    <>
      <Link href="/data" className="text-xs text-ink-3 hover:text-ink">← Dữ liệu</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{s.name}</h1>
          <p className="mt-1 text-[13px] text-ink-2">{GROUP[s.group]} · {s.note}</p>
        </div>
        {!local && (
          <div className="flex rounded-md bg-sunken p-0.5 text-[13px]">
            <Link href={href({ ours: false })} className={`rounded px-3 py-1 ${!ours ? 'bg-surface font-medium shadow-sm' : 'text-ink-3'}`}>Mọi creator</Link>
            <Link href={href({ ours: true })} className={`rounded px-3 py-1 ${ours ? 'bg-surface font-medium shadow-sm' : 'text-ink-3'}`}>Chỉ KOL Danh bạ</Link>
          </div>
        )}
      </div>

      {error ? (
        <p role="alert" className="rounded-md bg-critical-soft px-3 py-2 text-critical">
          Không đọc được Trạm dữ liệu: {error}.{/HTTP 5/.test(error) && ' Trạm đang bận, tải lại trang sau ít phút.'}{!ours && ' Có thể xem "Chỉ KOL Danh bạ" (số đã lưu sẵn).'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Creator</th>
                {s.metrics.map((x, i) => (
                  <th key={x.label} className="text-right">
                    <Link href={href({ by: i })} className={i === by ? 'text-ink' : 'hover:text-ink'}>{x.label}{i === by ? ' ↓' : ''}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, n) => {
                const k = kocOf.get(r.handle.toLowerCase());
                return (
                  <tr key={r.handle}>
                    <td className="text-ink-3 tabular-nums">{n + 1}</td>
                    <td>
                      {k ? (
                        <Link href={`/contacts/${k.id}`} className="flex items-center gap-2">
                          <Avatar src={k.avatarUrl} name={k.nickname ?? k.name} size={24} />
                          <span className="link">@{r.handle}</span>
                          <span className="pill bg-accent-soft text-accent">Danh bạ</span>
                        </Link>
                      ) : (
                        <a href={`https://www.tiktok.com/@${encodeURIComponent(r.handle)}`} target="_blank" rel="noreferrer" className="hover:underline">@{r.handle}</a>
                      )}
                    </td>
                    {s.metrics.map((x, i) => <td key={x.label} className="text-right tabular-nums">{x.money ? `${fmtNum(r.m[i])} ₫` : fmtNum(r.m[i])}</td>)}
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={s.metrics.length + 2} className="py-12 text-center text-ink-3">Không có creator nào.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-3">
        {ours ? `${fmtNum(rows.length)} KOL Danh bạ có dữ liệu ở bảng này, số lưu lúc tổng hợp gần nhất` : `Top 100 theo ${s.metrics[by].label}`}. Bấm tiêu đề cột để xếp theo chỉ số khác.
      </p>
    </>
  );
}

async function CheckList({ check }: { check: string }) {
  const c = CHECKS.find((x) => x.key === check)!;
  const rows = (await qualityRows(check)) ?? [];
  return (
    <>
      <Link href="/data" className="text-xs text-ink-3 hover:text-ink">← Dữ liệu</Link>
      <h1 className="mt-2 text-xl font-semibold">{c.label}</h1>
      <p className="mt-1 mb-4 text-[13px] text-ink-2">{c.hint}. Booking air / dự kiến air từ {QUALITY_DAYS} ngày trước hoặc tháng plan gần đây, tối đa 500 dòng; mở booking rồi bấm "Mở trên Lark" để sửa.</p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead><tr><th>Mã booking</th><th>ID kênh</th><th>Brand</th><th>Tháng plan</th><th>Người phụ trách</th><th className="text-right">Chi phí</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/booking/${r.id}`} className="font-mono text-xs text-accent hover:underline">{r.code}</Link></td>
                <td>{r.channel ? <code className="rounded bg-sunken px-1 text-xs">{r.channel}</code> : '—'}</td>
                <td>{r.brand ?? '—'}</td>
                <td>{r.planMonth ?? '—'}</td>
                <td>{r.owner ?? '—'}</td>
                <td className="text-right tabular-nums">{fmtNum(r.cost)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="py-12 text-center text-ink-3">Không còn booking nào lỗi này.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
