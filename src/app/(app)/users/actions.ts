'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { db } from '@/lib/db';
import { isUniqueError, str } from '@/lib/form';
import { syncUsersFromLark } from '@/lib/larkSync';
import { requireUser } from '@/lib/session';

export async function saveUser(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser('ADMIN');
  const id = str(fd, 'id');
  const larkUserId = str(fd, 'larkUserId');
  const role = str(fd, 'role') as Role;
  if (!larkUserId) return 'Nhập Lark User ID.';
  if (!Object.values(Role).includes(role)) return 'Vai trò không hợp lệ.';
  // Admin không tự đổi ID / quyền / khóa chính mình để tránh mất quyền truy cập.
  if (id === me.id) redirect('/users');

  let user;
  try {
    user = id
      ? await db.user.update({ where: { id }, data: { larkUserId, role, active: fd.get('active') === 'on' } })
      : await db.user.create({ data: { larkUserId, role } });
  } catch (e) {
    if (isUniqueError(e)) return 'Lark User ID này đã có trong danh sách.';
    throw e;
  }
  // Lấy tên, phòng ban, avatar ngay; thiếu quyền Lark thì để nút Đồng bộ Lark báo lỗi.
  await syncUsersFromLark([user]).catch(() => {});
  revalidatePath('/users');
  redirect('/users');
}

export async function syncLark() {
  await requireUser('ADMIN');
  const users = await db.user.findMany({ select: { id: true, larkUserId: true } });
  let query: string;
  try {
    const missing = await syncUsersFromLark(users);
    query = new URLSearchParams({ synced: String(users.length - missing.length), ...(missing.length && { missing: missing.join(',') }) }).toString();
  } catch (e) {
    query = new URLSearchParams({ sync_error: e instanceof Error ? e.message : 'Lỗi không xác định' }).toString();
  }
  revalidatePath('/users');
  redirect(`/users?${query}`);
}
