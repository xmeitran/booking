'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { refreshKoc } from '@/lib/creatorStats';
import { db } from '@/lib/db';
import { str } from '@/lib/form';
import { requireUser } from '@/lib/session';
import { TIKTOK_USERNAME } from '@/lib/validate';

/** Tra TikTok Shop Creator Marketplace ngay cho một creator; creator chưa có trong Danh bạ thì thêm vào (bấm nút ghi rõ). */
export async function lookupTikTok(fd: FormData) {
  await requireUser();
  const handle = str(fd, 'handle').toLowerCase();
  if (!TIKTOK_USERNAME.test(handle)) redirect('/data?notfound=1');
  const koc = await db.koc.upsert({
    where: { platform_handle: { platform: 'TikTok', handle } },
    create: { platform: 'TikTok', handle, name: handle, channelUrl: `https://www.tiktok.com/@${handle}` },
    update: {},
  });
  let r: string;
  try {
    r = await refreshKoc(koc.id);
  } catch {
    r = 'failed';
  }
  revalidatePath(`/creator/${handle}`);
  redirect(`/creator/${handle}?tiktok=${r}`);
}
