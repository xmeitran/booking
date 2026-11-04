import { csvResponse } from '@/lib/csv';
import { db } from '@/lib/db';
import { kocTable } from '@/lib/kocExport';
import { matchKocs, type Criteria } from '@/lib/matching';
import { requireUser } from '@/lib/session';

// Excel toàn bộ KOC khớp bộ tiêu chí (không giới hạn 200 như trên trang), giữ thứ tự xếp hạng.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const b = await db.matchBrief.findUnique({ where: { id } });
  if (!b) return new Response('Không có brief này', { status: 404 });
  const matches = await matchKocs(b.criteria as Criteria, b.brand);
  const byId = new Map(matches.map((m) => [m.koc.id, m]));
  const rank = new Map(matches.map((m, i) => [m.koc.id, i]));
  const kocs = (await db.koc.findMany({ where: { id: { in: [...byId.keys()] } }, include: { pic: { select: { name: true } } } }))
    .sort((x, y) => rank.get(x.id)! - rank.get(y.id)!);
  const { header, rows } = kocTable(kocs, me.role !== 'STAFF', [
    { h: 'Khớp tiêu chí', v: (k) => { const m = byId.get(k.id)!; return `${m.passed}/${m.checks.length}`; } },
    { h: 'Chưa rõ', v: (k) => byId.get(k.id)!.checks.filter((c) => c.ok === null).map((c) => c.label).join(', ') },
    { h: 'Giá booking gần nhất', v: (k) => byId.get(k.id)!.lastPrice },
    { h: `Đã book ${b.brand ?? 'brand'}`, v: (k) => byId.get(k.id)!.brandBookings || '' },
  ]);
  return csvResponse(`${b.name} - KOC khop.csv`, header, rows);
}
