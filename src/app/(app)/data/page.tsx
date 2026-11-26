import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { CHECKS, QUALITY_DAYS, qualityCounts, qualityRows } from '@/lib/koc/dataQuality';
import { db } from '@/lib/db';
import { larkStats, marketStats, ORIGIN, sourceOf, WAREHOUSE, topCreators, type Source, type SourceStats } from '@/lib/koc/dataSources';
import { fmtNum, fmtPct } from '@/lib/format';
import { requireUser } from '@/lib/auth/session';
import { refreshData } from './actions';
import { RankView, ShopView } from './rank';
import { AREAS, day, Empty, fmtWhen, Freshness, KindPill, Metrics, Panel, SectionHeader, Stat, StatRow, Status, TabNav, val, type AreaKey } from './ui';

// Tab Dữ liệu chia theo việc người xem cần: Tổng quan (dữ liệu có mới, đủ không; KOL nào bán tốt) · Xếp hạng creator ·
// Theo shop / brand · Kiểm soát nhập liệu Lark · Nguồn & cách tính. Giao diện theo bộ component của app b2c.
// Link cũ /data?src=..., ?check=..., ?notfound=1 vẫn mở đúng màn.
type Search = { view?: string; src?: string; ours?: string; by?: string; check?: string; shop?: string; notfound?: string };
type Saved = SourceStats | { error: string } | undefined;
type Quality = Awaited<ReturnType<typeof qualityCounts>>;

const DEFAULT_SRC = 'aff_orders'; // Đơn affiliate creator bán cho shop UpBase: câu hỏi hay gặp nhất
const QUALITY_NOTE = `Booking air từ ${QUALITY_DAYS} ngày trước trở đi hoặc plan 2 tháng gần đây. Sửa trên Lark, lỗi tự hết trong vòng 1 giờ`;
const REFRESH = 'Cập nhật số liệu ngay';

export default async function DataPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireUser();
  const sp = await searchParams;
  const view = sp.check ? 'quality' : sp.view === 'shop' || sp.view === 'quality' || sp.view === 'sources' ? sp.view : sp.view === 'rank' || sp.src ? 'rank' : '';
  const [state, syncs, quality] = await Promise.all([
    db.syncState.findUnique({ where: { id: 'data-sources' } }),
    db.syncState.findMany({ where: { id: { in: ['bookings', 'warehouse-creators'] } } }),
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
    body = sp.check && CHECKS.some((c) => c.key === sp.check) ? <CheckList check={sp.check} /> : <QualityView quality={quality} />;
  } else if (view === 'sources') {
    body = <Sources saved={saved} />;
  } else {
    body = <Overview saved={saved} stationAt={state?.finishedAt ?? null} syncs={syncs} quality={quality} />;
  }

  return (
    <>
      <div className="mb-3">
        <h1 className="text-xl font-semibold">Dữ liệu</h1>
        <p className="mt-0.5 text-xs text-ink-3">Creator nào bán tốt cho shop UpBase, số liệu mới tới đâu, booking nào nhập thiếu trên Lark.</p>
      </div>
      {sp.notfound && <p role="alert" className="mb-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">Không đọc được username TikTok. Nhập dạng @username hoặc dán link kênh.</p>}
      <TabNav
        items={[
          { href: '/data', label: 'Tổng quan', active: view === '' },
          { href: '/data?view=rank', label: 'Xếp hạng creator', active: view === 'rank' },
          { href: '/data?view=shop', label: 'Theo shop / brand', active: view === 'shop' },
          { href: '/data?view=quality', label: 'Lỗi nhập trên Lark', active: view === 'quality', count: errors ? fmtNum(errors) : undefined, tone: 'critical' },
          { href: '/data?view=sources', label: 'Nguồn & cách tính', active: view === 'sources' },
        ]}
        actions={
          <>
            <form action="/creator" className="flex gap-1.5">
              <input name="h" required placeholder="@username hoặc link TikTok" aria-label="Tra một creator" className="input h-8 w-56 text-xs" />
              <button className="btn h-8 px-3 text-xs">Tra creator</button>
            </form>
            <form action={refreshData}>
              <button className="btn h-8 px-3 text-xs" disabled={running}
                title={running ? 'Đang cập nhật, mất vài phút. Tải lại trang sau' : state?.finishedAt ? `Cập nhật lần cuối ${fmtWhen(state.finishedAt)}` : 'Chưa cập nhật lần nào'}>
                {running ? 'Đang cập nhật…' : REFRESH}
              </button>
            </form>
          </>
        }
      />
      {body}
    </>
  );
}

