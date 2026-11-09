import { NextRequest } from 'next/server';
import { csvResponse } from '@/lib/csv';
import { db } from '@/lib/db';
import { kocTable } from '@/lib/kocExport';
import { directory } from '@/lib/kocDirectory';
import { dupKey } from '@/lib/listing';
import { can, requirePerm } from '@/lib/session';
import { boHandles, loadDirectory } from '../directory';

// Tải Excel Danh bạ theo đúng bảng và bộ lọc đang xem (cùng logic lọc với trang).
export async function GET(req: NextRequest) {
  const me = await requirePerm('data.export');
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const [all, bo] = await Promise.all([loadDirectory(), boHandles(sp.q ?? '')]);
  const ids = directory(all, sp, dupKey, bo).rows.map((k) => k.id);
  const order = new Map(ids.map((id, i) => [id, i]));
  const kocs = (await db.koc.findMany({ where: { id: { in: ids } }, include: { pic: { select: { name: true } } } })).sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const { header, rows } = kocTable(kocs, can(me, 'koc.bank'));
  return csvResponse(`Danh ba KOC ${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })}.csv`, header, rows);
}
