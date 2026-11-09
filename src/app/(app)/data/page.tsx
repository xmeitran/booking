import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { CHECKS, QUALITY_DAYS, qualityCounts, qualityRows } from '@/lib/dataQuality';
import { db } from '@/lib/db';
import { larkStats, marketStats, ORIGIN, sourceOf, STATION, topCreators, type Source, type SourceStats } from '@/lib/dataSources';
import { fmtNum, fmtPct } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { refreshData } from './actions';
import { RankView, ShopView } from './rank';
import { AREAS, day, fmtTime, Freshness, KindPill, Metrics, val, type AreaKey } from './ui';

// Tab Dữ liệu chia theo việc người xem cần: Tổng quan (dữ liệu có mới, đủ không; KOL nào bán tốt) · Xếp hạng creator ·
// Theo shop / brand · Kiểm soát nhập liệu Lark · Nguồn & cách tính. Link cũ /data?src=..., ?check=... vẫn mở đúng màn.
type Search = { view?: string; src?: string; ours?: string; by?: string; check?: string; shop?: string; notfound?: string };
type Saved = SourceStats | { error: string } | undefined;

const VIEWS = [
  ['', 'Tổng quan'],
  ['rank', 'Xếp hạng creator'],
  ['shop', 'Theo shop / brand'],
  ['quality', 'Kiểm soát nhập liệu'],
  ['sources', 'Nguồn & cách tính'],
] as const;
const DEFAULT_SRC = 'shop_creators'; // Creator hợp tác với 8 shop UpBase: câu hỏi hay gặp nhất