async function Overview({ saved, stationAt, syncs, quality }: { saved: Record<string, Saved>; stationAt: Date | null; syncs: { id: string; finishedAt: Date | null }[]; quality: Quality }) {
  const shopSrc = sourceOf(DEFAULT_SRC)!;
  // KOL Danh bạ có số ở ít nhất một bảng kho.
  const covered = () => db.$queryRaw<{ n: number }[]>`
    select count(distinct c.handle)::int n from "CreatorMetric" c join "Koc" k on k.platform = 'TikTok' and lower(k.handle) = c.handle
    where c.source = any(${WAREHOUSE.map((s) => s.key)})`.then((r) => r[0]?.n ?? 0);
  const [kocTotal, lark, market, ourTop, allTop, handles, sellerCov] = await Promise.all([
    db.koc.count({ where: { platform: 'TikTok' } }),
    larkStats(),
    marketStats(),
    topCreators(shopSrc, true, 0, 5).catch(() => null),
    topCreators(shopSrc, false, 0, 200).catch(() => null),
    db.koc.findMany({ where: { platform: 'TikTok' }, select: { handle: true } }),
    covered(),
  ]);
  const inBook = new Set(handles.map((h) => h.handle));
  const outside = allTop?.rows.filter((r) => !inBook.has(r.handle.toLowerCase())).slice(0, 5) ?? null;
  const syncAt = (id: string) => syncs.find((x) => x.id === id)?.finishedAt ?? null;
  const stationErr = () => WAREHOUSE.some((s) => saved[s.key] && 'error' in saved[s.key]!);
  const cards: { k: AreaKey; at: Date | null; error?: boolean; coverage: number }[] = [
    { k: 'seller', at: stationAt, error: stationErr(), coverage: sellerCov },
    { k: 'lark', at: syncAt('bookings'), coverage: lark.ours.creators },
    { k: 'marketplace', at: syncAt('warehouse-creators'), coverage: market.ours.creators },
  ];
  const ranking = (ours: boolean) => `/data?view=rank&src=${DEFAULT_SRC}${ours ? '&ours=1' : ''}`;

  return (
    <div className="grid gap-6">
      <section>
        <SectionHeader title={`KOL Danh bạ đã có số liệu (tổng ${fmtNum(kocTotal)} KOL)`} />
        <StatRow>
          {cards.map(({ k, at, error, coverage }) => {
            const a = AREAS.find((x) => x.key === k)!;
            return (
              <Stat key={k} href={`/data?view=sources#${k}`} label={a.title} value={fmtNum(coverage)} note={`${fmtPct(kocTotal ? coverage / kocTotal : null)} Danh bạ · ${a.question}`}>
                <Freshness k={k} at={at} error={error} />
              </Stat>
            );
          })}
        </StatRow>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <MiniRank title="KOL Danh bạ bán tốt nhất cho shop UpBase" meta="Xếp theo GMV đơn affiliate, tính toàn bộ thời gian" s={shopSrc} rows={ourTop?.rows ?? null} more={ranking(true)} />
        <MiniRank title="Creator ngoài Danh bạ đang bán mạnh cho shop UpBase" meta="Chưa có trong Danh bạ, nên xem để mời hợp tác" s={shopSrc} rows={outside} more={ranking(false)} />
      </div>

      <Panel flush title="Lỗi nhập trên Lark" meta={QUALITY_NOTE}
        actions={<Link href="/data?view=quality" className="link text-xs">Xem chi tiết</Link>}>
        <QualityTable quality={quality} />
      </Panel>
    </div>
  );
}

