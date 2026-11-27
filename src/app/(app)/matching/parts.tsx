// Mảnh giao diện dùng chung của Creator matching (server component, không state).
import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { fmtShort } from '@/lib/format';
import type { Finding, Metrics, ScoreResult } from '@/lib/matching/engine';
import { KO, koLabel, STAGES, STAGE_TONE, STEPS, type Manual, type Stage } from '@/lib/matching/spec';

/** Bước đang làm của đợt, để mở đúng tab. */
export function currentStep(b: { ranAt: Date | null }, n: Partial<Record<Stage, number>>) {
  if (!b.ranAt) return 1;
  if (n.APPROVED) return 6;
  if (n.CONFIRMED) return 5;
  if (n.SHORTLIST) return 4;
  if (n.POOL) return 3;
  return 2;
}

export function Stepper({ briefId, step, counts }: { briefId: string; step: number; counts: Partial<Record<number, number>> }) {
  return (
    <nav aria-label="Các bước" className="mb-4 overflow-x-auto">
      <ol className="flex min-w-max gap-1">
        {STEPS.map((s) => {
          const on = s.n === step;
          return (
            <li key={s.n}>
              <Link
                href={`/matching/${briefId}?step=${s.n}`}
                aria-current={on ? 'step' : undefined}
                title={s.hint}
                className={`flex h-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-2 hover:border-accent'}`}
              >
                <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${on ? 'bg-accent text-surface' : 'bg-sunken text-ink-2'}`}>{s.n}</span>
                <span>
                  <span className="block font-semibold">{s.title}</span>
                  <span className="block text-ink-3">{counts[s.n] != null ? `${counts[s.n]!.toLocaleString('vi-VN')} KOC` : ' '}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Ô "Việc cần làm" đầu mỗi bước: một câu hướng dẫn, các nút chính, link sang bước sau. */
export function Todo({ briefId, step, children }: { briefId: string; step: number; children?: React.ReactNode }) {
  const s = STEPS[step - 1];
  return (
    <section className="mb-4 rounded-lg border border-accent/30 bg-accent-soft/40 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h2 className="text-[13px] font-semibold text-accent">Bước {step}. {s.title}: việc cần làm</h2>
          <p className="mt-0.5 text-[13px] text-ink-2">{s.todo}</p>
        </div>
        {step < STEPS.length && <Link href={`/matching/${briefId}?step=${step + 1}`} className="btn h-8 shrink-0 px-3 text-xs">Sang bước {step + 1}: {STEPS[step].title} →</Link>}
      </div>
      {children && <div className="mt-3 flex flex-wrap items-end gap-2">{children}</div>}
    </section>
  );
}

export const StageChip = ({ stage }: { stage: string }) => <span className={`pill whitespace-nowrap ${STAGE_TONE[stage as Stage] ?? 'bg-sunken text-ink-2'}`}>{STAGES[stage as Stage] ?? stage}</span>;

export function TierChip({ score }: { score: ScoreResult | null }) {
  if (!score) return <span className="text-xs text-ink-3">—</span>;
  return <span className={`pill whitespace-nowrap ${score.tone}`} title={score.action}>{score.tier}</span>;
}

/** Điểm trên 100. Nhiều mục tạm tính (thiếu số liệu) thì hiện mờ; di chuột xem tỉ lệ mục có số liệu thật. */
export function Total({ score }: { score: ScoreResult | null }) {
  if (!score || score.total == null) return <span className="text-ink-3">—</span>;
  const cov = Math.round(score.coverage * 100);
  return (
    <span className={`font-semibold tabular-nums ${cov < 50 ? 'text-ink-3' : ''}`} title={`Điểm trên 100. ${cov}% mục có số liệu thật hoặc đã chấm; còn lại tạm tính 3 điểm.`}>
      {Math.round(score.total)}
    </span>
  );
}

/** Tone khớp brand: điểm B2C chấm, hoặc gợi ý của AI (chưa tính điểm). */
export function FitCell({ manual }: { manual: unknown }) {
  const a3 = ((manual ?? {}) as Manual).A3;
  if (!a3) return <span className="text-xs text-ink-3">Chưa chấm</span>;
  const tone = a3.score >= 4 ? 'text-positive' : a3.score <= 2 ? 'text-critical' : 'text-ink';
  return (
    <div className="max-w-72 text-xs">
      <b className={tone}>{a3.score}/5</b>{a3.by === 'AI' ? <span className="ml-1 pill bg-accent-soft text-accent">AI gợi ý</span> : <span className="ml-1 pill bg-positive-soft text-positive">B2C chấm</span>}
      {a3.note && <div className="text-ink-2">{a3.note}</div>}
    </div>
  );
}

/** Lý do loại / cảnh báo bằng chữ thường. */
export function Findings({ list, empty, hideInternal }: { list: Finding[]; empty?: string; hideInternal?: boolean }) {
  const shown = hideInternal ? list.filter((f) => !(f.code in KO && 'internal' in KO[f.code as keyof typeof KO])) : list;
  if (!shown.length) return empty ? <span className="text-xs text-ink-3">{empty}</span> : null;
  return (
    <ul className="space-y-0.5 text-xs">
      {shown.map((f, i) => <li key={i}><span className="font-medium">{koLabel(f.code)}</span>: {f.detail}</li>)}
    </ul>
  );
}

export type CandData = {
  name?: string; avatarUrl?: string | null; niche?: string | null; kl?: string | null; klSource?: string | null; price?: number | null; priceSource?: string | null;
  metrics?: Metrics | null; bookings?: number; ratings?: number; kwHits?: string[];
};

/** Ô KOC: ảnh, tên, ID kênh, cấp KOC; bấm mở chi tiết. */
export function KocCell({ href, handle, platform, d, kocId }: { href: string; handle: string; platform: string; d: CandData; kocId: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar src={d.avatarUrl} name={d.name ?? handle} size={28} />
      <div className="min-w-0">
        <Link href={href} scroll={false} className="font-medium hover:text-accent hover:underline">{d.name ?? handle}</Link>
        <div className="text-xs text-ink-3">
          @{handle}{platform !== 'TikTok' && ` · ${platform}`}{d.kl && ` · ${d.kl}`}
          {!kocId && <span className="ml-1 pill bg-sunken text-ink-2" title="KOC ngoài Danh bạ: lấy từ DWH của Tech">Ngoài Danh bạ</span>}
        </div>
        {d.kwHits?.length ? <div className="text-[11px] text-accent" title="Video / sản phẩm của creator có từ khoá của đợt">Khớp: {d.kwHits.slice(0, 3).join(', ')}</div> : null}
      </div>
    </div>
  );
}

export const metricCells = (m: Metrics | null | undefined) => [fmtShort(m?.followers), fmtShort(m?.medianViews), fmtShort(m?.gmv)];
export const channelUrl = (platform: string, handle: string) =>
  platform === 'TikTok' ? `https://www.tiktok.com/@${handle}` : platform === 'Threads' ? `https://www.threads.net/@${handle}` : platform === 'Instagram' ? `https://www.instagram.com/${handle}` : null;