export default async function DataPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const view = sp.check ? 'quality' : sp.view === 'shop' || sp.view === 'quality' || sp.view === 'sources' ? sp.view : sp.view === 'rank' || sp.src ? 'rank' : '';
  const [state, syncs, quality] = await Promise.all([
    db.syncState.findUnique({ where: { id: 'data-sources' } }),
    db.syncState.findMany({ where: { id: { in: ['bookings', 'creators'] } } }),
    qualityCounts(),
  ]);
  const saved = (state?.data ?? {}) as Record<string, Saved>;
  const running = Boolean(state?.startedAt && !state.finishedAt);
  const errors = quality.reduce((s, q) => s + q.n, 0);

  let body: React.ReactNode;
  if (view === 'rank' || view === 'shop') {
    const want = sourceOf(sp.src ?? DEFAULT_SRC) ?? sourceOf(DEFAULT_SRC)!;
    const s = view === 'shop' && !want.shop ? sourceOf(DEFAULT_SRC)! : want;
    const by = Math.min(Math.max(Math.trunc(Number(sp.by)) || 0, 0), s.metrics.length - 1);
    const st = s.key === 'lark' ? await larkStats() : s.key === 'marketplace' ? await marketStats() : saved[s.key];
    body = view === 'shop' ? <ShopView s={s} st={st} by={by} /> : <RankView s={s} st={st} ours={sp.ours === '1'} shop={s.shop ? sp.shop : undefined} by={by} />;
  } else if (view === 'quality') {
    body = sp.check && CHECKS.some((c) => c.key === sp.check) ? <CheckList check={sp.check} /> : <Quality quality={quality} />;
  } else if (view === 'sources') {
    body = <Sources saved={saved} />;
  } else {
    body = <Overview saved={saved} stationAt={state?.finishedAt ?? null} syncs={syncs} quality={quality} />;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dữ liệu</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-ink-2">Số liệu creator Booking Hub lấy từ TikTok (đơn hàng, video, LIVE của các shop và MCN UpBase) và từ Lark (booking team nhập).</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <form action="/creator" className="flex gap-2">
            <input name="h" required placeholder="@username hoặc link TikTok" aria-label="Tra một creator" className="input h-8 w-64 text-[13px]" />
            <button className="btn h-8 px-3 text-xs">Tra creator</button>
          </form>
          <form action={refreshData} className="flex items-center gap-2">
            <span className="text-xs text-ink-3">
              {running ? 'Đang tổng hợp số TikTok (~10 phút), tải lại trang sau' : state?.finishedAt ? `Số TikTok tổng hợp lúc ${fmtTime(state.finishedAt)}` : 'Số TikTok chưa tổng hợp'}
            </span>
            <button className="btn h-8 px-3 text-xs" disabled={running}>Làm mới</button>
          </form>
        </div>
      </div>
      {sp.notfound && <p role="alert" className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-warning">Không đọc được username TikTok. Nhập dạng @username hoặc dán link kênh.</p>}

      <nav aria-label="Mục dữ liệu" className="mb-5 flex gap-5 overflow-x-auto border-b border-line text-[13px]">
        {VIEWS.map(([k, label]) => (
          <Link key={k} href={k ? `/data?view=${k}` : '/data'} aria-current={view === k ? 'page' : undefined}
            className={`-mb-px border-b-2 pb-2.5 whitespace-nowrap ${view === k ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
            {label}
            {k === 'quality' && errors > 0 && <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 text-xs font-medium text-warning">{fmtNum(errors)}</span>}
          </Link>
        ))}
      </nav>
      {body}
    </>
  );
}

async function Overview({ saved, stationAt, syncs, quality }: {
  saved: Record<string, Saved>; stationAt: Date | null; syncs: { id: string; finishedAt: Date | null; message: string | null }[]; quality: Awaited<ReturnType<typeof qualityCounts>>;
}) {
  const shopSrc = sourceOf(DEFAULT_SRC)!;
  const keysOf = (g: string) => STATION.filter((s) => s.group === g).map((s) => s.key);
  // KOL Danh bạ có số ở ít nhất một bảng của nhóm (số đã lưu lúc tổng hợp).
  const coveredOf = (g: string) => db.creatorMetric.findMany({ where: { source: { in: keysOf(g) } }, distinct: ['handle'], select: { handle: true } }).then((r) => r.length);
  const [kocTotal, lark, market, ourTop, allTop, handles, sellerCov, partnerCov] = await Promise.all([
    db.koc.count({ where: { platform: 'TikTok' } }),
    larkStats(),
    marketStats(),
    topCreators(shopSrc, true, 0, 5).catch(() => null),
    topCreators(shopSrc, false, 0, 200).catch(() => null),
    db.koc.findMany({ where: { platform: 'TikTok' }, select: { handle: true } }),
    coveredOf('seller'),
    coveredOf('partner'),
  ]);
  const inBook = new Set(handles.map((h) => h.handle));
  const outside = allTop?.rows.filter((r) => !inBook.has(r.handle.toLowerCase())).slice(0, 5) ?? null;
  const syncAt = (id: string) => syncs.find((x) => x.id === id)?.finishedAt ?? null;
  const stationErr = (g: string) => STATION.some((s) => s.group === g && saved[s.key] && 'error' in saved[s.key]!);
  const cards: { k: AreaKey; at: Date | null; error?: boolean; coverage: number }[] = [
    { k: 'seller', at: stationAt, error: stationErr('seller'), coverage: sellerCov },
    { k: 'partner', at: stationAt, error: stationErr('partner'), coverage: partnerCov },
    { k: 'lark', at: syncAt('bookings'), coverage: lark.ours.creators },
    { k: 'marketplace', at: syncAt('creators'), coverage: market.ours.creators },
  ];
  const ranking = (src: string, ours: boolean) => `/data?view=rank&src=${src}${ours ? '&ours=1' : ''}`;

  return (
    <div className="grid gap-6">
      <section>
        <h2 className="mb-1 text-base font-semibold">Dữ liệu có mới và đủ không</h2>
        <p className="mb-3 text-xs text-ink-3">4 nhóm nguồn, mỗi nhóm trả lời một câu hỏi. Số trong ô là KOL Danh bạ ({fmtNum(kocTotal)}) có dữ liệu ở nhóm đó.</p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {cards.map(({ k, at, error, coverage }) => {
            const a = AREAS.find((x) => x.key === k)!;
            return (
              <Link key={k} href={`/data?view=sources#${k}`} className="group rounded-lg border border-line bg-surface px-4 py-3 hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-semibold group-hover:text-accent">{a.title}</span>
                  <KindPill k={k} />
                </div>
                <p className="mt-1 text-xs text-ink-2">{a.question}.</p>
                <p className="mt-3 text-2xl font-semibold tabular-nums">{fmtNum(coverage)} <span className="text-xs font-normal text-ink-3">KOL Danh bạ · {fmtPct(kocTotal ? coverage / kocTotal : null)}</span></p>
                <p className="mt-2 text-[11px] text-ink-3">{a.system}</p>
                <Freshness k={k} at={at} error={error} />
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <MiniRank title="KOL Danh bạ bán tốt nhất cho shop UpBase" sub="GMV affiliate bán cho 8 shop, toàn bộ khoảng ngày của bảng" s={shopSrc} rows={ourTop?.rows ?? null} more={ranking(DEFAULT_SRC, true)} />
        <MiniRank title="Creator ngoài Danh bạ đang bán mạnh cho shop UpBase" sub="Đáng xem để mời hợp tác; chưa có trong Danh bạ KOC" s={shopSrc} rows={outside} more={ranking(DEFAULT_SRC, false)} />
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Lark nhập thiếu / sai</h2>
          <Link href="/data?view=quality" className="link text-xs">Xem chi tiết</Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {quality.map((q) => (
            <Link key={q.key} href={`/data?view=quality&check=${q.key}`} title={q.hint}
              className={`rounded-lg border px-3 py-2 text-[13px] ${q.n ? 'border-warning/40 bg-warning-soft text-warning' : 'border-line bg-surface text-ink-3'}`}>
              {q.label} <b className="ml-1 tabular-nums">{fmtNum(q.n)}</b>
            </Link>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-3">Booking air / dự kiến air từ {QUALITY_DAYS} ngày trước hoặc tháng plan gần đây. Sửa trên Lark, lượt đồng bộ sau tự hết.</p>
      </section>
    </div>
  );
}

async function MiniRank({ title, sub, s, rows, more }: { title: string; sub: string; s: Source; rows: { handle: string; m: number[] }[] | null; more: string }) {
  const kocs = rows?.length ? await db.koc.findMany({ where: { platform: 'TikTok', handle: { in: rows.map((r) => r.handle.toLowerCase()) } }, select: { handle: true, name: true, nickname: true, avatarUrl: true } }) : [];
  const kocOf = new Map(kocs.map((k) => [k.handle, k]));
  return (
    <section className="rounded-lg border border-line bg-surface">
      <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-ink-3">{sub}</p>
        </div>
        <Link href={more} className="link shrink-0 text-xs">Xem bảng xếp hạng</Link>
      </div>
      {rows === null ? (
        <p className="px-4 py-6 text-[13px] text-ink-3">Chưa đọc được số từ Trạm dữ liệu. Bấm Làm mới hoặc xem lại sau.</p>
      ) : !rows.length ? (
        <p className="px-4 py-6 text-[13px] text-ink-3">Chưa có creator nào.</p>
      ) : (
        <ol className="divide-y divide-line">
          {rows.map((r, i) => {
            const k = kocOf.get(r.handle.toLowerCase());
            return (
              <li key={r.handle} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                <span className="w-4 text-ink-3 tabular-nums">{i + 1}</span>
                <Avatar src={k?.avatarUrl} name={k ? k.nickname ?? k.name : r.handle} size={24} />
                <Link href={`/creator/${encodeURIComponent(r.handle.toLowerCase())}`} className="link min-w-0 flex-1 truncate">@{r.handle}</Link>
                <span className="tabular-nums font-medium">{val(r.m[0], s.metrics[0].money)}</span>
                <span className="w-24 text-right text-xs text-ink-3 tabular-nums">{fmtNum(r.m[1])} {s.metrics[1].label.toLowerCase()}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Quality({ quality }: { quality: Awaited<ReturnType<typeof qualityCounts>> }) {
  return (
    <>
      <p className="mb-3 max-w-3xl text-[13px] text-ink-2">
        Booking trên Lark Base điền thiếu / sai khiến Booking Hub không khớp được KOL, không tính được chi phí, KPI. Chỉ xét booking air / dự kiến air từ {QUALITY_DAYS} ngày trước
        hoặc tháng plan gần đây (việc còn sửa được). Sửa trên Lark, lượt đồng bộ sau tự hết.
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead><tr><th>Lỗi</th><th>Ảnh hưởng</th><th className="text-right">Booking</th></tr></thead>
          <tbody>
            {quality.map((q) => (
              <tr key={q.key}>
                <td>{q.n ? <Link href={`/data?view=quality&check=${q.key}`} className="font-medium text-accent hover:underline">{q.label}</Link> : q.label}</td>
                <td className="text-[13px] text-ink-3">{q.hint}</td>
                <td className={`text-right font-medium tabular-nums ${q.n ? 'text-warning' : 'text-positive'}`}>{fmtNum(q.n)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function CheckList({ check }: { check: string }) {
  const c = CHECKS.find((x) => x.key === check)!;
  const rows = (await qualityRows(check)) ?? [];
  return (
    <>
      <Link href="/data?view=quality" className="text-xs text-ink-3 hover:text-ink">← Kiểm soát nhập liệu</Link>
      <h2 className="mt-2 text-lg font-semibold">{c.label}</h2>
      <p className="mt-1 mb-4 text-[13px] text-ink-2">{c.hint}. Tối đa 500 dòng; mở booking rồi bấm &quot;Mở trên Lark&quot; để sửa.</p>
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

/** Danh mục toàn bộ bảng: phủ ngày nào, bao nhiêu creator, bao nhiêu KOL Danh bạ, hiệu quả, và dữ liệu đi từ đâu. */
async function Sources({ saved }: { saved: Record<string, Saved> }) {
  const [kocTotal, lark, market] = await Promise.all([db.koc.count({ where: { platform: 'TikTok' } }), larkStats(), marketStats()]);
  const statOf = (s: Source): Saved => (s.key === 'lark' ? lark : s.key === 'marketplace' ? market : saved[s.key]);
  return (
    <div className="grid gap-6">
      <section className="rounded-lg border border-line bg-surface px-4 py-3 text-[13px]">
        <h2 className="mb-2 text-sm font-semibold">Dữ liệu đi từ đâu tới Booking Hub</h2>
        <ol className="grid gap-1.5">
          {(Object.keys(ORIGIN) as AreaKey[]).map((k) => (
            <li key={k} className="flex flex-wrap items-center gap-2">
              <b className="w-44">{ORIGIN[k].name}</b><KindPill k={k} /><span className="text-ink-2">{ORIGIN[k].path}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-ink-3">Các bảng chồng lấn (một đơn có thể nằm ở Đơn MCN, Đơn TAP và Đơn affiliate của shop), nên không cộng số giữa các bảng. Creator khớp Danh bạ theo username TikTok.</p>
      </section>

      {AREAS.map((a) => (
        <section key={a.key} id={a.key} className="scroll-mt-4">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-base font-semibold">{a.title}</h2>
            <KindPill k={a.key} />
            <span className="text-xs text-ink-3">{a.system} · {a.question}</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="tbl">
              <thead>
                <tr><th>Bảng</th><th>Phủ dữ liệu</th><th className="text-right">Creator</th><th className="text-right">KOL Danh bạ có mặt</th><th>Hiệu quả · mọi creator</th><th>Hiệu quả · KOL Danh bạ</th></tr>
              </thead>
              <tbody>
                {a.sources.map((s) => {
                  const st = statOf(s);
                  return (
                    <tr key={s.key} className="align-top">
                      <td className="min-w-52">
                        <Link href={`/data?view=rank&src=${s.key}`} className="font-medium text-accent hover:underline">{s.name}</Link>
                        <div className="text-xs text-ink-3">{s.note}</div>
                        <details className="mt-1 text-xs text-ink-3">
                          <summary className="cursor-pointer">Cách tính</summary>
                          <ul className="mt-1 grid gap-0.5">{s.metrics.map((x) => <li key={x.label}><b className="font-medium text-ink-2">{x.label}:</b> {x.hint ?? '—'}</li>)}</ul>
                        </details>
                      </td>
                      {!st || 'error' in st ? (
                        <td colSpan={5} className="text-[13px] text-ink-3">{st ? `Lỗi: ${st.error}` : 'Chưa tổng hợp, bấm Làm mới.'}</td>
                      ) : (
                        <>
                          <td className="whitespace-nowrap text-[13px]">{day(st.from)} – {day(st.to)}<div className="text-xs text-ink-3">{fmtNum(st.rows)} dòng</div></td>
                          <td className="text-right font-medium tabular-nums">{fmtNum(st.creators)}</td>
                          <td className="text-right tabular-nums">{fmtNum(st.ours.creators)}<div className="text-xs text-ink-3">{fmtPct(kocTotal ? st.ours.creators / kocTotal : null)} Danh bạ</div></td>
                          <td><Metrics s={s} m={st.m} /></td>
                          <td><Metrics s={s} m={st.ours.m} /></td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
