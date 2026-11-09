import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role, User } from '@prisma/client';
import { deptAllowed, permsOf, readPolicy, type Perm } from './access';
import { db } from './db';
import { fetchLarkProfiles } from './lark';
import type { NextRequest, NextResponse } from 'next/server';
import { signToken, verifyToken } from './token';

export const SESSION_COOKIE = 'bh_session';
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Admin', LEADER: 'Leader', STAFF: 'Nhân viên' };

export type Me = User & { perms: Set<Perm> };

/** User đang đăng nhập kèm quyền theo ma trận (đọc DB mỗi request nên khóa / đổi quyền có hiệu lực ngay). */
export const getCurrentUser = cache(async (): Promise<Me | null> => {
  const uid = verifyToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  const [user, policy] = await Promise.all([db.user.findUnique({ where: { id: uid } }), readPolicy()]);
  return user?.active ? { ...user, perms: permsOf(user.role, policy) } : null;
});

export const can = (me: Me, perm: Perm) => me.perms.has(perm);

/** Dùng ở đầu mỗi page và server action. Không đủ quyền thì đá về trang chủ. */
export async function requireUser(...roles: Role[]) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (roles.length && !roles.includes(user.role)) redirect('/');
  return user;
}

/** Như requireUser nhưng theo quyền trong ma trận (/users/roles). */
export async function requirePerm(perm: Perm) {
  const user = await requireUser();
  if (!can(user, perm)) redirect('/');
  return user;
}

export function setSessionCookie(res: NextResponse, uid: string, secure: boolean) {
  res.cookies.set(SESSION_COOKIE, signToken(uid, SESSION_TTL_MS), { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_TTL_MS / 1000, path: '/' });
}

/**
 * Tìm user theo Lark ID. Chưa có thì:
 * - ID nằm trong ADMIN_LARK_IDS → tạo Admin (khởi tạo hệ thống lần đầu);
 * - thuộc phòng ban Lark được phép ở Cổng đăng nhập (/users) → tạo Nhân viên. User đã bị khoá thì không mở lại.
 */
export async function findLoginUser(larkIds: string[]) {
  const user = await db.user.findFirst({ where: { larkUserId: { in: larkIds } } });
  if (user) return user;
  const admins = (process.env.ADMIN_LARK_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const adminId = larkIds.find((id) => admins.includes(id));
  if (adminId) return db.user.create({ data: { larkUserId: adminId, role: 'ADMIN' } });

  const { loginDepts } = await readPolicy();
  if (!loginDepts.length) return null;
  const larkUserId = larkIds.find((id) => id.startsWith('ou_')) ?? larkIds[0]; // open_id, như user đồng bộ từ Lark Base
  const profile = await fetchLarkProfiles([larkUserId]).then((m) => m.get(larkUserId)).catch((e) => console.warn('[login dept]', e.message));
  if (!profile || !deptAllowed(profile.department, loginDepts)) return null;
  // Người này có thể đã được thêm bằng ID khác (User ID): nhận theo email Lark, không tạo trùng.
  const same = profile.email ? await db.user.findFirst({ where: { email: { equals: profile.email, mode: 'insensitive' } } }) : null;
  return same ?? db.user.create({ data: { larkUserId, role: 'STAFF', ...profile } });
}

/** URL tuyệt đối theo host người dùng đang truy cập. Sau proxy (Render) req.url là localhost:PORT nên phải đọc header. */
export function absUrl(path: string, req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? req.nextUrl.protocol.replace(':', '');
  return new URL(path, host ? `${proto}://${host}` : req.url);
}
