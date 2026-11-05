'use server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { syncBookingsJob } from '@/lib/bookingSync';
import { runOnce } from '@/lib/cronJob';
import { requireUser } from '@/lib/session';

// Đồng bộ Lark Base ngay (chạy sau khi trả trang, ~2–3 phút); cùng khoá với cron nên không chạy chồng.
export async function syncNow() {
  await requireUser();
  after(() => runOnce('bookings', 2, syncBookingsJob));
  revalidatePath('/booking');
}
