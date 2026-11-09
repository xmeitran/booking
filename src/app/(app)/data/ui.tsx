// Phần hiển thị tab Dữ liệu, theo bộ component giao diện của app b2c (web-admin/src/components/ui: Panel, Status, Stat,
// StatRow, Tabs, Chips, Segmented, DataTable). Bản server: chuyển mục bằng link thay cho onClick.
import Link from 'next/link';
import { LARK, MARKET, ORIGIN, STATION, type Source } from '@/lib/dataSources';
import { fmtDate, fmtShort } from '@/lib/format';

export type AreaKey = keyof typeof ORIGIN;
/** Nhóm nguồn theo việc người xem muốn biết (thay vì theo hệ thống kỹ thuật). */
export const AREAS: { key: AreaKey; title: string; question: string; system: string; sources: Source[] }[] = [
  { key: 'seller', title: 'Bán hàng cho shop UpBase', question: 'Creator nào bán được hàng cho 8 shop UpBase', system: 'TikTok Seller Center', sources: STATION.filter((s) => s.group === 'seller') },
  { key: 'partner', title: 'Creator MCN / TAP của UpBase', question: 'Creator thuộc MCN, chiến dịch TAP của UpBase bán ra sao trên toàn sàn', system: 'TikTok Partner Center', sources: STATION.filter((s) => s.group === 'partner') },
  { key: 'lark', title: 'Booking UpBase', question: 'Đã book KOL nào, chi phí bao nhiêu, team ghi nhận hiệu quả ra sao', system: 'Lark Base · 3.2 List duyệt book', sources: [LARK] },
  { key: 'marketplace', title: 'Hồ sơ TikTok của KOL Danh bạ', question: 'Follower, lượt xem, sản phẩm bán 30 ngày của từng KOL trong Danh bạ', system: 'TikTok Creator Marketplace', sources: [MARKET] },
];
export const areaOf = (s: Source): AreaKey => (s.key === 'marketplace' ? 'marketplace' : s.group);
/** Quá hạn khi lần cập nhật gần nhất cũ hơn 2 lần chu kỳ (giờ). */
export const STALE_HOURS: Record<AreaKey, number> = { lark: 3, partner: 12, seller: 12, marketplace: 3 };

export const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
export const day = (s: string | null) => (s ? fmtDate(new Date(s)) : '—');
export const val = (v: number, money?: boolean) => (money ? `${fmtShort(v)} ₫` : fmtShort(v));

// ------------------------------------------------------------------ Thành phần giao diện (bản b2c)

export type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'critical';
const TONE: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2', info: 'bg-accent-soft text-accent', positive: 'bg-positive-soft text-positive', warning: 'bg-warning-soft text-warning', critical: 'bg-critical-soft text-critical',
};

/** Nhãn trạng thái: chấm màu + chữ, đúng tông. */
export function Status({ tone = 'neutral', title, children }: { tone?: Tone; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className={`inline-flex h-5 items-center gap-1.5 rounded px-2 text-2xs font-medium whitespace-nowrap ${TONE[tone]}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

/** Khung nội dung: tiêu đề + mô tả nhỏ + thao tác bên phải; flush = bảng sát mép. */
export function Panel({ title, meta, actions, flush, id, children }: { title?: React.ReactNode; meta?: React.ReactNode; actions?: React.ReactNode; flush?: boolean; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 overflow-hidden rounded-xl border border-line bg-surface">
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3 sm:gap-3">
          <div className="min-w-0">
            {title && <h3 className="text-[13px] leading-tight font-semibold text-ink">{title}</h3>}
            {meta && <p className="mt-1 text-2xs text-ink-3">{meta}</p>}
          </div>
          {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}

/** Tiêu đề khối: một dòng, thao tác bên phải. */
export function SectionHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-end justify-between gap-2">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Hàng chỉ số: các ô chung một khung, ngăn bằng đường kẻ mảnh, tối đa 4 ô. */
export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

/** Ô chỉ số: nhãn nhạt, số lớn, ghi chú nói ý nghĩa của con số. */
export function Stat({ label, value, note, tone, href, children }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: 'warning' | 'critical' | 'positive'; href?: string; children?: React.ReactNode }) {
  const noteColor = tone === 'warning' ? 'text-warning' : tone === 'critical' ? 'text-critical' : tone === 'positive' ? 'text-positive' : 'text-ink-3';
  const body = (
    <>
      <span className="truncate text-ctl-sm text-ink-3" title={label}>{label}</span>
      <span className="truncate text-stat font-semibold tracking-tight text-ink tabular-nums">{value}</span>
      {note && <span className={`text-2xs break-words ${noteColor}`}>{note}</span>}
      {children}
    </>
  );
  const cls = 'grid min-w-0 content-start gap-1 bg-surface px-4 pt-3.5 pb-4 transition-colors hover:bg-canvas/50';
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Tab gạch chân, số đếm nhạt; thao tác của cả trang nằm bên phải cùng hàng. */
export function TabNav({ items, actions }: { items: { href: string; label: string; count?: string; active: boolean; tone?: 'critical' }[]; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line">
      <nav aria-label="Mục dữ liệu" className="flex max-w-full min-w-0 gap-4 overflow-x-auto [scrollbar-width:none] sm:gap-6">
        {items.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.active ? 'page' : undefined}
            className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 pt-1 pb-2.5 text-ctl-md font-medium whitespace-nowrap transition-colors ${t.active ? 'border-ink text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
            {t.label}
            {t.count && <span className={`text-2xs tabular-nums ${t.tone === 'critical' ? 'text-critical' : 'text-ink-3'}`}>{t.count}</span>}
          </Link>
        ))}
      </nav>
      {actions && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2 pb-2">{actions}</div>}
    </div>
  );
}

/** Nhóm chip lọc (nhiều lựa chọn). */
export function Chips({ items, label }: { items: { href: string; label: string; count?: string; active: boolean; title?: string }[]; label?: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      {label && <span className="mr-1 w-full text-2xs text-ink-3 sm:w-52 sm:shrink-0">{label}</span>}
      {items.map((it) => (
        <Link key={it.href} href={it.href} title={it.title} aria-current={it.active ? 'true' : undefined}
          className={`inline-flex h-7 items-center rounded-full border px-2.5 text-ctl-sm whitespace-nowrap transition-colors ${it.active ? 'border-transparent bg-ink text-white' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink'}`}>
          {it.label}
          {it.count && <span className={`ml-1.5 tabular-nums ${it.active ? 'text-white/70' : 'text-ink-3'}`}>{it.count}</span>}
        </Link>
      ))}
    </div>
  );
}

