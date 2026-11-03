'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { isUniqueError, optInt, str } from '@/lib/form';
import { requireUser } from '@/lib/session';
import { PLATFORMS } from './platforms';

// ret chỉ là query string (?q=...) nối sau path cố định, không mở redirect ra ngoài.
const back = (fd: FormData) => {
  const ret = str(fd, 'ret');
  revalidatePath('/contacts');
  redirect('/contacts' + (ret.startsWith('?') ? ret : ''));
};

export async function saveKoc(_: string | null, fd: FormData): Promise<string | null> {
  await requireUser('ADMIN', 'LEADER');
  const id = str(fd, 'id');
  const platform = str(fd, 'platform');
  const handle = str(fd, 'handle').replace(/^@/, '').toLowerCase();
  const name = str(fd, 'name');
  const channelUrl = str(fd, 'channelUrl') || null;
  const followers = optInt(fd, 'followers');
  const rateCard = optInt(fd, 'rateCard');

  if (!PLATFORMS.includes(platform)) return 'Nền tảng không hợp lệ.';
  if (!handle || !name) return 'Nhập ID kênh và tên kênh.';
  if (channelUrl && !/^https?:\/\//i.test(channelUrl)) return 'Link kênh phải bắt đầu bằng http(s)://';
  if (Number.isNaN(followers) || Number.isNaN(rateCard)) return 'Follower và giá phải là số nguyên ≥ 0.';

  const picId = str(fd, 'picId') || null;
  const data = {
    platform, handle, name, channelUrl, followers, rateCard,
    niche: str(fd, 'niche') || null,
    phone: str(fd, 'phone') || null,
    zalo: str(fd, 'zalo') || null,
    email: str(fd, 'email') || null,
    note: str(fd, 'note') || null,
    picId,
  };
  try {
    if (id) await db.koc.update({ where: { id }, data });
    else await db.koc.create({ data });
  } catch (e) {
    if (isUniqueError(e)) return `Kênh @${handle} trên ${platform} đã có trong danh bạ.`;
    throw e;
  }
  back(fd);
  return null;
}

export async function deleteKoc(fd: FormData) {
  await requireUser('ADMIN', 'LEADER');
  await db.koc.delete({ where: { id: str(fd, 'id') } });
  back(fd);
}
