import { NextRequest } from 'next/server';
import { fmtPct } from '@/lib/format';
import { COLS, loadListing } from '@/lib/listing';
import { requireUser } from '@/lib/session';

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV (UTF-8 có BOM) mở thẳng bằng Excel; đủ dùng, không cần thư viện xlsx.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const data = await loadListing(id);
  if (!data) return new Response('Không có đợt listing này', { status: 404 });
  const forBrand = req.nextUrl.searchParams.get('mode') === 'brand';
  const cols = COLS.filter((c) => !(forBrand && c.personal) && !(c.bank && me.role === 'STAFF'));
  const { batch, rows } = data;
  const fixed: Record<string, string | null> = { 'Đợt listing': batch.name, Store: batch.store, 'Sản phẩm': batch.product, CR: batch.cr == null ? '' : fmtPct(batch.cr) };

  const lines = [cols.map((c) => cell(c.h)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => cell(c.h in fixed ? fixed[c.h] : c.v(r))).join(','));
  const name = `${batch.name}${forBrand ? ' - gui Brand' : ' - noi bo'}.csv`.replace(/[\\/:*?"<>|]/g, '-');
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="listing.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
