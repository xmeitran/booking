'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { str } from '@/lib/form';
import { requireUser } from '@/lib/auth/session';
import { TIKTOK_USERNAME } from '@/lib/validate';
import { syncKocStats } from '@/lib/warehouse/creatorSync';

/** Thêm creator vào Danh bạ (từ trang creator); có hồ sơ trong kho thì chép số kho vào luôn. */
export async function addToDanhBa(fd: FormData) {
  await requireUser();
  const handle = str(fd, 'handle').toLowerCase();
  if (!TIKTOK_USERNAME.test(handle)) redirect('/data?notfound=1');
  const w = await db.warehouseCreator.findUnique({ where: { platform_handle: { platform: 'TikTok', handle } }, select: { nickname: true } });
  await db.koc.upsert({
    where: { platform_handle: { platform: 'TikTok', handle } },
    create: { platform: 'TikTok', handle, name: w?.nickname ?? handle, channelUrl: `https://www.tiktok.com/@${handle}` },
    update: {},
  });
  if (w) await syncKocStats();
  revalidatePath(`/creator/${handle}`);
  redirect(`/creator/${handle}?added=1`);
}
