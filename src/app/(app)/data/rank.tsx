// Xếp hạng creator và Theo shop / brand của tab Dữ liệu (một nguồn mỗi lần, chọn nguồn theo nhóm câu hỏi).
import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { db } from '@/lib/db';
import { byShop, originOf, placesOf, topCreators, type ShopRow, type Source, type SourceStats, type TopRow } from '@/lib/dataSources';
import { fmtNum, fmtShort } from '@/lib/format';
import { areaOf, day, Empty, fmtTime, KindPill, MetricNotes, Panel, Segmented, SourcePicker, Status } from './ui';

type Saved = SourceStats | { error: string } | undefined;
const localOnly = (s: Source) => s.group === 'lark' || s.key === 'marketplace'; // nguồn chỉ gồm KOL Danh bạ
const cell = (x: { money?: boolean }, v: number) => (x.money ? `${fmtNum(v)} ₫` : fmtNum(v));

/** Dòng mô tả nguồn: loại số, phủ ngày nào, đến từ đâu, số trên trang lấy lúc nào. */
function SourceInfo({ s, st, at, ours }: { s: Source; st: Saved; at: Date | null; ours: boolean }) {
  const o = originOf(s);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-2xs text-ink-3">
      <KindPill k={areaOf(s)} />
      <span>Nguồn <b className="font-medium text-ink-2">{placesOf(s)}</b></span>
      <span>Phủ dữ liệu <b className="font-medium text-ink-2">{st && !('error' in st) ? `${day(st.from)} – ${day(st.to)}` : '—'}</b></span>
      <span>Số trên trang <b className="font-medium text-ink-2">{at ? `kéo sẵn lúc ${fmtTime(at)}` : localOnly(s) || ours ? 'lưu trong Booking Hub' : 'tra trực tiếp lúc mở trang'}</b> · cập nhật {o.schedule}</span>
    </div>
  );
}

