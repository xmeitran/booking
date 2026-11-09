// Xếp hạng creator và Theo shop / brand của tab Dữ liệu (một nguồn mỗi lần, chọn nguồn theo nhóm câu hỏi).
import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { db } from '@/lib/db';
import { byShop, originOf, topCreators, type ShopRow, type Source, type SourceStats, type TopRow } from '@/lib/dataSources';
import { fmtNum, fmtShort } from '@/lib/format';
import { areaOf, day, fmtTime, KindPill, MetricNotes, SourcePicker } from './ui';

type Saved = SourceStats | { error: string } | undefined;
const localOnly = (s: Source) => s.group === 'lark' || s.key === 'marketplace'; // nguồn chỉ gồm KOL Danh bạ

/** Dòng mô tả nguồn: đến từ đâu, loại số, phủ ngày nào, số trên trang lấy lúc nào. */
function SourceInfo({ s, st, at, ours }: { s: Source; st: Saved; at: Date | null; ours: boolean }) {
  const o = originOf(s);
  return (
    <dl className="mb-3 grid gap-x-6 gap-y-1 rounded-md bg-sunken px-3 py-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div className="sm:col-span-2"><dt className="inline text-ink-3">Bảng: </dt><dd className="inline">{s.note}</dd></div>
      <div><dt className="inline text-ink-3">Loại số: </dt><dd className="inline"><KindPill k={areaOf(s)} /></dd></div>
      <div><dt className="inline text-ink-3">Phủ dữ liệu: </dt><dd className="inline">{st && !('error' in st) ? `${day(st.from)} – ${day(st.to)}` : '—'}</dd></div>
      <div className="sm:col-span-2"><dt className="inline text-ink-3">Đến từ: </dt><dd className="inline">{o.path}</dd></div>
      <div className="sm:col-span-2">
        <dt className="inline text-ink-3">Số trên trang: </dt>
        <dd className="inline">{at ? `kéo sẵn lúc ${fmtTime(at)}` : localOnly(s) || ours ? 'lưu trong Booking Hub' : 'tra trực tiếp lúc mở trang'} · cập nhật {o.schedule}</dd>
      </div>
    </dl>
  );
}

export async function RankView({ s, st, ours, shop, by }: { s: Source; st: Saved; ours: boolean; shop?: string; by: number }) {
  const local = localOnly(s);
  let rows: TopRow[] = [];
  let at: Date | null = null;
  let error = '';
  try {
    ({ rows, at } = await topCreators(s, ours, by, ours ? 1000 : 100, shop));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const kocs = await db.koc.findMany({
    where: { platform: 'TikTok', handle: { in: rows.map((r) => r.handle.toLowerCase()) } },
    select: { id: true, handle: true, name: true, nickname: true, avatarUrl: true },
  });
  const kocOf = new Map(kocs.map((k) => [k.handle, k]));
  const href = (o: { src?: string; ours?: boolean; by?: number; shop?: string | null }) => {
    const p = new URLSearchParams({ view: 'rank', src: o.src ?? s.key });
    if (o.ours ?? ours) p.set('ours', '1');
    const sh = o.src ? undefined : o.shop === null ? undefined : o.shop ?? shop;
    if (sh !== undefined) p.set('shop', sh);
    if (!o.src && (o.by ?? by)) p.set('by', String(o.by ?? by));
    return `/data?${p}`;
  };
  const shopName = shop !== undefined ? rows[0]?.shops?.find((x) => x.key === shop)?.shop ?? (shop || '(trống)') : '';
  const cell = (x: { money?: boolean }, v: number) => (x.money ? `${fmtNum(v)} ₫` : fmtNum(v));

  return (
    <>
      <div className="mb-4 rounded-lg border border-line bg-surface px-4 py-3">
        <p className="mb-2 text-xs font-semibold text-ink-2">Xếp hạng theo bảng</p>
        <SourcePicker current={s} href={(key) => href({ src: key })} />
      </div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{s.name}</h2>
          <p className="text-[13px] text-ink-2">{ours || local ? 'KOL trong Danh bạ' : 'Top 100 creator'} xếp theo <b>{s.metrics[by].label}</b>; bấm tiêu đề cột để đổi chỉ số.</p>
        </div>
        {!local && (
          <div className="flex rounded-md bg-sunken p-0.5 text-[13px]">
            <Link href={href({ ours: false })} className={`rounded px-3 py-1 ${!ours ? 'bg-surface font-medium shadow-sm' : 'text-ink-3'}`}>Mọi creator</Link>
            <Link href={href({ ours: true })} className={`rounded px-3 py-1 ${ours ? 'bg-surface font-medium shadow-sm' : 'text-ink-3'}`}>Chỉ KOL Danh bạ</Link>
          </div>
        )}
      </div>
      <SourceInfo s={s} st={st} at={at} ours={ours} />
      {shop !== undefined && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="pill bg-accent-soft px-2.5 py-1 text-accent">{s.shop?.label}: {shopName}</span>
          <Link href={href({ shop: null })} className="link">Bỏ lọc</Link>
          <span className="text-xs text-ink-3">Số trong bảng chỉ tính phần của {s.shop?.label.toLowerCase()} này.</span>
        </p>
      )}
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
                  <th key={x.label} className="text-right" title={x.hint}>
                    <Link href={href({ by: i })} className={i === by ? 'text-ink' : 'hover:text-ink'}>{x.label}{i === by ? ' ↓' : ''}</Link>
                  </th>
                ))}
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
      {s.shop && !error && <p className="mt-2 text-xs text-ink-3">Cột {s.shop.label.toLowerCase()}: tối đa 20 {s.shop.label.toLowerCase()} lớn nhất mỗi creator, theo {s.metrics[0].label}; bấm để lọc.</p>}
      <MetricNotes s={s} />
    </>
  );
}

