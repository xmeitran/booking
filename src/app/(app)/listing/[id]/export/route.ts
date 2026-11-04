import { NextRequest } from 'next/server';
import { fmtPct } from '@/lib/format';
import { csvResponse } from '@/lib/csv';
import { COLS, loadListing } from '@/lib/listing';
import { requireUser } from '@/lib/session';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const data = await loadListing(id);
  if (!data) return new Response('Không có đợt listing này', { status: 404 });
  const forBrand = req.nextUrl.searchParams.get('mode') === 'brand';
  const cols = COLS.filter((c) => !(forBrand && c.personal) && !(c.bank && me.role === 'STAFF'));
  const { batch, rows } = data;
  const fixed: Record<string, string | null> = { 'Đợt listing': batch.name, Store: batch.store, 'Sản phẩm': batch.product, CR: batch.cr == null ? '' : fmtPct(batch.cr) };

  return csvResponse(`${batch.name}${forBrand ? ' - gui Brand' : ' - noi bo'}.csv`, cols.map((c) => c.h), rows.map((r) => cols.map((c) => (c.h in fixed ? fixed[c.h] : c.v(r)))));
}