function SortHead({ s, by, href }: { s: Source; by: number; href: (i: number) => string }) {
  return s.metrics.map((x, i) => (
    <th key={x.label} className="text-right" title={x.hint}>
      <Link href={href(i)} className={i === by ? 'text-ink' : 'hover:text-ink'}>{x.label}{i === by ? ' ↓' : ''}</Link>
    </th>
  ));
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
    select: { handle: true, name: true, nickname: true, avatarUrl: true },
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

  return (
    <div className="grid gap-4">
      <Panel>
        <SourcePicker current={s} href={(key) => href({ src: key })} />
      </Panel>
      <Panel
        flush
        title={s.name}
        meta={<>{s.note} · {ours || local ? 'KOL trong Danh bạ' : 'top 100 creator'} xếp theo <b className="font-medium text-ink-2">{s.metrics[by].label}</b>, bấm tiêu đề cột để đổi</>}
        actions={!local && <Segmented items={[{ href: href({ ours: false }), label: 'Mọi creator', active: !ours }, { href: href({ ours: true }), label: 'Chỉ KOL Danh bạ', active: ours }]} />}
      >
        <div className="grid gap-2.5 border-b border-line px-4 py-3">
          <SourceInfo s={s} st={st} at={at} ours={ours} />
          {shop !== undefined && (
            <p className="flex flex-wrap items-center gap-2 text-2xs text-ink-3">
              <Status tone="info">{s.shop?.label}: {shopName}</Status>
              <Link href={href({ shop: null })} className="link">Bỏ lọc</Link>
              Số trong bảng chỉ tính phần của {s.shop?.label.toLowerCase()} này.
            </p>
          )}
        </div>
        {error ? (
          <Empty tone="critical">
            Không đọc được Trạm dữ liệu: {error}.{/HTTP 5/.test(error) && ' Trạm đang bận, tải lại trang sau ít phút.'}{!ours && ' Có thể xem "Chỉ KOL Danh bạ" (số đã lưu sẵn).'}
          </Empty>
        ) : !rows.length ? (
          <Empty>Không có creator nào.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dt">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>Creator</th>
                  <SortHead s={s} by={by} href={(i) => href({ by: i })} />
                  {s.shop && <th>{s.shop.label} đã bán / hợp tác</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, n) => {
                  const k = kocOf.get(r.handle.toLowerCase());
                  return (
                    <tr key={r.handle}>
                      <td className="text-ink-3">{n + 1}</td>
                      <td>
                        <Link href={`/creator/${encodeURIComponent(r.handle.toLowerCase())}`} className="flex items-center gap-2" title="Xem hiệu quả ở mọi nguồn và dữ liệu gốc">
                          <Avatar src={k?.avatarUrl} name={k ? k.nickname ?? k.name : r.handle} size={24} />
                          <span className="font-medium text-ink hover:text-accent hover:underline">@{r.handle}</span>
                          {k && <Status tone="info">Danh bạ</Status>}
                        </Link>
                      </td>
                      {s.metrics.map((x, i) => <td key={x.label} className={`text-right ${i === by ? 'font-medium' : ''}`}>{cell(x, r.m[i])}</td>)}
                      {s.shop && <td><Shops s={s} list={r.shops ?? []} href={(key) => href({ shop: key })} /></td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {s.shop && !error && rows.length > 0 && (
          <p className="border-t border-line px-4 py-2 text-2xs text-ink-3">Cột {s.shop.label.toLowerCase()}: tối đa 20 {s.shop.label.toLowerCase()} lớn nhất mỗi creator, theo {s.metrics[0].label}; bấm để lọc.</p>
        )}
      </Panel>
      <MetricNotes s={s} />
    </div>
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
    <div className="grid gap-4">
      <Panel>
        <SourcePicker current={s} href={(key) => href({ src: key })} only={(x) => Boolean(x.shop)} />
      </Panel>
      <Panel flush title={`${s.name} · theo ${label.toLowerCase()}`} meta={`Mỗi ${label.toLowerCase()} có bao nhiêu creator và hiệu quả; bấm tên để xem creator của ${label.toLowerCase()} đó`}>
        <div className="border-b border-line px-4 py-3"><SourceInfo s={s} st={st} at={data.at} ours={false} /></div>
        {error ? (
          <Empty tone="critical">Không đọc được Trạm dữ liệu: {error}.</Empty>
        ) : !data.rows.length ? (
          <Empty>Không có dữ liệu.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="dt">
              <thead>
                <tr><th className="w-10">#</th><th>{label}</th><th className="text-right">Creator</th><SortHead s={s} by={by} href={(i) => href({ by: i })} /></tr>
              </thead>
              <tbody>
                {data.rows.map((r, n) => (
                  <tr key={r.key + n}>
                    <td className="text-ink-3">{n + 1}</td>
                    <td className="max-w-80"><Link href={`/data?${new URLSearchParams({ view: 'rank', src: s.key, shop: r.key })}`} className="font-medium text-ink hover:text-accent hover:underline">{r.shop}</Link></td>
                    <td className="text-right">{fmtNum(r.creators)}</td>
                    {s.metrics.map((x, i) => <td key={x.label} className={`text-right ${i === by ? 'font-medium' : ''}`}>{cell(x, r.m[i])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!error && data.rows.length > 0 && (
          <p className="border-t border-line px-4 py-2 text-2xs text-ink-3">{fmtNum(data.total)} {label.toLowerCase()}{data.total > data.rows.length ? `, hiện ${data.rows.length} đầu` : ''}.</p>
        )}
      </Panel>
      <MetricNotes s={s} />
    </div>
  );
}

/** Danh sách shop / brand của một creator: 3 dòng đầu, còn lại gộp "+n" (di chuột để xem). */
function Shops({ s, list, href }: { s: Source; list: ShopRow[]; href: (key: string) => string }) {
  if (!list.length) return <span className="text-ink-3">—</span>;
  const x = s.metrics[0];
  const v = (r: ShopRow) => (x.money ? `${fmtShort(r.m[0])} ₫` : fmtShort(r.m[0]));
  return (
    <ul className="min-w-56 space-y-0.5 text-2xs">
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
