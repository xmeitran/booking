import { NextRequest } from 'next/server';
import { csvResponse } from '@/lib/csv';
import { db } from '@/lib/db';
import { kocTable } from '@/lib/kocExport';
import { requireUser } from '@/lib/session';
import { kocWhere } from '../filters';

// Tải Excel Danh bạ theo đúng bộ lọc đang xem.
export async function GET(req: NextRequest) {
  const me = await requireUser();
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const kocs = await db.koc.findMany({ where: kocWhere(sp), include: { pic: { select: { name: true } } }, orderBy: { followers: { sort: 'desc', nulls: 'last' } } });
  const { header, rows } = kocTable(kocs, me.role !== 'STAFF');
  return csvResponse(`Danh ba KOC ${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' })}.csv`, header, rows);
}
