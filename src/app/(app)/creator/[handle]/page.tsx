import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Avatar } from '@/components/ui';
import { db } from '@/lib/db';
import {
  creatorStation, LARK, LIVE_SOURCES, liveCreator, MARKET, ORIGIN, originOf, placesOf, rawRows, WAREHOUSE,
  type CreatorSource, type RawColumn, type ShopRow, type Source, type SourceStats,
} from '@/lib/koc/dataSources';
import { configured } from '@/lib/integrations';
import { fmtDate, fmtNum, fmtPct, fmtShort, fmtVnd } from '@/lib/format';
import { requireUser } from '@/lib/auth/session';
import { TIKTOK_USERNAME } from '@/lib/validate';
import { addToDanhBa } from '../actions';

const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const day = (s: string | null | undefined) => (s ? fmtDate(new Date(s)) : '—');
const val = (x: { money?: boolean }, v: number | null | undefined) => (v == null ? '—' : x.money ? `${fmtShort(v)} ₫` : fmtShort(v));
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const GROUPS = [['lark', 'Lark'], ['seller', 'Bán cho shop UpBase'], ['marketplace', 'Toàn sàn TikTok']] as const;

type Tile = { s: Source; m: number[] | null; shops: ShopRow[]; from: 'saved' | 'live' | 'local'; known: boolean; note?: string };

