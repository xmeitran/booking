import { csvResponse } from '@/lib/csv';
import { db } from '@/lib/db';
import type { Finding, ScoreResult } from '@/lib/matching/engine';
import { KO, koLabel, STAGE_ORDER, STAGES, type Declare, type Stage } from '@/lib/matching/spec';
import { requirePerm } from '@/lib/auth/session';
import type { CandData } from '../../parts';

// Bước 9: list KOC kèm điểm 6 nhóm, mức kết luận, lý do chính. Mặc định chỉ KOC B2C đã duyệt (list gửi brand); ?all=1 = mọi KOC
// của đợt, xếp như trên trang (trạng thái đi xa nhất trước, rồi điểm), kèm lý do không qua. Không xuất K15 (tác phong nội bộ)
// và không xuất thông tin liên hệ / thanh toán.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePerm('data.export');
  const { id } = await params;
  const all = new URL(req.url).searchParams.get('all') === '1';
  const b = await db.matchBrief.findUnique({ where: { id } });
  if (!b) return new Response('Không có đợt này', { status: 404 });
  const rows = (await db.matchCandidate.findMany({
    where: { briefId: id, ...(all ? {} : { stage: 'APPROVED' }) },
    orderBy: [{ total: { sort: 'desc', nulls: 'last' } }, { handle: 'asc' }],
  })).sort((x, y) => STAGE_ORDER.indexOf(x.stage as Stage) - STAGE_ORDER.indexOf(y.stage as Stage)); // sort ổn định: giữ thứ tự điểm trong cùng trạng thái
  const group = (s: ScoreResult | null, g: string) => s?.groups.find((x) => x.group === g)?.score ?? '';
  const header = [
    'KOC', 'ID kênh', 'Nền tảng', 'Link kênh', 'KL', 'Nguồn số liệu', 'Follower', 'View trung vị', 'ER (%)', 'GMV 30 ngày', 'Giá báo / tham chiếu', 'CPV',
    '0. Yêu cầu riêng brand', 'A. Fit thương hiệu & tệp', 'B. Reach & tương tác', 'C. Chuyển đổi', 'D. Chất lượng nội dung', 'E. Hợp tác, chi phí & lịch sử',
    'Tổng điểm', 'Độ phủ số liệu (%)', 'Mức kết luận', 'Hành động đề xuất', 'Điểm mạnh', 'Điểm yếu', 'Trạng thái', 'Lý do không qua', 'Cảnh báo',
  ];
  const out = rows.map((c) => {
    const d = (c.data ?? {}) as CandData;
    const m = d.metrics;
    const s = (c.score ?? null) as ScoreResult | null;
    const price = ((c.declare ?? {}) as Declare).quote ?? d.price ?? null;
    const pub = (f: Finding) => !(f.code in KO && 'internal' in KO[f.code as keyof typeof KO]);
    const flags = ((c.flags ?? []) as Finding[]).filter((f) => pub(f) && f.code !== 'POOL');
    const why = c.stage === 'REJECTED' ? (c.rejectCode === 'K15' ? 'Đã loại' : `${c.rejectCode ? koLabel(c.rejectCode) : ''}${c.reason ? `: ${c.reason}` : ''}`)
      : c.stage === 'KO' ? ((c.knockouts ?? []) as Finding[]).filter(pub).map((f) => `${koLabel(f.code)}: ${f.detail}`).join(' | ') || 'Loại theo quy tắc nội bộ'
      : c.stage === 'OUT' ? ((c.flags ?? []) as Finding[]).filter((f) => f.code === 'POOL').map((f) => f.detail).join(' | ') : '';
    return [
      d.name ?? c.handle, c.handle, c.platform, c.platform === 'TikTok' ? `https://www.tiktok.com/@${c.handle}` : '', d.kl ?? '', m?.source ?? '',
      m?.followers ?? '', m?.medianViews ?? '', m?.er == null ? '' : Math.round(m.er * 1000) / 10, m?.gmv ?? '', price ?? '',
      price && m?.medianViews ? Math.round((price / m.medianViews) * 10) / 10 : '',
      ...['G0', 'A', 'B', 'C', 'D', 'E'].map((g) => group(s, g)),
      s?.total ?? '', s ? Math.round(s.coverage * 100) : '', s?.tier ?? '', s?.action ?? '', s?.strengths.join('; ') ?? '', s?.weaknesses.join('; ') ?? '',
      STAGES[c.stage as Stage] ?? c.stage, why, flags.map((f) => `${f.code}: ${f.detail}`).join(' | '),
    ];
  });
  return csvResponse(`${b.name} - list KOC${all ? ' (tất cả)' : ''}.csv`, header, out);
}
