'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { isUniqueError, optInt, str } from '@/lib/form';
import { refreshKoc } from '@/lib/creatorStats';
import { parseHandle } from '@/lib/listing';
import { requireUser } from '@/lib/session';
import { bankAccount, idNumber, phoneVN } from '@/lib/validate';
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
  const rawHandle = str(fd, 'handle');
  // TikTok: nhận cả link kênh, chỉ chấp nhận username hợp lệ để khớp booking và tra được TikTok Shop.
  const handle = platform === 'TikTok' ? parseHandle(rawHandle) ?? '' : rawHandle.replace(/^@/, '').toLowerCase();
  const name = str(fd, 'name');
  const channelUrl = str(fd, 'channelUrl') || null;
  const followers = optInt(fd, 'followers');
  const rateCard = optInt(fd, 'rateCard');

  if (!PLATFORMS.includes(platform)) return 'Nền tảng không hợp lệ.';
  if (platform === 'TikTok' && rawHandle && !handle) return 'ID kênh TikTok chỉ gồm chữ thường không dấu, số, dấu chấm, gạch dưới (2–24 ký tự), hoặc dán link kênh.';
  if (!handle || !name) return 'Nhập ID kênh và tên kênh.';
  if (channelUrl && !/^https?:\/\//i.test(channelUrl)) return 'Link kênh phải bắt đầu bằng http(s)://';
  if (Number.isNaN(followers) || Number.isNaN(rateCard)) return 'Follower và giá phải là số nguyên ≥ 0.';

  const phone = phoneVN(str(fd, 'phone'));
  const receiverPhone = phoneVN(str(fd, 'receiverPhone'));
  const account = bankAccount(str(fd, 'bankAccount'));
  const idNo = idNumber(str(fd, 'idNumber'));
  if (phone === undefined || receiverPhone === undefined) return 'SĐT phải là số Việt Nam 10 số (0xxxxxxxxx hoặc +84…).';
  if (account === undefined) return 'Số tài khoản chỉ gồm 6–19 chữ số.';
  if (idNo === undefined) return 'CCCD 12 số, CMND 9 số hoặc MST 10 / 13 số.';

  if (fd.get('blacklisted') === 'on' && !str(fd, 'blacklistReason')) return 'Ghi lý do đưa KOC vào blacklist.';

  const picId = str(fd, 'picId') || null;
  const data = {
    platform, handle, name, channelUrl, followers, rateCard,
    niche: str(fd, 'niche') || null,
    phone,
    zalo: str(fd, 'zalo') || null,
    email: str(fd, 'email') || null,
    note: str(fd, 'note') || null,
    tags: [...new Set(str(fd, 'tags').split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 20),
    blacklisted: fd.get('blacklisted') === 'on',
    blacklistReason: fd.get('blacklisted') === 'on' ? str(fd, 'blacklistReason') || null : null,
    picId,
    kl: KL_LEVELS.includes(str(fd, 'kl')) ? str(fd, 'kl') : null,
    receiverName: str(fd, 'receiverName') || null,
    receiverPhone,
    address: str(fd, 'address') || null,
    bankHolder: str(fd, 'bankHolder') || null,
    bankAccount: account,
    bankName: str(fd, 'bankName') || null,
    idNumber: idNo,
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
