import 'server-only';
import { db } from './db';
import { fetchLarkProfiles } from './lark';

/** Cập nhật tên, email, avatar, phòng ban, chức danh từ Lark. Trả về các Lark ID không tìm thấy. */
export async function syncUsersFromLark(users: { id: string; larkUserId: string }[]): Promise<string[]> {
  const profiles = await fetchLarkProfiles(users.map((u) => u.larkUserId));
  const missing: string[] = [];
  for (const u of users) {
    const p = profiles.get(u.larkUserId);
    if (p) await db.user.update({ where: { id: u.id }, data: p }); // trường undefined (Lark không trả) giữ nguyên
    else missing.push(u.larkUserId);
  }
  return missing;
}