/** Hiệu quả của một creator ở mọi nguồn: có mặt ở đâu, số mỗi nguồn, theo shop / brand. */
export default async function CreatorPage({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<{ added?: string; raw?: string }> }) {
  await requireUser();
  const handle = decodeURIComponent((await params).handle).replace(/^@/, '').toLowerCase();
  if (!TIKTOK_USERNAME.test(handle)) notFound();
  const { added, raw } = await searchParams;
  const alias = await db.kocAlias.findUnique({ where: { handle }, select: { koc: { select: { handle: true } } } });
  if (alias && alias.koc.handle !== handle) redirect(`/creator/${encodeURIComponent(alias.koc.handle)}`);

  const [koc, cached, w, state, bookings, booksSync, whOn] = await Promise.all([
    db.koc.findFirst({ where: { platform: 'TikTok', handle }, include: { pic: { select: { name: true } } } }),
    creatorStation(handle),
    db.warehouseCreator.findUnique({ where: { platform_handle: { platform: 'TikTok', handle } } }),
    db.syncState.findUnique({ where: { id: 'data-sources' } }),
    db.booking.findMany({ where: { channel: { equals: handle, mode: 'insensitive' } }, orderBy: [{ airDate: { sort: 'desc', nulls: 'last' } }, { larkUpdatedAt: 'desc' }] }),
    db.syncState.findUnique({ where: { id: 'bookings' } }),
    configured('warehouse'),
  ]);
  // Đơn affiliate, LIVE: hỏi thẳng kho lúc mở trang (~1–2 giây); lỗi thì dùng bản tổng hợp sẵn. Video: bản tổng hợp sẵn.
  const liveErr: Record<string, string> = {};
  const station: (CreatorSource & { live?: boolean })[] = await Promise.all(cached.map(async (c) => {
    if (!whOn || !LIVE_SOURCES.includes(c.s.key)) return c;
    try {
      return { ...(await liveCreator(c.s, handle)), live: true };
    } catch (e) {
      liveErr[c.s.key] = e instanceof Error ? e.message : String(e);
      return c;
    }
  }));
  const rawSource = raw && whOn ? WAREHOUSE.find((x) => x.key === raw) : undefined;
  const rawData = rawSource ? await rawRows(rawSource, handle).catch((e: unknown) => (e instanceof Error ? e.message : String(e))) : null;
  const coverage = (state?.data ?? {}) as Record<string, SourceStats | { error: string }>;
  const jobCount = koc ? await db.job.count({ where: { kocId: koc.id, stage: { not: 'Đã huỷ' } } }) : 0;
  const updated = state?.finishedAt ?? null;

  // Lark: booking của kênh này. Hồ sơ creator: bảng kho (WarehouseCreator).
  const ex = (b: (typeof bookings)[number], k: string) => num((b.extra as Record<string, unknown>)[k]);
  const sum = (f: (b: (typeof bookings)[number]) => number | null, list = bookings) => list.reduce((a, b) => a + (f(b) ?? 0), 0);
  const larkM = [bookings.length, sum((b) => b.cost), sum((b) => ex(b, 'views30')), sum((b) => ex(b, 'gmv30')), sum((b) => ex(b, 'orders30'))];
  const brands = [...new Set(bookings.map((b) => b.brand ?? ''))].map((brand): ShopRow => {
    const list = bookings.filter((b) => (b.brand ?? '') === brand);
    return { key: brand, shop: brand || '(trống)', m: [list.length, sum((b) => b.cost, list), sum((b) => ex(b, 'views30'), list), sum((b) => ex(b, 'gmv30'), list), sum((b) => ex(b, 'orders30'), list)] };
  }).sort((a, b) => b.m[0] - a.m[0]);
  const dates = bookings.map((b) => (b.airDate ?? b.planAirDate)?.getTime()).filter((x): x is number => x != null);
  const larkCov = dates.length ? { from: new Date(Math.min(...dates)).toISOString(), to: new Date(Math.max(...dates)).toISOString() } : undefined;
  const marketM = w ? [w.followers ?? 0, w.medianViews ?? 0, w.ecViews ?? 0, w.gmv ?? 0, w.unitsSold ?? 0] : null;
  const wAt = w ? w.sourceAt ?? w.syncedAt : null;

  const tiles: Tile[] = [
    { s: LARK, m: bookings.length ? larkM : null, shops: brands, from: 'local', known: true },
    ...station.map((c): Tile => ({
      s: c.s, m: c.m, shops: c.shops, from: c.live ? 'live' : 'saved', known: c.live || Boolean(coverage[c.s.key] && !('error' in coverage[c.s.key])),
      note: liveErr[c.s.key] ? 'Chưa lấy được số mới nhất, đang hiện số lần cập nhật trước. Tải lại trang sau ít phút.' : undefined,
    })),
    { s: MARKET, m: marketM, shops: [], from: 'local', known: true },
  ];
  const present = tiles.filter((t) => t.m);
  const name = koc?.nickname ?? koc?.name ?? w?.nickname ?? `@${handle}`;

  // Chỉ số chính, ghi rõ nguồn: hồ sơ 30 ngày trên toàn sàn (kho), bán cho shop UpBase (kho), booking (Lark).
  const m = (key: string) => station.find((c) => c.s.key === key)?.m ?? null;
  const so = m('aff_orders'), vid = m('videos');
  const cov = (key: string) => { const c = coverage[key]; return c && !('error' in c) ? `, ${day(c.from)} – ${day(c.to)}` : ''; };
  const mk = wAt ? `TikTok · 30 ngày, đến ${fmtDate(wAt)}` : null;
  const summary: { label: string; v: [number | null | undefined, string | null]; money?: boolean; text?: string | null; sub?: string; anchor?: string }[] = [
    { label: 'Follower', v: [w?.followers ?? koc?.followers, mk ?? (koc?.followers != null ? 'Danh bạ' : null)], anchor: 'marketplace' },
    { label: 'View trung bình / video bán hàng', v: [w?.ecViews, mk], sub: w?.medianViews != null ? `Trung vị mọi video ${fmtNum(w.medianViews)}` : undefined },
    { label: 'Số món bán 30 ngày (toàn sàn)', v: [w?.unitsSold, mk] },
    { label: 'GMV 30 ngày (toàn sàn)', v: [w?.gmv, mk], money: true, sub: w?.gmvHidden ? 'Creator ẩn GMV: số ước tính' : undefined },
    { label: 'GMV bán cho shop UpBase', v: [so?.[0], so ? `TikTok · đơn affiliate${cov('aff_orders')}` : null], money: true, sub: so ? `${fmtNum(so[2])} món · ${fmtNum(so[1])} đơn` : undefined, anchor: 'aff_orders' },
    { label: 'GMV video gắn sản phẩm shop UpBase', v: [vid?.[2], vid ? `TikTok · video${cov('videos')}` : null], money: true, sub: vid ? `${fmtNum(vid[0])} video · ${fmtShort(vid[1])} view` : undefined, anchor: 'videos' },
    { label: 'Booking với UpBase', v: [bookings.length + jobCount || null, bookings.length + jobCount ? `Lark${jobCount ? ' + job trong Booking Hub' : ''}` : null], sub: bookings.length || jobCount ? `${bookings.length} booking trên Lark · ${jobCount} job · chi phí ${fmtShort(larkM[1])} ₫` : undefined, anchor: 'lark' },
  ];
  const whState = w ? `Số TikTok ngày ${fmtDate(wAt)}, cập nhật 9:30 mỗi sáng` : 'Chưa có số TikTok của creator này';

  return (
    <>
      <Link href="/data" className="text-xs text-ink-3 hover:text-ink">← Dữ liệu</Link>

      <div className="mt-2 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar src={koc?.avatarUrl ?? w?.avatarUrl} name={name} size={56} />
          <div>
            <h1 className="text-xl font-semibold">{name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
              <a href={`https://www.tiktok.com/@${handle}`} target="_blank" rel="noreferrer" className="link">@{handle} ↗</a>
              {koc ? <span className="pill bg-accent-soft text-accent">Đã có trong Danh bạ</span> : <span className="pill bg-sunken text-ink-2">Chưa có trong Danh bạ</span>}
              {(koc?.kl ?? koc?.klAuto) && <span className="pill bg-sunken text-ink-2">{koc?.kl ?? koc?.klAuto}</span>}
              {koc?.niche && <span>{koc.niche}</span>}
              {koc?.pic?.name && <span>Phụ trách: {koc.pic.name}</span>}
            </div>
            <p className="mt-1 text-[13px] text-ink-2">Creator này bán được bao nhiêu: số TikTok và booking trên Lark.</p>
          </div>
        </div>
        {koc ? <Link href={`/contacts/${koc.id}`} className="btn">Mở hồ sơ KOC</Link> : (
          <form action={addToDanhBa}><input type="hidden" name="handle" value={handle} /><button className="btn">Thêm vào Danh bạ</button></form>
        )}
      </div>

      {added && <p role="status" className="mb-4 rounded-md bg-positive-soft px-3 py-2 text-positive">Đã thêm vào Danh bạ{w ? ', kèm số TikTok.' : '.'}</p>}

      <section className="mb-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Chỉ số chính</h2>
          <span className="text-xs text-ink-3">{whState}</span>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          {summary.map((x) => {
            const [v, src] = x.v;
            const has = v != null || x.text;
            const body = (
              <>
                <div className="text-xs text-ink-3">{x.label}</div>
                <div className={`mt-0.5 text-lg font-semibold tabular-nums ${has ? '' : 'text-ink-3'}`}>{x.text ?? (v != null ? (x.money ? `${fmtShort(v)} ₫` : fmtNum(v)) : 'Chưa có')}</div>
                {x.sub && <div className="text-xs text-ink-2">{x.sub}</div>}
                <div className="mt-1 text-[11px] leading-tight text-ink-3">{has ? `Nguồn: ${src ?? x.sub}` : 'Chưa có số'}</div>
              </>
            );
            return has && x.anchor ? (
              <a key={x.label} href={`#${x.anchor}`} className="block rounded-lg border border-line bg-surface px-3 py-2.5 hover:border-accent">{body}</a>
            ) : (
              <div key={x.label} className={`rounded-lg border px-3 py-2.5 ${has ? 'border-line bg-surface' : 'border-dashed border-line'}`}>{body}</div>
            );
          })}
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-1 text-base font-semibold">Creator này có mặt ở đâu</h2>
        <p className="mb-3 text-[13px] text-ink-2">
          Có số ở {present.length}/{tiles.length} nguồn. Mỗi nguồn tính riêng, <b>không cộng các ô với nhau</b>.
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          {GROUPS.map(([g, label]) => {
            const list = tiles.filter((t) => (t.s.key === 'marketplace' ? 'marketplace' : t.s.group) === g);
            return (
              <div key={g}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-2">{label}</span>
                  <Kind g={g} />
                </div>
                <div className="space-y-1.5">
                  {list.map((t) => <SourceTile key={t.s.key} t={t} />)}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {present.map((t) => (
        <SourceCard
          key={t.s.key} t={t}
          coverage={t.s.key === 'lark' ? larkCov : t.s.key === 'marketplace' ? (wAt ? { from: wAt.toISOString(), to: wAt.toISOString() } : undefined) : coverage[t.s.key]}
          updated={t.s.key === 'lark' ? booksSync?.finishedAt ?? null : t.s.key === 'marketplace' ? w?.syncedAt ?? null : t.from === 'live' ? null : updated}
          raw={rawSource?.key === t.s.key ? rawData : null} handle={handle} canRaw={whOn}
        >
          {t.s.key === 'lark' && <LarkBookings bookings={bookings.slice(0, 30)} total={bookings.length} />}
          {t.s.key === 'marketplace' && w && (
            <p className="mt-3 text-[13px] text-ink-2">
              GMV / 1.000 view {w.gpm == null ? '—' : fmtVnd(w.gpm)} · Giá trị 1 đơn {w.aov == null ? '—' : fmtVnd(w.aov)} · Tỉ lệ tương tác {fmtPct(w.er)} · Follower nữ {fmtPct(w.female)} · {w.brandCount ?? '—'} brand đã hợp tác.
              {koc ? <> Xem chân dung follower ở <Link href={`/contacts/${koc.id}`} className="link">hồ sơ KOC</Link>.</> : null}
            </p>
          )}
        </SourceCard>
      ))}

      <section className="rounded-lg border border-line bg-sunken px-5 py-4 text-[13px] text-ink-2">
        <h2 className="mb-2 text-sm font-semibold text-ink">Cách đọc số</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Bán cho shop UpBase</b>: chỉ tính sản phẩm của shop UpBase. Đơn từ video, LIVE đã nằm trong đơn affiliate.</li>
          <li><b>Toàn sàn TikTok</b>: số 30 ngày của creator trên mọi shop.</li>
          <li>GMV chưa trừ đơn hoàn / huỷ. Hoa hồng là số ước tính.</li>
          <li>Số trên Lark do team điền tay; số TikTok không ai sửa được.</li>
        </ul>
      </section>
    </>
  );
}

function Kind({ g }: { g: keyof typeof ORIGIN }) {
  const team = ORIGIN[g].kind === 'Team tự điền';
  return <span className={`pill ${team ? 'bg-warning-soft text-warning' : 'bg-positive-soft text-positive'}`} title={ORIGIN[g].name}>{ORIGIN[g].kind}</span>;
}

function SourceTile({ t }: { t: Tile }) {
  const x = t.s.metrics[0];
  if (!t.m) {
    return (
      <div className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-ink-3">
        <div className="font-medium">{t.s.name}</div>
        <div>{t.known ? 'Không có số' : 'Chưa xem được'}</div>
      </div>
    );
  }
  return (
    <a href={`#${t.s.key}`} className="block rounded-md border border-line bg-surface px-3 py-2 hover:border-accent">
      <div className="truncate text-xs text-ink-2">{t.s.name}</div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="text-base font-semibold tabular-nums">{val(x, t.m[0])}</span>
        <span className="text-xs text-ink-3">{x.label}</span>
      </div>
      {t.s.metrics[1] && <div className="text-xs text-ink-3">{t.s.metrics[1].label}: {val(t.s.metrics[1], t.m[1])}</div>}
    </a>
  );
}

const FROM_LABEL: Record<string, string> = { saved: 'Số tổng hợp', live: 'Số mới nhất, lấy lúc mở trang', local: 'Lưu trong Booking Hub' };

function SourceCard({ t, coverage, updated, raw, handle, canRaw, children }: {
  t: Tile; coverage?: Partial<SourceStats> | { error: string }; updated: Date | null;
  raw: Awaited<ReturnType<typeof rawRows>> | string | null; handle: string; canRaw: boolean; children?: React.ReactNode;
}) {
  const o = originOf(t.s);
  const station = Boolean(t.s.wh);
  const cov = coverage && !('error' in coverage) ? coverage : undefined;
  return (
    <section id={t.s.key} className="mb-4 scroll-mt-4 rounded-lg border border-line bg-surface px-5 py-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t.s.name}</h2>
          <p className="text-xs text-ink-3">{t.s.note}</p>
        </div>
        <Kind g={t.s.key === 'marketplace' ? 'marketplace' : t.s.group} />
      </div>
      <dl className="mb-3 grid gap-x-6 gap-y-1 rounded-md bg-sunken px-3 py-2 text-xs sm:grid-cols-3">
        <div><dt className="inline text-ink-3">Nguồn: </dt><dd className="inline">{placesOf(t.s)}</dd></div>
        <div><dt className="inline text-ink-3">Khoảng ngày: </dt><dd className="inline">{cov ? `${day(cov.from)} – ${day(cov.to)}` : '—'}</dd></div>
        <div>
          <dt className="inline text-ink-3">Cập nhật: </dt>
          <dd className="inline">{FROM_LABEL[t.from]}{updated ? `, lúc ${fmtTime(updated)}` : ''}{t.from === 'live' ? '' : ` · ${o.schedule}`}</dd>
        </div>
      </dl>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {t.s.metrics.map((x, i) => (
          <div key={x.label}>
            <div className="text-xs text-ink-3">{x.label}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">{x.money ? `${fmtNum(t.m![i])} ₫` : fmtNum(t.m![i])}</div>
            {x.hint && <div className="text-xs text-ink-3">{x.hint}</div>}
          </div>
        ))}
      </div>

      {t.s.shop && t.shops.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <h3 className="mb-1 text-[13px] font-semibold">Theo {t.s.shop.label.toLowerCase()} ({t.shops.length}{t.shops.length >= 20 ? '+, 20 lớn nhất' : ''})</h3>
          <table className="tbl">
            <thead><tr><th>{t.s.shop.label}</th>{t.s.metrics.map((x) => <th key={x.label} className="text-right" title={x.hint}>{x.label}</th>)}</tr></thead>
            <tbody>
              {t.shops.slice(0, 10).map((r) => (
                <tr key={r.key}>
                  <td className="max-w-96 truncate" title={r.shop}>
                    {station ? <Link href={`/data?src=${t.s.key}&shop=${encodeURIComponent(r.key)}`} className="link">{r.shop}</Link> : r.shop}
                  </td>
                  {t.s.metrics.map((x, i) => <td key={x.label} className="text-right tabular-nums">{x.money ? `${fmtNum(r.m[i])} ₫` : fmtNum(r.m[i])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          {t.shops.length > 10 && <p className="mt-1 text-xs text-ink-3">+{t.shops.length - 10} {t.s.shop.label.toLowerCase()} khác.</p>}
        </div>
      )}

      {t.note && <p className="mt-3 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">{t.note}</p>}

      {children}

      {station && canRaw && (
        <div className="mt-4 border-t border-line pt-3">
          {raw ? <RawTable raw={raw} handle={handle} /> : (
            <Link href={`/creator/${handle}?raw=${t.s.key}#${t.s.key}`} className="btn h-8 px-3 text-xs">
              Xem 50 dòng chi tiết mới nhất{LIVE_SOURCES.includes(t.s.key) ? '' : ' (chờ ~15 giây)'}
            </Link>
          )}
        </div>
      )}

    </section>
  );
}

function RawTable({ raw, handle }: { raw: Awaited<ReturnType<typeof rawRows>> | string; handle: string }) {
  if (typeof raw === 'string') return <p role="alert" title={raw} className="rounded-md bg-critical-soft px-3 py-2 text-[13px] text-critical">Chưa lấy được số chi tiết. Thử lại sau ít phút.</p>;
  const cell = (c: RawColumn, v: unknown) => {
    if (v == null || v === '') return '—';
    const s = String(v);
    if (c.type === 'video') return <a href={`https://www.tiktok.com/@${handle}/video/${s}`} target="_blank" rel="noreferrer" className="link">Mở ↗</a>;
    if (c.type === 'money') return `${fmtNum(Number(s))} ₫`;
    if (c.type === 'int') return fmtNum(Number(s));
    if (c.type === 'ts') return s.startsWith('1970') ? '—' : new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    if (c.type === 'date') return fmtDate(new Date(`${s.slice(0, 10)}T00:00:00+07:00`));
    return <span className="line-clamp-2 max-w-64" title={s}>{s}</span>;
  };
  return (
    <>
      <h3 className="mb-1 text-[13px] font-semibold">Chi tiết: {fmtNum(raw.rows.length)} dòng mới nhất</h3>
      {!raw.rows.length ? <p className="text-xs text-ink-3">Không có dòng nào.</p> : (
        <div className="max-h-[28rem] overflow-auto rounded-md border border-line">
          <table className="tbl text-xs">
            <thead className="sticky top-0 bg-surface"><tr>{raw.columns.map((c) => <th key={c.id} className="min-w-20 whitespace-normal">{c.label}</th>)}</tr></thead>
            <tbody>{raw.rows.map((r, i) => <tr key={i}>{raw.columns.map((c) => <td key={c.id}>{cell(c, r[c.id])}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      <p className="mt-1 text-xs text-ink-3">Mỗi dòng là một đơn, hoặc một video / phiên LIVE trong một ngày. Số tổng ở trên cộng từ các dòng này.</p>
    </>
  );
}

function LarkBookings({ bookings, total }: { bookings: { id: string; code: string; brand: string | null; pipeline: string | null; airDate: Date | null; planAirDate: Date | null; cost: number | null; linkAir: string | null; extra: unknown }[]; total: number }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <h3 className="mb-1 text-[13px] font-semibold">Booking ({total}{total > 30 ? ', 30 gần nhất' : ''})</h3>
      <table className="tbl">
        <thead><tr><th>Mã BO</th><th>Brand</th><th>Pipeline</th><th>Ngày air</th><th className="text-right">Chi phí</th><th className="text-right">View / GMV 30 ngày</th></tr></thead>
        <tbody>
          {bookings.map((b) => {
            const x = b.extra as Record<string, unknown>;
            return (
              <tr key={b.id}>
                <td><Link href={`/booking/${b.id}`} className="font-mono text-xs text-accent hover:underline">{b.code}</Link></td>
                <td>{b.brand ?? '—'}</td>
                <td>{b.pipeline ?? '—'}</td>
                <td className="whitespace-nowrap">{b.linkAir?.startsWith('http') ? <a href={b.linkAir} target="_blank" rel="noreferrer" className="link">{fmtDate(b.airDate)}</a> : b.airDate ? fmtDate(b.airDate) : b.planAirDate ? `Dự kiến ${fmtDate(b.planAirDate)}` : '—'}</td>
                <td className="text-right tabular-nums">{fmtNum(b.cost)}</td>
                <td className="text-right text-xs tabular-nums">{fmtShort(num(x.views30))} · {fmtShort(num(x.gmv30))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
