import { NextResponse } from 'next/server';
import { syncBookings } from '@/lib/bookingSync';
import { db } from '@/lib/db';

// Gọi mỗi giờ từ GitHub Actions (.github/workflows/sync-bookings.yml).
// Không cần khoá bí mật: 10 phút chỉ chạy được 1 lần nên ai gọi bừa cũng không gây tải cho Lark.
const MIN_GAP_MS = 10 * 60 * 1000;

export async function POST() {
  await db.syncState.createMany({ data: [{ id: 'bookings' }], skipDuplicates: true });
  const { count } = await db.syncState.updateMany({
    where: { id: 'bookings', OR: [{ startedAt: null }, { startedAt: { lt: new Date(Date.now() - MIN_GAP_MS) } }] },
    data: { startedAt: new Date(), finishedAt: null },
  });
  if (!count) return NextResponse.json({ skipped: 'Vừa đồng bộ hoặc đang chạy, thử lại sau 10 phút.' }, { status: 429 });

  let message: string;
  try {
    const r = await syncBookings();
    message = `${r.total} booking · ${r.created} mới · ${r.updated} cập nhật · ${r.removed} xoá · ${r.kocs} KOL mới`;
  } catch (e) {
    console.error('[sync-bookings]', e);
    message = `Lỗi: ${e instanceof Error ? e.message : String(e)}`;
  }
  await db.syncState.update({ where: { id: 'bookings' }, data: { finishedAt: new Date(), message } });
  return NextResponse.json({ message }, { status: message.startsWith('Lỗi') ? 500 : 200 });
}