export async function ShopView({ s, st, by }: { s: Source; st: Saved; by: number }) {
  let data: { rows: (ShopRow & { creators: number })[]; total: number; at: Date | null } = { rows: [], total: 0, at: null };
  let error = '';
  try {
    data = await byShop(s, by);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const label = s.shop!.label;
  const href = (o: { src?: string; by?: number }) => {
    const p = new URLSearchParams({ view: 'shop', src: o.src ?? s.key });
    if (!o.src && (o.by ?? by)) p.set('by', String(o.by ?? by));
    return `/data?${p}`;
  };
  return (
    <>
      <div className="mb-4 rounded-lg border border-line bg-surface px-4 py-3">
        <p className="mb-2 text-xs font-semibold text-ink-2">Tách theo shop / brand / sản phẩm của bảng</p>
        <SourcePicker current={s} href={(key) => href({ src: key })} only={(x) => Boolean(x.shop)} />
      </div>
      <div className="mb-3">
        <h2 className="text-lg font-semibold">{s.name} · theo {label.toLowerCase()}</h2>
        <p className="text-[13px] text-ink-2">Mỗi {label.toLowerCase()} có bao nhiêu creator và hiệu quả; bấm tên để xem creator của {label.toLowerCase()} đó.</p>
      </div>
      <SourceInfo s={s} st={st} at={data.at} ours={false} />
      {error ? (
        <p role="alert" className="rounded-md bg-critical-soft px-3 py-2 text-critical">Không đọc được Trạm dữ liệu: {error}.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-10">#</th><th>{label}</th><th className="text-right">Creator</th>
                {s.metrics.map((x, i) => (
                  <th key={x.label} className="text-right" title={x.hint}>
                    <Link href={href({ by: i })} className={i === by ? 'text-ink' : 'hover:text-ink'}>{x.label}{i === by ? ' ↓' : ''}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, n) => (
                <tr key={r.key + n}>
                  <td className="text-ink-3 tabular-nums">{n + 1}</td>
                  <td className="max-w-80"><Link href={`/data?${new URLSearchParams({ view: 'rank', src: s.key, shop: r.key })}`} className="link">{r.shop}</Link></td>
                  <td className="text-right tabular-nums">{fmtNum(r.creators)}</td>
                  {s.metrics.map((x, i) => <td key={x.label} className="text-right tabular-nums">{x.money ? `${fmtNum(r.m[i])} ₫` : fmtNum(r.m[i])}</td>)}
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={s.metrics.length + 3} className="py-12 text-center text-ink-3">Không có dữ liệu.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {!error && <p className="mt-2 text-xs text-ink-3">{fmtNum(data.total)} {label.toLowerCase()}{data.total > data.rows.length ? `, hiện ${data.rows.length} đầu` : ''}.</p>}
      <MetricNotes s={s} />
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
      {list.length > 3 && <li className="text-ink-3" title={list.slice(3).map((r) => `${r.shop}: ${v(r)}`).join('\n')}>+{list.length - 3} {s.shop!.label.toLowerCase()} khác</li>}
    </ul>
  );
}
