'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { db } from '@/lib/db';
import { isUniqueError, str } from '@/lib/form';
import { fetchLarkProfiles } from '@/lib/lark';
import { JOB_ROLES } from '@/lib/catalog';
import { requireUser } from '@/lib/session';

export async function saveUser(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser('ADMIN');
  const id = str(fd, 'id');
  const larkUserId = str(fd, 'larkUserId');
  const role = str(fd, 'role') as Role;
  if (!larkUserId) return 'Nhập Lark User ID.';
  if (!Object.values(Role).includes(role)) return 'Vai trò không hợp lệ.';
  const jobRole = JOB_ROLES.includes(str(fd, 'jobRole')) ? str(fd, 'jobRole') : null;
  // Admin không tự đổi ID / quyền / khóa chính mình để tránh mất quyền truy cập.
  if (id === me.id) redirect('/users');

  const current = id ? await db.user.findUnique({ where: { id } }) : null;
  let profile = {};
  // Thêm mới hoặc đổi ID: lấy tên, email, avatar, phòng ban từ Lark; ID không có trên Lark thì không lưu.
  if (current?.larkUserId !== larkUserId) {
    let found;
    try {
      found = (await fetchLarkProfiles([larkUserId])).get(larkUserId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      // 99992360: Lark báo ID không hợp lệ / không tồn tại.
      return msg.includes('99992360') ? `Không tìm thấy ${larkUserId} trên Lark.` : `Không lấy được thông tin từ Lark. ${msg}`;
    }
    if (!found) return `Không tìm thấy ${larkUserId} trên Lark.`;
    // Một người có thể được nhập bằng User ID lẫn Open ID: chặn trùng theo email Lark.
    const dup = found.email && (await db.user.findFirst({ where: { email: found.email, ...(current && { NOT: { id: current.id } }) } }));
    if (dup) return `${found.name} đã có trong danh sách (Lark ID ${dup.larkUserId}).`;
    profile = found;
  }

  try {
    if (current) await db.user.update({ where: { id }, data: { larkUserId, role, jobRole, active: fd.get('active') === 'on', ...profile } });
    else await db.user.create({ data: { larkUserId, role, jobRole, ...profile } });
  } catch (e) {
    if (isUniqueError(e)) return 'Lark User ID này đã có trong danh sách.';
    throw e;
  }
  revalidatePath('/users');
  redirect('/users');
}
