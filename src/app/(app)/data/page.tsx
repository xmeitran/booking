import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { CHECKS, QUALITY_DAYS, qualityCounts, qualityRows } from '@/lib/dataQuality';
import { db } from '@/lib/db';
import { byShop, LARK, larkStats, MARKET, marketStats, ORIGIN, originOf, sourceOf, STATION, topCreators, type ShopRow, type Source, type SourceStats, type TopRow } from '@/lib/dataSources';
import { fmtDate, fmtNum, fmtPct, fmtShort } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { refreshData } from './actions';

type Search = { src?: string; ours?: string; by?: string; check?: string; view?: string; shop?: string; notfound?: string };
type Saved = SourceStats | { error: string } | undefined;

const GROUP = { lark: 'Lark Base', partner: 'TikTok Partner Center', seller: 'TikTok Seller Center' };
const val = (v: number, money?: boolean) => (money ? `${fmtShort(v)} ₫` : fmtShort(v));
const day = (s: string | null) => (s ? fmtDate(new Date(s)) : '—');
const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

export default async function DataPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const src = sp.src ? sourceOf(sp.src) : undefined;
  if (src) return <Drill s={src} ours={sp.ours === '1'} shopView={sp.view === 'shop' && Boolean(src.shop)} shop={src.shop ? sp.shop : undefined} by={Math.min(Math.max(Math.trunc(Number(sp.by)) || 0, 0), src.metrics.length - 1)} />;
  if (sp.check && CHECKS.some((c) => c.key === sp.check)) return <CheckList check={sp.check} />;

  const [state, lark, market, kocTotal, quality, syncs] = await Promise.all([
    db.syncState.findUnique({ where: { id: 'data-sources' } }),
    larkStats(),
    marketStats(),
    db.koc.count({ where: { platform: 'TikTok' } }),
    qualityCounts(),
    db.syncState.findMany({ where: { id: { in: ['bookings', 'creators'] } } }),
  ]);
  const syncAt = (id: string) => syncs.find((x) => x.id === id)?.finishedAt ?? null;
  const origins: [keyof typeof ORIGIN, Date | null][] = [['lark', syncAt('bookings')], ['partner', state?.finishedAt ?? null], ['seller', state?.finishedAt ?? null], ['marketplace', syncAt('creators')]];
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
          <p className="mt-1 max-w-3xl text-[13px] text-ink-2">
            Booking Hub lấy số về creator từ 4 nơi dưới đây. Mỗi bảng cho biết có bao nhiêu creator, bao nhiêu KOL trong Danh bạ ({fmtNum(kocTotal)}) có mặt và hiệu quả của họ.
            Bấm tên bảng để xem từng creator; bấm một creator để xem đủ mọi nguồn và dữ liệu gốc.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <form action="/creator" className="flex gap-2">
            <input name="h" required placeholder="@username hoặc link TikTok" aria-label="Tra một creator" className="input h-8 w-64 text-[13px]" />
            <button className="btn h-8 px-3 text-xs">Tra creator</button>
          </form>
          <form action={refreshData} className="flex items-center gap-2">
            <span className="text-xs text-ink-3">
              {running ? 'Đang tổng hợp TikTok (~10 phút), tải lại trang sau' : state?.finishedAt ? `TikTok tổng hợp ${fmtTime(state.finishedAt)} · ${state.message}` : 'TikTok chưa tổng hợp'}
            </span>
            <button className="btn h-8 px-3 text-xs" disabled={running}>Làm mới</button>
          </form>
        </div>
      </div>
      {sp.notfound && <p role="alert" className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-warning">Không đọc được username TikTok. Nhập dạng @username hoặc dán link kênh.</p>}

      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold">Dữ liệu đến từ đâu</h2>
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {origins.map(([k, at], i) => (
            <li key={k} className="rounded-lg border border-line bg-surface px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold"><span className="mr-1.5 text-ink-3">{i + 1}.</span>{ORIGIN[k].name}</span>
                <KindPill k={k} />
              </div>
              <p className="mt-1 text-xs text-ink-2">{ORIGIN[k].path}</p>
              <p className="mt-1.5 text-xs text-ink-3">Cập nhật {ORIGIN[k].schedule}{at ? ` · lần cuối ${fmtTime(at)}` : ' · chưa chạy'}</p>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-ink-3">
          <span className="pill bg-positive-soft text-positive">Số TikTok trả về</span> = API TikTok trả, không ai sửa tay.{' '}
          <span className="pill bg-warning-soft text-warning">Team tự điền</span> = team nhập trên Lark, có thể thiếu hoặc sai (xem mục Kiểm soát nhập liệu cuối trang).
        </p>
      </section>

      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.key}>
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-base font-semibold">{GROUP[g.key]}</h2>
              <KindPill k={g.key} />
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
          <dt className={`text-ink-3 ${x.hint ? 'cursor-help underline decoration-dotted underline-offset-2' : ''}`} title={x.hint}>{x.label}</dt>
          <dd className="text-right tabular-nums">{val(m[i], x.money)}</dd>
        </div>
      ))}
    </dl>
  );
}