/** Nút chọn 2–4 lựa chọn. */
export function Segmented({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="inline-flex max-w-full rounded-md bg-sunken p-0.5">
      {items.map((it) => (
        <Link key={it.href} href={it.href} aria-current={it.active ? 'true' : undefined}
          className={`inline-flex h-7 items-center rounded-[5px] px-3 text-ctl whitespace-nowrap transition-colors ${it.active ? 'bg-surface font-medium text-ink shadow-[0_1px_2px_rgb(22_23_26/0.08)]' : 'text-ink-3 hover:text-ink'}`}>
          {it.label}
        </Link>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Thành phần riêng của tab Dữ liệu

export function KindPill({ k }: { k: AreaKey }) {
  const team = ORIGIN[k].kind === 'Team tự điền';
  return <Status tone={team ? 'warning' : 'positive'} title={team ? 'Team nhập trên Lark, có thể thiếu hoặc sai' : 'API TikTok trả, không ai sửa tay'}>{ORIGIN[k].kind}</Status>;
}

/** Trạng thái cập nhật của một nhóm nguồn. */
export function Freshness({ k, at, error }: { k: AreaKey; at: Date | null; error?: boolean }) {
  const stale = !at || Date.now() - at.getTime() > STALE_HOURS[k] * 3600_000;
  const [tone, label]: [Tone, string] = error ? ['critical', 'Lỗi lần cập nhật gần nhất'] : !at ? ['neutral', 'Chưa cập nhật'] : stale ? ['warning', 'Quá hạn cập nhật'] : ['positive', 'Cập nhật đều'];
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-2xs text-ink-3">
      <Status tone={tone}>{label}</Status>
      {at ? `${fmtTime(at)} · ${ORIGIN[k].schedule}` : ORIGIN[k].schedule}
    </span>
  );
}

export function Metrics({ s, m }: { s: Source; m: number[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs whitespace-nowrap">
      {s.metrics.map((x, i) => (
        <div key={x.label} className="contents">
          <dt className={`text-ink-3 ${x.hint ? 'cursor-help underline decoration-dotted underline-offset-2' : ''}`} title={x.hint}>{x.label}</dt>
          <dd className="text-right tabular-nums">{val(m[i], x.money)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Chọn nguồn theo nhóm câu hỏi; only: chỉ các nguồn xem được ở màn này (vd. có cột shop). */
export function SourcePicker({ current, href, only }: { current: Source; href: (key: string) => string; only?: (s: Source) => boolean }) {
  return (
    <div className="grid gap-2">
      {AREAS.map((a) => {
        const list = a.sources.filter((s) => !only || only(s));
        return list.length ? <Chips key={a.key} label={a.title} items={list.map((s) => ({ href: href(s.key), label: s.name, active: s.key === current.key, title: s.note }))} /> : null;
      })}
    </div>
  );
}

/** "Các cột được tính thế nào" cho một nguồn. */
export function MetricNotes({ s }: { s: Source }) {
  return (
    <Panel title="Các cột được tính thế nào">
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {s.metrics.map((x) => (
          <div key={x.label}><dt className="inline font-medium">{x.label}: </dt><dd className="inline text-ink-2">{x.hint ?? '—'}</dd></div>
        ))}
      </dl>
    </Panel>
  );
}

/** Trạng thái rỗng / lỗi trong bảng. */
export function Empty({ children, tone }: { children: React.ReactNode; tone?: 'critical' }) {
  return <p role={tone ? 'alert' : undefined} className={`px-4 py-10 text-ctl ${tone ? 'text-critical' : 'text-ink-3'}`}>{children}</p>;
}
