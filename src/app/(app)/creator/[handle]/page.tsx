import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/ui';
import { db } from '@/lib/db';
import {
  creatorStation, LARK, liveCreator, MARKET, ORIGIN, originOf, rawRows, STATION,
  type CreatorSource, type RawColumn, type ShopRow, type Source, type SourceStats,
} from '@/lib/dataSources';
import { fmtDate, fmtNum, fmtShort, fmtVnd } from '@/lib/format';
import { USD_VND } from '@/lib/kocInsights';
import { requireUser } from '@/lib/session';
import { TIKTOK_USERNAME } from '@/lib/validate';

const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const day = (s: string | null | undefined) => (s ? fmtDate(new Date(s)) : '—');
const val = (x: { money?: boolean }, v: number | null | undefined) => (v == null ? '—' : x.money ? `${fmtShort(v)} ₫` : fmtShort(v));
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const GROUPS = [
  ['lark', 'Lark Base'], ['partner', 'TikTok Partner Center'], ['seller', 'TikTok Seller Center'], ['marketplace', 'Creator Marketplace'],
] as const;

type Tile = { s: Source; m: number[] | null; shops: ShopRow[]; from: CreatorSource['from'] | 'local'; known: boolean };

/** Hiệu quả của một creator ở mọi nguồn: có mặt ở đâu, số mỗi nguồn, theo shop / brand, và dữ liệu gốc để đối chiếu. */
export default async function CreatorPage({ params, searchParams }: { params: Promise<{ handle: string }>; searchParams: Promise<{ raw?: string }> }) {
  await requireUser();
  const handle = decodeURIComponent((await params).handle).replace(/^@/, '').toLowerCase();
  if (!TIKTOK_USERNAME.test(handle)) notFound();
  const { raw } = await searchParams;

  const [koc, cachedStation, state, bookings, booksSync] = await Promise.all([
    db.koc.findFirst({ where: { platform: 'TikTok', handle }, include: { pic: { select: { name: true } } } }),
    creatorStation(handle),
    db.syncState.findUnique({ where: { id: 'data-sources' } }),
    db.booking.findMany({ where: { channel: { equals: handle, mode: 'insensitive' } }, orderBy: [{ airDate: { sort: 'desc', nulls: 'last' } }, { larkUpdatedAt: 'desc' }] }),
    db.syncState.findUnique({ where: { id: 'bookings' } }),
  ]);
  const inDanhBa = Boolean(koc);
  // KOL Danh bạ đã được đối chiếu mọi bảng: không có trong bản kéo sẵn = không có. Creator khác: tra trực tiếp bảng còn thiếu
  // (~0,5 giây / bảng, Trạm có chỉ mục theo creator), mỗi lần 3 bảng để không dồn tải.
  const station: CreatorSource[] = [];
  for (let i = 0; i < cachedStation.length; i += 3) {
    station.push(...(await Promise.all(cachedStation.slice(i, i + 3).map((c) =>
      c.from || inDanhBa ? c : liveCreator(c.s, handle).catch((): CreatorSource => ({ ...c, from: null }))))));
  }
  const coverage = (state?.data ?? {}) as Record<string, SourceStats | { error: string }>;
  const updated = state?.finishedAt ?? null;

  // Lark: booking của kênh này. Marketplace: hồ sơ 30 ngày trong Danh bạ.
  const ex = (b: (typeof bookings)[number], k: string) => num((b.extra as Record<string, unknown>)[k]);
  const sum = (f: (b: (typeof bookings)[number]) => number | null, list = bookings) => list.reduce((a, b) => a + (f(b) ?? 0), 0);
  const larkM = [bookings.length, sum((b) => b.cost), sum((b) => ex(b, 'views30')), sum((b) => ex(b, 'gmv30')), sum((b) => ex(b, 'orders30'))];
  const brands = [...new Set(bookings.map((b) => b.brand ?? ''))].map((brand): ShopRow => {
    const list = bookings.filter((b) => (b.brand ?? '') === brand);
    return { key: brand, shop: brand || '(trống)', m: [list.length, sum((b) => b.cost, list), sum((b) => ex(b, 'views30'), list), sum((b) => ex(b, 'gmv30'), list), sum((b) => ex(b, 'orders30'), list)] };
  }).sort((a, b) => b.m[0] - a.m[0]);
  const dates = bookings.map((b) => (b.airDate ?? b.planAirDate)?.getTime()).filter((x): x is number => x != null);
  const larkCov = dates.length ? { from: new Date(Math.min(...dates)).toISOString(), to: new Date(Math.max(...dates)).toISOString() } : undefined;
  const marketM = koc?.statsAt ? [koc.followers ?? 0, koc.avgViews ?? 0, koc.avgLiveViews ?? 0, koc.unitsSold ?? 0] : null;

  const tiles: Tile[] = [
    { s: LARK, m: bookings.length ? larkM : null, shops: brands, from: 'local', known: true },
    ...station.map((c) => ({ ...c, known: inDanhBa || c.from !== null })),
    { s: MARKET, m: marketM, shops: [], from: 'local', known: Boolean(koc?.ttsCheckedAt) },
  ];
  const present = tiles.filter((t) => t.m);
  const rawSource = raw ? STATION.find((s) => s.key === raw) : undefined;
  const rawData = rawSource ? await rawRows(rawSource, handle).catch((e: unknown) => (e instanceof Error ? e.message : String(e))) : null;
  const name = koc?.nickname ?? koc?.name ?? `@${handle}`;

  return (
    <>
      <Link href="/data" className="text-xs text-ink-3 hover:text-ink">← Dữ liệu</Link>

      <div className="mt-2 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar src={koc?.avatarUrl} name={name} size={56} />
          <div>
            <h1 className="text-xl font-semibold">{name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
              <a href={`https://www.tiktok.com/@${handle}`} target="_blank" rel="noreferrer" className="link">@{handle} ↗</a>
              {koc ? <span className="pill bg-accent-soft text-accent">Trong Danh bạ</span> : <span className="pill bg-sunken text-ink-2">Chưa có trong Danh bạ</span>}
              {(koc?.kl ?? koc?.klAuto) && <span className="pill bg-sunken text-ink-2">{koc?.kl ?? koc?.klAuto}</span>}
              {koc?.niche && <span>{koc.niche}</span>}
              {koc?.pic?.name && <span>PIC {koc.pic.name}</span>}
            </div>
          </div>
        </div>
        {koc && <Link href={`/contacts/${koc.id}`} className="btn">Hồ sơ Danh bạ (liên hệ, chân dung follower)</Link>}
      </div>

      <section className="mb-5">
        <h2 className="mb-1 text-base font-semibold">Creator này có mặt ở đâu</h2>
        <p className="mb-3 text-[13px] text-ink-2">
          Có số ở {present.length}/{tiles.length} bảng dữ liệu. Mỗi ô là một bảng riêng, tính theo cách riêng, nên <b>không cộng các ô với nhau</b>. Bấm ô để xem chi tiết và dữ liệu gốc.
        </p>
        <div className="grid gap-4 lg:grid-cols-4">
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
          key={t.s.key} t={t} handle={handle}
          coverage={t.s.key === 'lark' ? larkCov : coverage[t.s.key]}
          updated={t.s.key === 'lark' ? booksSync?.finishedAt ?? null : t.s.key === 'marketplace' ? koc?.statsAt ?? null : updated}
          raw={rawSource?.key === t.s.key ? rawData : null}
        >
          {t.s.key === 'lark' && <LarkBookings bookings={bookings.slice(0, 30)} total={bookings.length} />}
          {t.s.key === 'marketplace' && koc && (
            <p className="mt-3 text-[13px] text-ink-2">
              GMV 30 ngày: {koc.gmvRange ?? '—'} · GPM: {koc.gpmUsd == null ? '—' : `${fmtVnd(koc.gpmUsd * USD_VND)} (${koc.gpmUsd} USD)`}. Chân dung follower, tỷ trọng GMV theo kênh và ngành xem ở{' '}
              <Link href={`/contacts/${koc.id}`} className="link">hồ sơ Danh bạ</Link>.
            </p>
          )}
        </SourceCard>
      ))}

      <section className="rounded-lg border border-line bg-sunken px-5 py-4 text-[13px] text-ink-2">
        <h2 className="mb-2 text-sm font-semibold text-ink">Cách đọc số</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><b>Đơn affiliate của shop</b> chỉ gồm đơn bán cho 8 shop UpBase quản lý; <b>Đơn MCN</b> gồm đơn của creator thuộc MCN UpBase bán cho mọi shop trên sàn. Cùng một đơn có thể nằm ở cả hai.</li>
          <li>GMV của TikTok là giá × số lượng lúc đặt đơn, chưa trừ đơn hoàn / huỷ. Hoa hồng "ước tính" có thể đổi khi quyết toán.</li>
          <li>Số trên Lark Base (view, GMV 30 ngày của booking) do team điền tay; số TikTok do API trả về, không ai sửa được.</li>
          <li>&quot;Kéo sẵn&quot; = Booking Hub tổng hợp 6 giờ / lần (nút Làm mới ở trang Dữ liệu); &quot;Tra trực tiếp&quot; = vừa hỏi Trạm dữ liệu lúc mở trang.</li>
        </ul>
      </section>
    </>
  );
}