async function Drill({ s, ours, shopView, shop, by }: { s: Source; ours: boolean; shopView: boolean; shop?: string; by: number }) {
  const local = s.group === 'lark' || s.key === 'marketplace'; // nguồn chỉ gồm KOL Danh bạ
  let rows: TopRow[] = [];
  let shops: { rows: (ShopRow & { creators: number })[]; total: number } = { rows: [], total: 0 };
  let at: Date | null = null;
  let error = '';
  try {
    if (shopView) ({ at, ...shops } = await byShop(s, by));
    else ({ rows, at } = await topCreators(s, ours, by, ours ? 1000 : 100, shop));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const kocs = await db.koc.findMany({
    where: { platform: 'TikTok', handle: { in: rows.map((r) => r.handle.toLowerCase()) } },
    select: { id: true, handle: true, name: true, nickname: true, avatarUrl: true },
  });
  const kocOf = new Map(kocs.map((k) => [k.handle, k]));
  const href = (o: { ours?: boolean; by?: number; view?: string; shop?: string | null }) => {
    const p = new URLSearchParams({ src: s.key });
    if ((o.ours ?? ours) && o.view !== 'shop') p.set('ours', '1');
    if (o.view ?? (shopView ? 'shop' : '')) p.set('view', o.view ?? 'shop');
    const sh = o.shop === null ? undefined : o.shop ?? shop;
    if (sh !== undefined && (o.view ?? '') !== 'shop') p.set('shop', sh);
    if (o.by ?? by) p.set('by', String(o.by ?? by));
    return `/data?${p}`;
  };
  const shopName = shop !== undefined ? rows[0]?.shops?.find((x) => x.key === shop)?.shop ?? (shop || '(trống)') : '';
  const sortHead = (x: { label: string; hint?: string }, i: number) => (
    <th key={x.label} className="text-right" title={x.hint}>
      <Link href={href({ by: i })} className={i === by ? 'text-ink' : 'hover:text-ink'}>{x.label}{i === by ? ' ↓' : ''}</Link>
    </th>
  );
  const cell = (x: { money?: boolean }, v: number) => (x.money ? `${fmtNum(v)} ₫` : fmtNum(v));
  const tab = (active: boolean, to: string, label: string) => (
    <Link href={to} className={`rounded px-3 py-1 ${active ? 'bg-surface font-medium shadow-sm' : 'text-ink-3'}`}>{label}</Link>
  );

  return (
    <>
      <Link href="/data" className="text-xs text-ink-3 hover:text-ink">← Dữ liệu</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{s.name}</h1>
          <p className="mt-1 text-[13px] text-ink-2">{GROUP[s.group]} · {s.note}</p>
        </div>
        {(!local || s.shop) && (
          <div className="flex rounded-md bg-sunken p-0.5 text-[13px]">
            {local ? tab(!shopView, href({ view: '' }), 'Theo creator') : (
              <>
                {tab(!shopView && !ours, href({ ours: false, view: '' }), 'Mọi creator')}
                {tab(!shopView && ours, href({ ours: true, view: '' }), 'Chỉ KOL Danh bạ')}
              </>
            )}
            {s.shop && tab(shopView, href({ view: 'shop' }), `Theo ${s.shop.label.toLowerCase()}`)}
          </div>
        )}
      </div>

      <dl className="mb-3 grid gap-x-6 gap-y-1 rounded-md bg-sunken px-3 py-2 text-xs sm:grid-cols-3">
        <div><dt className="inline text-ink-3">Đến từ: </dt><dd className="inline">{originOf(s).path}</dd></div>
        <div><dt className="inline text-ink-3">Loại số: </dt><dd className="inline"><KindPill k={s.key === 'marketplace' ? 'marketplace' : s.group} /></dd></div>
        <div>
          <dt className="inline text-ink-3">Số trên trang: </dt>
          <dd className="inline">{at ? `kéo sẵn lúc ${fmtTime(at)}` : local || ours ? 'lưu trong Booking Hub' : 'tra trực tiếp lúc mở trang'} · cập nhật {originOf(s).schedule}</dd>
        </div>
      </dl>

      {shop !== undefined && !shopView && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="pill bg-accent-soft px-2.5 py-1 text-accent">{s.shop?.label}: {shopName}</span>
          <Link href={href({ shop: null })} className="link">Bỏ lọc</Link>
          <span className="text-xs text-ink-3">Số trong bảng chỉ tính phần của {s.shop?.label.toLowerCase()} này.</span>
        </p>
      )}

      {error ? (
        <p role="alert" className="rounded-md bg-critical-soft px-3 py-2 text-critical">
          Không đọc được Trạm dữ liệu: {error}.{/HTTP 5/.test(error) && ' Trạm đang bận, tải lại trang sau ít phút.'}{!ours && !shopView && ' Có thể xem "Chỉ KOL Danh bạ" (số đã lưu sẵn).'}
        </p>
      ) : shopView ? (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="tbl">
            <thead>
              <tr><th className="w-10">#</th><th>{s.shop!.label}</th><th className="text-right">Creator</th>{s.metrics.map(sortHead)}</tr>
            </thead>
            <tbody>
              {shops.rows.map((r, n) => (
                <tr key={r.key + n}>
                  <td className="text-ink-3 tabular-nums">{n + 1}</td>
                  <td className="max-w-80"><Link href={href({ view: '', ours: false, shop: r.key })} className="link">{r.shop}</Link></td>
                  <td className="text-right tabular-nums">{fmtNum(r.creators)}</td>
                  {s.metrics.map((x, i) => <td key={x.label} className="text-right tabular-nums">{cell(x, r.m[i])}</td>)}
                </tr>
              ))}
              {!shops.rows.length && <tr><td colSpan={s.metrics.length + 3} className="py-12 text-center text-ink-3">Không có dữ liệu.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Creator</th>
                {s.metrics.map(sortHead)}
                {s.shop && <th>{s.shop.label} đã bán / hợp tác</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, n) => {
                const k = kocOf.get(r.handle.toLowerCase());
                return (
                  <tr key={r.handle} className="align-top">
                    <td className="text-ink-3 tabular-nums">{n + 1}</td>
                    <td>
                      <Link href={`/creator/${encodeURIComponent(r.handle.toLowerCase())}`} className="flex items-center gap-2" title="Xem hiệu quả ở mọi nguồn và dữ liệu gốc">
                        <Avatar src={k?.avatarUrl} name={k ? k.nickname ?? k.name : r.handle} size={24} />
                        <span className="link">@{r.handle}</span>
                        {k && <span className="pill bg-accent-soft text-accent">Danh bạ</span>}
                      </Link>
                    </td>
                    {s.metrics.map((x, i) => <td key={x.label} className="text-right tabular-nums">{cell(x, r.m[i])}</td>)}
                    {s.shop && <td><Shops s={s} list={r.shops ?? []} href={(key) => href({ shop: key })} /></td>}
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={s.metrics.length + 3} className="py-12 text-center text-ink-3">Không có creator nào.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-3">
        {shopView
          ? `${fmtNum(shops.total)} ${s.shop!.label.toLowerCase()}${shops.total > shops.rows.length ? `, hiện ${shops.rows.length} đầu` : ''}. Bấm tên để xem creator của ${s.shop!.label.toLowerCase()} đó.`
          : ours ? `${fmtNum(rows.length)} KOL Danh bạ có dữ liệu ở bảng này, số lưu lúc tổng hợp gần nhất` : `Top 100 theo ${s.metrics[by].label}`}
        {!shopView && '. Bấm tiêu đề cột để xếp theo chỉ số khác.'}
        {s.shop && !shopView && ` Cột ${s.shop.label.toLowerCase()}: tối đa 20 ${s.shop.label.toLowerCase()} lớn nhất mỗi creator, theo ${s.metrics[0].label}; bấm để lọc.`}
        {at && ` Số kéo sẵn lúc ${fmtTime(at)} (tự cập nhật 6 giờ một lần, hoặc bấm Làm mới ở trang Dữ liệu).`}
      </p>
      <section className="mt-4 rounded-lg border border-line bg-sunken px-5 py-3 text-[13px]">
        <h2 className="mb-1.5 text-sm font-semibold">Các cột được tính thế nào</h2>
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {s.metrics.map((x) => (
            <div key={x.label}><dt className="inline font-medium">{x.label}: </dt><dd className="inline text-ink-2">{x.hint ?? '—'}</dd></div>
          ))}
        </dl>
      </section>
    </>
  );
}

/** Danh sách shop / brand của một creator: 3 dòng đầu, còn lại gộp "+n" (di chuột để xem). */
function Shops({ s, list, href }: { s: Source; list: ShopRow[]; href: (key: string) => string }) {
  if (!list.length) return <span className="text-xs text-ink-3">—</span>;
  const x = s.metrics[0];
  const v = (r: ShopRow) => (x.money ? `${fmtShort(r.m[0])} ₫` : fmtShort(r.m[0]));
  return (
    <ul className="min-w-56 space-y-0.5 text-xs">
      {list.slice(0, 3).map((r) => (
        <li key={r.key} className="flex justify-between gap-3">
          <Link href={href(r.key)} className="max-w-48 truncate hover:text-accent hover:underline" title={r.shop}>{r.shop}</Link>
          <span className="whitespace-nowrap tabular-nums text-ink-3">{v(r)}</span>
        </li>
      ))}
      {list.length > 3 && (
        <li className="text-ink-3" title={list.slice(3).map((r) => `${r.shop}: ${v(r)}`).join('\n')}>+{list.length - 3} {s.shop!.label.toLowerCase()} khác</li>
      )}
    </ul>
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

function KindPill({ k }: { k: keyof typeof ORIGIN }) {
  const team = ORIGIN[k].kind === 'Team tự điền';
  return <span className={`pill ${team ? 'bg-warning-soft text-warning' : 'bg-positive-soft text-positive'}`}>{ORIGIN[k].kind}</span>;
}
