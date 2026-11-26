// Mảnh giao diện dùng chung của Creator matching (server component, không state).
import Link from 'next/link';
import { Avatar } from '@/components/ui';
import { fmtShort } from '@/lib/format';
import type { Finding, Metrics, ScoreResult } from '@/lib/matching/engine';
import { GROUP_LABEL, KO, koLabel, STAGES, STAGE_TONE, STEPS, type Group, type Stage } from '@/lib/matching/spec';

/** Bước đang làm của đợt, để mở đúng tab. */
export function currentStep(b: { ranAt: Date | null }, n: Partial<Record<Stage, number>>) {
  if (!b.ranAt) return 1;
  if (n.APPROVED) return 9;
  if (n.CONFIRMED) return 8;
  if (n.SHORTLIST) return 6;
  if (n.POOL) return 4;
  return 2;
}

export function Stepper({ briefId, step, counts }: { briefId: string; step: number; counts: Partial<Record<number, number>> }) {
  return (
    <nav aria-label="Các bước" className="mb-4 overflow-x-auto">
      <ol className="flex min-w-max gap-1">
        {STEPS.map((s) => (
          <li key={s.n}>
            <Link
              href={`/matching/${briefId}?step=${s.n}`}
              aria-current={s.n === step ? 'step' : undefined}
              title={s.hint}
              className={`flex h-full flex-col rounded-md border px-2.5 py-1.5 text-xs ${s.n === step ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-ink-2 hover:border-accent'}`}
            >
              <span className="font-semibold">{s.n}. {s.title}</span>
              <span className="text-ink-3">{counts[s.n] != null ? `${counts[s.n]!.toLocaleString('vi-VN')} KOC` : ' '}</span>
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export const StageChip = ({ stage }: { stage: string }) => <span className={`pill ${STAGE_TONE[stage as Stage] ?? 'bg-sunken text-ink-2'}`}>{STAGES[stage as Stage] ?? stage}</span>;

export function TierChip({ score }: { score: ScoreResult | null }) {
  if (!score) return <span className="text-xs text-ink-3">—</span>;
  return <span className={`pill ${score.tone}`} title={score.action}>{score.tier}</span>;
}

/** Tổng điểm + độ phủ số liệu. */
export function Total({ score }: { score: ScoreResult | null }) {
  if (!score || score.total == null) return <span className="text-ink-3">—</span>;
  return (
    <span className="tabular-nums" title={`Độ phủ số liệu ${Math.round(score.coverage * 100)}% trọng số`}>
      <b>{score.total.toFixed(1).replace('.', ',')}</b>
      <span className="ml-1 text-[11px] text-ink-3">{Math.round(score.coverage * 100)}%</span>
    </span>
  );
}

/** Điểm 1–5 của 6 nhóm, ô trống = chưa có số liệu. */
export function GroupCells({ score }: { score: ScoreResult | null }) {
  const by = new Map((score?.groups ?? []).map((g) => [g.group, g.score]));
  return (
    <>
      {(['G0', 'A', 'B', 'C', 'D', 'E'] as Group[]).map((g) => {
        const v = by.get(g);
        return <td key={g} className={`text-center tabular-nums ${v == null ? 'text-ink-3' : v >= 4 ? 'text-positive' : v < 2.5 ? 'text-critical' : ''}`} title={GROUP_LABEL[g]}>{v == null ? '·' : v.toFixed(1).replace('.', ',')}</td>;
      })}
    </>
  );
}
export const GROUP_HEADS = (['G0', 'A', 'B', 'C', 'D', 'E'] as Group[]).map((g) => <th key={g} className="text-center" title={GROUP_LABEL[g]}>{g === 'G0' ? '0' : g}</th>);

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
  metrics?: Metrics | null; bookings?: number; ratings?: number;
};

/** Ô KOC: ảnh, tên, ID kênh, KL, nguồn; bấm mở chi tiết ứng viên. */
export function KocCell({ href, handle, platform, d, kocId }: { href: string; handle: string; platform: string; d: CandData; kocId: string | null }) {
  return (
    <div className="flex items-center gap-2">
      <Avatar src={d.avatarUrl} name={d.name ?? handle} size={28} />
      <div className="min-w-0">
        <Link href={href} scroll={false} className="font-medium hover:text-accent hover:underline">{d.name ?? handle}</Link>
        <div className="text-xs text-ink-3">
          @{handle}{platform !== 'TikTok' && ` · ${platform}`}{d.kl && ` · ${d.kl}${d.klSource === 'Suy theo follower' ? '*' : ''}`}{d.niche && ` · ${d.niche}`}
          {!kocId && <span className="ml-1 pill bg-accent-soft text-accent">Kho</span>}
        </div>
      </div>
    </div>
  );
}

export const metricCells = (m: Metrics | null | undefined) => [
  fmtShort(m?.followers), fmtShort(m?.medianViews), m?.er == null ? '—' : `${(m.er * 100).toFixed(1).replace('.', ',')}%`, fmtShort(m?.gmv),
];
export const channelUrl = (platform: string, handle: string) =>
  platform === 'TikTok' ? `https://www.tiktok.com/@${handle}` : platform === 'Threads' ? `https://www.threads.net/@${handle}` : platform === 'Instagram' ? `https://www.instagram.com/${handle}` : null;