function Kind({ g }: { g: keyof typeof ORIGIN }) {
  const team = ORIGIN[g].kind === 'Team tự điền';
  return <span className={`pill ${team ? 'bg-warning-soft text-warning' : 'bg-positive-soft text-positive'}`} title={ORIGIN[g].path}>{ORIGIN[g].kind}</span>;
}

function SourceTile({ t }: { t: Tile }) {
  const x = t.s.metrics[0];
  if (!t.m) {
    return (
      <div className="rounded-md border border-dashed border-line px-3 py-2 text-xs text-ink-3">
        <div className="font-medium">{t.s.name}</div>
        <div>{t.known ? 'Không có dữ liệu' : 'Chưa tra được'}</div>
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

const FROM_LABEL: Record<string, string> = { saved: 'Kéo sẵn', top: 'Kéo sẵn (top 200)', live: 'Tra trực tiếp lúc mở trang', local: 'Lưu trong Booking Hub' };

function SourceCard({ t, handle, coverage, updated, raw, children }: {
  t: Tile; handle: string; coverage?: Partial<SourceStats> | { error: string }; updated: Date | null;
  raw: Awaited<ReturnType<typeof rawRows>> | string | null; children?: React.ReactNode;
}) {
  const o = originOf(t.s);
  const station = t.s.group !== 'lark' && t.s.key !== 'marketplace';
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
        <div><dt className="inline text-ink-3">Đến từ: </dt><dd className="inline">{o.path}</dd></div>
        <div><dt className="inline text-ink-3">Phủ dữ liệu: </dt><dd className="inline">{cov ? `${day(cov.from)} – ${day(cov.to)}` : '—'}</dd></div>
        <div>
          <dt className="inline text-ink-3">Số trên trang: </dt>
          <dd className="inline">{FROM_LABEL[t.from ?? 'local']}{updated && t.from !== 'live' ? `, cập nhật ${fmtTime(updated)}` : ''} · {o.schedule}</dd>
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

      {children}

      {station && (
        <div className="mt-4 border-t border-line pt-3">
          {raw ? (
            <RawTable raw={raw} />
          ) : (
            <Link href={`/creator/${handle}?raw=${t.s.key}#${t.s.key}`} className="btn h-8 px-3 text-xs">Xem dữ liệu gốc (50 dòng mới nhất)</Link>
          )}
        </div>
      )}
    </section>
  );
}

function RawTable({ raw }: { raw: Awaited<ReturnType<typeof rawRows>> | string }) {
  if (typeof raw === 'string') return <p role="alert" className="rounded-md bg-critical-soft px-3 py-2 text-[13px] text-critical">Không đọc được Trạm dữ liệu: {raw}</p>;
  const cell = (c: RawColumn, v: unknown) => {
    if (v == null || v === '') return '—';
    const s = String(v);
    if (c.id === 'target') return raw.labels[s] ?? s;
    if (/^https?:\/\//.test(s)) return <a href={s} target="_blank" rel="noreferrer" className="link">Mở ↗</a>;
    if (c.type === 'money') return `${fmtNum(Number(s))} ₫`;
    if (c.type === 'int' || c.type === 'num') return fmtNum(Number(s));
    if (c.type === 'pct') return `${Number(s).toFixed(2).replace('.', ',')}%`;
    if (c.type === 'bp') return `${(Number(s) / 100).toFixed(2).replace('.', ',')}%`;
    if (c.type === 'ts') return new Date(s).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    if (c.type === 'date') return fmtDate(new Date(`${s}T00:00:00+07:00`));
    return <span className="line-clamp-2 max-w-64" title={s}>{s}</span>;
  };
  return (
    <>
      <h3 className="mb-1 text-[13px] font-semibold">Dữ liệu gốc: {fmtNum(raw.rows.length)} / {fmtNum(raw.total)} dòng mới nhất, lấy thẳng từ Trạm dữ liệu</h3>
      <div className="max-h-[28rem] overflow-auto rounded-md border border-line">
        <table className="tbl text-xs">
          <thead className="sticky top-0 bg-surface"><tr>{raw.columns.map((c) => <th key={c.id} className="min-w-20 whitespace-normal">{c.label}</th>)}</tr></thead>
          <tbody>
            {raw.rows.map((r, i) => <tr key={String(r.key ?? i)}>{raw.columns.map((c) => <td key={c.id}>{cell(c, r[c.id])}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-ink-3">Mỗi dòng là một bản ghi TikTok trả về (đơn, video theo ngày, phiên LIVE...). Số tổng ở trên được cộng từ các dòng này.</p>
    </>
  );
}

function LarkBookings({ bookings, total }: { bookings: { id: string; code: string; brand: string | null; pipeline: string | null; airDate: Date | null; planAirDate: Date | null; cost: number | null; linkAir: string | null; extra: unknown }[]; total: number }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <h3 className="mb-1 text-[13px] font-semibold">Booking ({total}{total > 30 ? ', 30 gần nhất' : ''})</h3>
      <table className="tbl">
        <thead><tr><th>Mã</th><th>Brand</th><th>Pipeline</th><th>Ngày air</th><th className="text-right">Chi phí</th><th className="text-right">View / GMV 30 ngày</th></tr></thead>
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
