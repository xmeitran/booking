// Phần hiển thị dùng chung của tab Dữ liệu: nhóm nguồn theo câu hỏi người xem, nhãn loại số, bảng chỉ số.
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

export function KindPill({ k }: { k: AreaKey }) {
  const team = ORIGIN[k].kind === 'Team tự điền';
  return <span className={`pill ${team ? 'bg-warning-soft text-warning' : 'bg-positive-soft text-positive'}`} title={team ? 'Team nhập trên Lark, có thể thiếu hoặc sai' : 'API TikTok trả, không ai sửa tay'}>{ORIGIN[k].kind}</span>;
}

/** Trạng thái cập nhật của một nhóm nguồn. */
export function Freshness({ k, at, error }: { k: AreaKey; at: Date | null; error?: boolean }) {
  const stale = !at || Date.now() - at.getTime() > STALE_HOURS[k] * 3600_000;
  const [dot, label] = error ? ['bg-critical', 'Lỗi lần cập nhật gần nhất'] : !at ? ['bg-ink-3', 'Chưa cập nhật lần nào'] : stale ? ['bg-warning', 'Quá hạn cập nhật'] : ['bg-positive', 'Đang cập nhật đều'];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden />
      {label}{at && ` · ${fmtTime(at)}`} · {ORIGIN[k].schedule}
    </span>
  );
}

export function Metrics({ s, m }: { s: Source; m: number[] }) {
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

/** Chọn nguồn theo nhóm câu hỏi; only: chỉ các nguồn có thể xem (vd. có cột shop). */
export function SourcePicker({ current, href, only }: { current: Source; href: (key: string) => string; only?: (s: Source) => boolean }) {
  return (
    <div className="grid gap-2">
      {AREAS.map((a) => {
        const list = a.sources.filter((s) => !only || only(s));
        if (!list.length) return null;
        return (
          <div key={a.key} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="w-52 shrink-0 font-medium text-ink-2">{a.title}</span>
            {list.map((s) => (
              <Link key={s.key} href={href(s.key)} aria-current={s.key === current.key ? 'true' : undefined} title={s.note}
                className={`pill px-2.5 py-1 ${s.key === current.key ? 'bg-ink text-white' : 'bg-surface text-ink-2 ring-1 ring-line hover:text-ink'}`}>{s.name}</Link>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** "Các cột được tính thế nào" cho một nguồn. */
export function MetricNotes({ s }: { s: Source }) {
  return (
    <section className="mt-4 rounded-lg border border-line bg-sunken px-5 py-3 text-[13px]">
      <h2 className="mb-1.5 text-sm font-semibold">Các cột được tính thế nào</h2>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {s.metrics.map((x) => (
          <div key={x.label}><dt className="inline font-medium">{x.label}: </dt><dd className="inline text-ink-2">{x.hint ?? '—'}</dd></div>
        ))}
      </dl>
    </section>
  );
}
