'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { isUniqueError, optInt, str } from '@/lib/form';
import { refreshKoc } from '@/lib/creatorStats';
import { requireUser } from '@/lib/session';
import { KL_LEVELS, PLATFORMS } from './platforms';

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
    kl: KL_LEVELS.includes(str(fd, 'kl')) ? str(fd, 'kl') : null,
    receiverName: str(fd, 'receiverName') || null,
    receiverPhone: str(fd, 'receiverPhone') || null,
    address: str(fd, 'address') || null,
    bankHolder: str(fd, 'bankHolder') || null,
    bankAccount: str(fd, 'bankAccount') || null,
    bankName: str(fd, 'bankName') || null,
    idNumber: str(fd, 'idNumber') || null,
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

export async function refreshFromTikTok(fd: FormData) {
  await requireUser();
  const id = str(fd, 'id');
  let r: string;
  try {
    r = await refreshKoc(id);
  } catch {
    r = 'failed';
  }
  revalidatePath(`/contacts/${id}`);
  redirect(`/contacts/${id}?tiktok=${r}`);
}

// Nhật ký chăm sóc: mọi vai trò được ghi. Form dùng action trực tiếp nên React tự xoá ô nhập sau khi lưu.
export async function addNote(fd: FormData) {
  const me = await requireUser();
  const kocId = str(fd, 'kocId');
  const body = str(fd, 'body');
  const follow = str(fd, 'followUpAt');
  if (!kocId || !body) return;
  await db.kocNote.create({
    data: { kocId, authorId: me.id, body, followUpAt: /^\d{4}-\d{2}-\d{2}$/.test(follow) ? new Date(`${follow}T09:00:00+07:00`) : null },
  });
  revalidatePath(`/contacts/${kocId}`);
}

export async function closeFollowUp(fd: FormData) {
  await requireUser();
  const n = await db.kocNote.update({ where: { id: str(fd, 'id') }, data: { doneAt: new Date() } });
  revalidatePath(`/contacts/${n.kocId}`);
}
