'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { db } from '@/lib/db';
import { isUniqueError, str } from '@/lib/form';
import { requireUser } from '@/lib/session';

export async function saveUser(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser('ADMIN');
  const id = str(fd, 'id');
  const name = str(fd, 'name') || null;
  const larkUserId = str(fd, 'larkUserId');
  const role = str(fd, 'role') as Role;
  if (!larkUserId) return 'Nhập Lark User ID.';
  if (!Object.values(Role).includes(role)) return 'Vai trò không hợp lệ.';

  // Admin không tự đổi ID / quyền / khóa chính mình để tránh mất quyền truy cập.
  const data = id === me.id ? { name } : { name, larkUserId, role, active: !id || fd.get('active') === 'on' };
  try {
    if (id) await db.user.update({ where: { id }, data });
    else await db.user.create({ data: { ...data, larkUserId, role } });
  } catch (e) {
    if (isUniqueError(e)) return 'Lark User ID này đã có trong danh sách.';
    throw e;
  }
  revalidatePath('/users');
  redirect('/users');
}
