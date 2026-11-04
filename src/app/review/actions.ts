'use server';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { str } from '@/lib/form';
import { BRAND_CHOICE } from '@/lib/listing';

// Không đăng nhập: link là quyền. Chỉ ghi Brand chọn + lý do của các dòng thuộc đúng đợt có token này.
export async function submitReview(fd: FormData) {
  const token = str(fd, 'token');
  const batch = token ? await db.listingBatch.findFirst({ where: { shareToken: token }, include: { items: true } }) : null;
  if (!batch) redirect('/review/het-han');
  const changes = batch.items.flatMap((it) => {
    const c = str(fd, `c_${it.id}`);
    const brandChoice = BRAND_CHOICE.includes(c) ? c : null;
    const rejectReason = str(fd, `r_${it.id}`).slice(0, 500) || null;
    return brandChoice === it.brandChoice && rejectReason === it.rejectReason ? [] : [db.listingItem.update({ where: { id: it.id }, data: { brandChoice, rejectReason } })];
  });
  if (changes.length) await db.$transaction(changes);
  redirect(`/review/${encodeURIComponent(token)}?saved=${changes.length}`);
}