async function MiniRank({ title, meta, s, rows, more }: { title: string; meta: string; s: Source; rows: { handle: string; m: number[] }[] | null; more: string }) {
  const kocs = rows?.length ? await db.koc.findMany({ where: { platform: 'TikTok', handle: { in: rows.map((r) => r.handle.toLowerCase()) } }, select: { handle: true, name: true, nickname: true, avatarUrl: true } }) : [];
  const kocOf = new Map(kocs.map((k) => [k.handle, k]));
  return (
    <Panel flush title={title} meta={meta} actions={<Link href={more} className="link text-xs">Xem bảng xếp hạng</Link>}>
      {rows === null ? <Empty>Chưa đọc được số liệu. Bấm &quot;{REFRESH}&quot; hoặc xem lại sau.</Empty> : !rows.length ? <Empty>Chưa có creator nào.</Empty> : (
        <table className="dt">
          <thead><tr><th className="w-8">#</th><th>Creator</th><th className="text-right">{s.metrics[0].label}</th><th className="text-right">{s.metrics[1].label}</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const k = kocOf.get(r.handle.toLowerCase());
              return (
                <tr key={r.handle}>
                  <td className="text-ink-3">{i + 1}</td>
                  <td>
                    <Link href={`/creator/${encodeURIComponent(r.handle.toLowerCase())}`} className="flex min-w-0 items-center gap-2">
                      <Avatar src={k?.avatarUrl} name={k ? k.nickname ?? k.name : r.handle} size={24} />
                      <span className="truncate font-medium text-ink hover:text-accent hover:underline">@{r.handle}</span>
                    </Link>
                  </td>
                  <td className="text-right font-medium">{val(r.m[0], s.metrics[0].money)}</td>
                  <td className="text-right text-ink-2">{fmtNum(r.m[1])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function QualityTable({ quality }: { quality: Quality }) {
  return (
    <table className="dt">
      <thead><tr><th>Lỗi</th><th>Ảnh hưởng</th><th className="text-right">Booking</th></tr></thead>
      <tbody>
        {quality.map((q) => (
          <tr key={q.key}>
            <td className="whitespace-nowrap">{q.n ? <Link href={`/data?view=quality&check=${q.key}`} className="font-medium text-ink hover:text-accent hover:underline">{q.label}</Link> : <span className="text-ink-2">{q.label}</span>}</td>
            <td className="text-ink-3">{q.hint}</td>
            <td className="text-right"><Status tone={q.n ? 'warning' : 'positive'}>{q.n ? fmtNum(q.n) : 'Không có'}</Status></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QualityView({ quality }: { quality: Quality }) {
  return (
    <Panel flush title="Lỗi nhập trên Lark" meta={QUALITY_NOTE}>
      <QualityTable quality={quality} />
    </Panel>
  );
}

async function CheckList({ check }: { check: string }) {
  const c = CHECKS.find((x) => x.key === check)!;
  const rows = (await qualityRows(check)) ?? [];
  return (
    <div className="grid gap-3">
      <Link href="/data?view=quality" className="text-xs text-ink-3 hover:text-ink">← Lỗi nhập trên Lark</Link>
      <Panel flush title={c.label} meta={`${c.hint}. Bấm mã booking rồi "Mở trên Lark" để sửa (hiện tối đa 500 dòng)`} actions={<Status tone={rows.length ? 'warning' : 'positive'}>{fmtNum(rows.length)} booking</Status>}>
        {!rows.length ? <Empty>Không còn booking nào lỗi này.</Empty> : (
          <div className="overflow-x-auto">
            <table className="dt">
              <thead><tr><th>Mã booking</th><th>ID kênh</th><th>Brand</th><th>Tháng plan</th><th>Người phụ trách</th><th className="text-right">Chi phí</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link href={`/booking/${r.id}`} className="font-mono font-medium text-accent hover:underline">{r.code}</Link></td>
                    <td>{r.channel ? <code className="rounded bg-sunken px-1">{r.channel}</code> : '—'}</td>
                    <td>{r.brand ?? '—'}</td>
                    <td>{r.planMonth ?? '—'}</td>
                    <td>{r.owner ?? '—'}</td>
                    <td className="text-right">{fmtNum(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/** Danh mục toàn bộ bảng: phủ ngày nào, bao nhiêu creator, bao nhiêu KOL Danh bạ, hiệu quả, và dữ liệu đi từ đâu. */
async function Sources({ saved }: { saved: Record<string, Saved> }) {
  const [kocTotal, lark, market] = await Promise.all([db.koc.count({ where: { platform: 'TikTok' } }), larkStats(), marketStats()]);
  const statOf = (s: Source): Saved => (s.key === 'lark' ? lark : s.key === 'marketplace' ? market : saved[s.key]);
  return (
    <div className="grid gap-5">
      <Panel flush title="Nguồn dữ liệu" meta="Không cộng số giữa các bảng: đơn từ video, LIVE đã nằm trong Đơn affiliate của shop. Creator khớp Danh bạ theo username TikTok">
        <table className="dt">
          <thead><tr><th>Nguồn</th><th>Loại số</th><th>Cập nhật</th></tr></thead>
          <tbody>
            {(Object.keys(ORIGIN) as AreaKey[]).map((k) => (
              <tr key={k}>
                <td className="font-medium whitespace-nowrap">{ORIGIN[k].name}</td>
                <td><KindPill k={k} /></td>
                <td className="whitespace-nowrap text-ink-3">{ORIGIN[k].schedule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {AREAS.map((a) => (
        <Panel key={a.key} id={a.key} flush title={a.title} meta={`${ORIGIN[a.key].name} · ${a.question}`} actions={<KindPill k={a.key} />}>
          <div className="overflow-x-auto">
            <table className="dt">
              <thead>
                <tr><th>Bảng</th><th>Khoảng ngày</th><th className="text-right">Creator</th><th className="text-right">KOL Danh bạ có số</th><th>Hiệu quả · mọi creator</th><th>Hiệu quả · KOL Danh bạ</th></tr>
              </thead>
              <tbody>
                {a.sources.map((s) => {
                  const st = statOf(s);
                  return (
                    <tr key={s.key}>
                      <td className="min-w-52">
                        <Link href={`/data?view=rank&src=${s.key}`} className="font-medium text-ink hover:text-accent hover:underline">{s.name}</Link>
                        <div className="text-2xs text-ink-3">{s.note}</div>
                        <details className="mt-1 text-2xs text-ink-3">
                          <summary className="cursor-pointer">Cách tính</summary>
                          <ul className="mt-1 grid gap-0.5">{s.metrics.map((x) => <li key={x.label}><b className="font-medium text-ink-2">{x.label}:</b> {x.hint ?? '—'}</li>)}</ul>
                        </details>
                      </td>
                      {!st || 'error' in st ? (
                        <td colSpan={5}><Status tone={st ? 'critical' : 'neutral'} title={st?.error}>{st ? 'Lần cập nhật gần nhất bị lỗi' : `Chưa có số, bấm "${REFRESH}"`}</Status></td>
                      ) : (
                        <>
                          <td className="whitespace-nowrap">{day(st.from)} – {day(st.to)}<div className="text-2xs text-ink-3">{fmtNum(st.rows)} dòng</div>{st.lastError && <div className="text-2xs text-warning" title={st.lastError}>Lần cập nhật gần nhất bị lỗi, đang giữ số lần trước</div>}</td>
                          <td className="text-right font-medium">{fmtNum(st.creators)}</td>
                          <td className="text-right">{fmtNum(st.ours.creators)}<div className="text-2xs text-ink-3">{fmtPct(kocTotal ? st.ours.creators / kocTotal : null)} Danh bạ</div></td>
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
        </Panel>
      ))}
    </div>
  );
}
