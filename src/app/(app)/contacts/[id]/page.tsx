import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Avatar } from '@/components/ui';
import { creatorSources } from '@/lib/dataSources';
import { db } from '@/lib/db';
import { fmtDate, fmtNum, fmtPct, fmtShort, fmtVnd } from '@/lib/format';
import { bookingsOf, collabSummary, profileInsights, USD_VND } from '@/lib/kocInsights';
import { requireUser } from '@/lib/session';
import { addNote, closeFollowUp, refreshFromTikTok } from '../actions';

const TIKTOK_MSG: Record<string, string> = {
  updated: 'Đã cập nhật số liệu từ TikTok.',
  missing: 'Kênh không có trên TikTok Shop Creator Marketplace (hoặc chưa đủ điều kiện affiliate).',
  limited: 'TikTok đang chặn tần suất gọi. Hệ thống sẽ tự cập nhật ở lượt mỗi giờ.',
  failed: 'Không lấy được số liệu từ TikTok. Thử lại sau.',
};

export default async function KocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tiktok?: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const { tiktok } = await searchParams;
  const koc = await db.koc.findUnique({ where: { id }, include: { pic: true } });
  if (!koc) notFound();

  const canEdit = me.role !== 'STAFF';
  const [byHandle, sources, history, notes] = await Promise.all([
    bookingsOf([koc.handle]),
    creatorSources(koc.handle),
    db.kocSnapshot.findMany({ where: { kocId: koc.id }, orderBy: { at: 'desc' }, take: 12 }),
    db.kocNote.findMany({ where: { kocId: koc.id }, include: { author: true }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  const nextFollow = notes.filter((n) => n.followUpAt && !n.doneAt).sort((a, b) => +a.followUpAt! - +b.followUpAt!)[0];
  const today = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) + 'T23:59:59+07:00');
  const bookings = byHandle.get(koc.handle) ?? [];
  const collab = collabSummary(bookings);
  const p = profileInsights(koc.ttsProfile);
  const kl = koc.kl ?? collab.kl;

  // Độ đầy đủ hồ sơ: 5 nhóm thông tin theo yêu cầu chuẩn hoá KOC.
  const groups = [
    ['Số liệu TikTok', Boolean(koc.statsAt)],
    ['Cấp KOL', Boolean(kl)],
    ['Liên hệ', Boolean(koc.phone || koc.zalo || koc.email)],
    ['Nhận hàng', Boolean(koc.receiverName && koc.address)],
    ['Thanh toán', Boolean(koc.bankAccount && koc.idNumber)],
  ] as const;
  const missing = groups.filter(([, ok]) => !ok).map(([n]) => n);

  return (
    <>
      <Link href="/contacts" className="text-xs text-ink-3 hover:text-ink">← Danh bạ KOC</Link>

      <div className="mt-2 mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar src={koc.avatarUrl} name={koc.nickname ?? koc.name} size={56} />
          <div>
            <h1 className="text-xl font-semibold">{koc.nickname ?? koc.name}</h1>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
              {koc.channelUrl ? <a href={koc.channelUrl} target="_blank" rel="noreferrer" className="link">@{koc.handle}</a> : <span>@{koc.handle}</span>}
              <span>{koc.platform}</span>
              {kl && <span className="pill bg-accent-soft text-accent">{kl}</span>}
              {koc.niche && <span className="pill bg-sunken text-ink-2">{koc.niche}</span>}
              {koc.pic?.name && <span>PIC {koc.pic.name}</span>}
              {nextFollow && (
                <span className={`pill ${nextFollow.followUpAt! <= today ? 'bg-critical-soft text-critical' : 'bg-sunken text-ink-2'}`}>Hẹn liên hệ {fmtDate(nextFollow.followUpAt)}</span>
              )}
              <span className={`pill ${missing.length ? 'bg-warning-soft text-warning' : 'bg-positive-soft text-positive'}`} title={missing.length ? `Thiếu: ${missing.join(', ')}` : undefined}>
                Hồ sơ {groups.length - missing.length}/{groups.length}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {koc.platform === 'TikTok' && <Link href={`/creator/${koc.handle}`} className="btn">Hiệu quả ở mọi nguồn</Link>}
          <form action={refreshFromTikTok}>
            <input type="hidden" name="id" value={koc.id} />
            <button className="btn">Cập nhật từ TikTok</button>
          </form>
          {canEdit && <Link href={`/contacts?edit=${koc.id}`} className="btn">Sửa hồ sơ</Link>}
        </div>
      </div>

      {(koc.blacklisted || koc.tags.length > 0) && (
        <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-md px-3 py-2 text-[13px] ${koc.blacklisted ? 'bg-critical-soft text-critical' : 'bg-sunken'}`}>
          {koc.blacklisted && <b>Blacklist: {koc.blacklistReason ?? 'không ghi lý do'}.</b>}
          {koc.tags.map((t) => <Link key={t} href={`/contacts?tag=${encodeURIComponent(t)}`} className="pill bg-surface text-ink-2">{t}</Link>)}
        </div>
      )}

      {tiktok && TIKTOK_MSG[tiktok] && (
        <div role="status" className={`mb-4 rounded-md px-3 py-2.5 ${tiktok === 'updated' ? 'bg-positive-soft text-positive' : 'bg-warning-soft text-warning'}`}>{TIKTOK_MSG[tiktok]}</div>
      )}

      <Section title="Hiệu quả 30 ngày" meta={koc.statsAt ? `TikTok Shop · cập nhật ${fmtDate(koc.statsAt)}` : koc.ttsCheckedAt ? 'Không có trên Creator Marketplace' : 'Chưa tra'}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Stat label="Follower" value={fmtShort(koc.followers)} />
          <Stat label="View TB / video bán hàng" value={fmtNum(koc.avgViews)} />
          <Stat label="View TB / LIVE" value={fmtNum(koc.avgLiveViews)} />
          <Stat label="Số món bán" value={fmtNum(koc.unitsSold)} />
          <Stat label="GMV" value={p.gmvExactVnd != null ? fmtShort(p.gmvExactVnd) + ' ₫' : koc.gmvRange ?? '—'} sub={p.gmvExactVnd != null ? koc.gmvRange ?? undefined : undefined} />
          <Stat label="GPM" value={koc.gpmUsd == null ? '—' : fmtVnd(koc.gpmUsd * USD_VND)} sub={koc.gpmUsd == null ? undefined : `${koc.gpmUsd} USD`} />
          <Stat label="GMV / khách hàng" value={p.aovText ?? '—'} />
          <Stat label="Tỷ lệ tương tác video" value={fmtPct(p.engagement, 2)} />
        </div>
        {history.length > 0 && (
          <details className="mt-4 border-t border-line pt-3" open={history.length > 1}>
            <summary className="cursor-pointer text-[13px] font-medium">Lịch sử chỉ số ({history.length} lần tra)</summary>
            <table className="tbl mt-2">
              <thead><tr><th>Ngày tra</th><th className="text-right">Follower</th><th className="text-right">View TB / video</th><th className="text-right">View TB / LIVE</th><th className="text-right">Số món bán</th><th>GMV</th></tr></thead>
              <tbody>
                {history.map((h, i) => {
                  const prev = history[i + 1];
                  return (
                    <tr key={h.id}>
                      <td>{fmtDate(h.at)}</td>
                      <td className="text-right">{fmtNum(h.followers)}<Delta now={h.followers} before={prev?.followers} /></td>
                      <td className="text-right">{fmtNum(h.avgViews)}<Delta now={h.avgViews} before={prev?.avgViews} /></td>
                      <td className="text-right">{fmtNum(h.avgLiveViews)}<Delta now={h.avgLiveViews} before={prev?.avgLiveViews} /></td>
                      <td className="text-right">{fmtNum(h.unitsSold)}<Delta now={h.unitsSold} before={prev?.unitsSold} /></td>
                      <td>{h.gmvRange ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
        )}
      </Section>

      {sources.length > 0 && (
        <Section title="Hiệu quả theo nguồn TikTok" meta={`Trạm dữ liệu · tổng hợp ${fmtDate(sources[0].at)} · toàn bộ khoảng ngày của từng bảng`}>
          <table className="tbl">
            <tbody>
              {sources.map(({ s, m, shops }) => (
                <tr key={s.key} className="align-top">
                  <td className="whitespace-nowrap">
                    <Link href={`/data?src=${s.key}&ours=1`} className="link">{s.name}</Link>
                    <div className="text-xs text-ink-3">{s.group === 'partner' ? 'Partner Center' : 'Seller Center'}</div>
                  </td>
                  <td className="text-[13px]">
                    {s.metrics.map((x, i) => (
                      <span key={x.label} className="mr-4 inline-block whitespace-nowrap">
                        <span className="text-ink-3">{x.label}</span> <span className="font-medium tabular-nums">{x.money ? `${fmtShort(m[i])} ₫` : fmtNum(m[i])}</span>
                      </span>
                    ))}
                    {s.shop && shops.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 border-l-2 border-line pl-2 text-xs">
                        {shops.slice(0, 5).map((x) => (
                          <li key={x.key} className="flex flex-wrap gap-x-3">
                            <span className="max-w-72 truncate font-medium" title={x.shop}>{x.shop}</span>
                            {s.metrics.map((mm, i) => (
                              <span key={mm.label} className="text-ink-3">{mm.label} <span className="tabular-nums text-ink-2">{mm.money ? `${fmtShort(x.m[i])} ₫` : fmtNum(x.m[i])}</span></span>
                            ))}
                          </li>
                        ))}
                        {shops.length > 5 && <li className="text-ink-3">+{shops.length - 5} {s.shop.label.toLowerCase()} khác</li>}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Tỷ trọng GMV">
          <Bar label="Video" value={p.gmvVideo} />
          <Bar label="LIVE" value={p.gmvLive} />
          <Bar label="Thẻ sản phẩm" value={p.gmvShowcase} />
          <div className="mt-3 border-t border-line pt-3">
            {p.categories.length ? p.categories.map((c) => <Bar key={c.name} label={c.name} value={c.share} />) : <Empty />}
          </div>
        </Section>
        <Section title="Chân dung follower">
          <Bar label="Nữ" value={p.female} />
          <Bar label="Nam" value={p.male} />
          <Bar label="18–24 tuổi" value={p.age18_24} />
          <Bar label="25–34 tuổi" value={p.age25_34} />
          <div className="mt-3 border-t border-line pt-3">
            {p.locations.length ? p.locations.map((l) => <Bar key={l.name} label={l.name} value={l.share} />) : <Empty />}
          </div>
        </Section>
      </div>

      <Section
        title="Hợp tác với UpBase"
        meta={`${collab.count} booking · tổng ${fmtVnd(collab.totalCost)}${collab.brands.length ? ` · ${collab.brands.length} brand` : ''}`}
      >
        {bookings.length ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <Stat label="Giá booking gần nhất" value={fmtVnd(collab.lastPrice)} sub={collab.lastPriceNote ?? undefined} />
              <Stat label="Brand đã làm" value={String(collab.brands.length)} sub={collab.brands.slice(0, 3).join(', ')} />
              <Stat label="Booking GMV tốt nhất (30 ngày)" value={collab.best ? fmtVnd(collab.best.gmv30) : '—'} sub={collab.best ? `${collab.best.code} · ${collab.best.brand ?? ''}` : undefined} />
              <Stat label="Brand ngoài đã hợp tác (TikTok)" value={fmtNum(p.brandCount)} />
            </div>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Mã booking</th><th>Brand</th><th>Hình thức</th><th>Ngày air</th><th className="text-right">Chi phí</th><th className="text-right">View / GMV 30 ngày</th><th>Pipeline</th></tr></thead>
                <tbody>
                  {bookings.slice(0, 30).map((b) => (
                    <tr key={b.code}>
                      <td className="font-mono text-xs">{b.code}</td>
                      <td>{b.brand ?? '—'}<div className="max-w-56 truncate text-xs text-ink-3">{b.extra?.product}</div></td>
                      <td className="text-xs">{b.extra?.format ?? '—'}</td>
                      <td className="whitespace-nowrap">{b.linkAir?.startsWith('http') ? <a href={b.linkAir} target="_blank" rel="noreferrer" className="link">{fmtDate(b.airDate)}</a> : fmtDate(b.airDate)}</td>
                      <td className="text-right">{fmtNum(b.cost)}</td>
                      <td className="text-right text-xs">{fmtShort(Number(b.extra?.views30) || null)} · {fmtShort(Number(b.extra?.gmv30) || null)}</td>
                      <td>{b.pipeline ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {bookings.length > 30 && <p className="mt-2 text-xs text-ink-3">Hiện 30/{bookings.length} booking gần nhất. Xem đủ ở tab Booking.</p>}
            </div>
          </>
        ) : <Empty text="Chưa có booking nào với UpBase." />}
      </Section>

      <Section title="Nhật ký chăm sóc" meta="Ghi lại trao đổi, báo giá, hẹn liên hệ lại">
        <form action={addNote} className="mb-4 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <input type="hidden" name="kocId" value={koc.id} />
          <div>
            <label htmlFor="note-body" className="label">Nội dung</label>
            <textarea id="note-body" name="body" required rows={2} className="input" placeholder="VD: Đã gửi brief, KOC báo giá 3tr/video, chờ brand duyệt" />
          </div>
          <div>
            <label htmlFor="note-follow" className="label">Hẹn liên hệ lại</label>
            <input id="note-follow" name="followUpAt" type="date" className="input" />
          </div>
          <button className="btn btn-primary">Ghi</button>
        </form>
        {notes.length ? (
          <ol className="space-y-3">
            {notes.map((n) => (
              <li key={n.id} className="flex gap-3">
                <Avatar src={n.author?.avatarUrl} name={n.author?.name} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink-3">
                    {n.author?.name ?? 'Đã xoá'} · {n.createdAt.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}
                  </div>
                  <p className="text-[13px] whitespace-pre-line">{n.body}</p>
                  {n.followUpAt && (
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      {n.doneAt ? (
                        <span className="text-ink-3 line-through">Hẹn {fmtDate(n.followUpAt)}</span>
                      ) : (
                        <>
                          <span className={`pill ${n.followUpAt <= today ? 'bg-critical-soft text-critical' : 'bg-warning-soft text-warning'}`}>Hẹn {fmtDate(n.followUpAt)}</span>
                          <form action={closeFollowUp}>
                            <input type="hidden" name="id" value={n.id} />
                            <button className="link">Đã xử lý</button>
                          </form>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : <Empty text="Chưa có ghi chú nào." />}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Liên hệ & nhận hàng">
          <Info rows={[['SĐT', koc.phone], ['Zalo', koc.zalo], ['Email', koc.email], ['Người nhận hàng', koc.receiverName], ['SĐT nhận hàng', koc.receiverPhone], ['Địa chỉ', koc.address]]} />
        </Section>
        {canEdit && (
          <Section title="Thanh toán" meta="Chỉ Admin, Leader xem · không xuất cho Brand">
            <Info rows={[['Chủ tài khoản', koc.bankHolder], ['Số tài khoản', koc.bankAccount], ['Ngân hàng', koc.bankName], ['CCCD / MST', koc.idNumber]]} />
          </Section>
        )}
      </div>
    </>
  );
}

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-lg border border-line bg-surface px-5 py-4">
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
    <div className="min-w-0">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-0.5 truncate text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="truncate text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="mb-2 grid grid-cols-[9rem_1fr_3.5rem] items-center gap-3 text-[13px]">
      <span className="truncate text-ink-2">{label}</span>
      <span className="h-2 rounded-full bg-sunken"><span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.min(100, (value ?? 0) * 100)}%` }} /></span>
      <span className="text-right tabular-nums">{fmtPct(value)}</span>
    </div>
  );
}

function Info({ rows }: { rows: [string, string | null][] }) {
  return (
    <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-[13px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-3">{k}</dt>
          <dd className={v ? '' : 'text-ink-3'}>{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

const Empty = ({ text = 'Chưa có số liệu.' }: { text?: string }) => <p className="text-[13px] text-ink-3">{text}</p>;

function Delta({ now, before }: { now: number | null; before?: number | null }) {
  if (now == null || before == null || now === before) return null;
  const up = now > before;
  return <span className={`ml-1 text-xs ${up ? 'text-positive' : 'text-critical'}`}>{up ? '▲' : '▼'}{fmtShort(Math.abs(now - before))}</span>;
}
