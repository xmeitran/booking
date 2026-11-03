import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role } from '@prisma/client';
import { db } from './db';
import type { NextRequest, NextResponse } from 'next/server';
import { signToken, verifyToken } from './token';

export const SESSION_COOKIE = 'bh_session';
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export const ROLE_LABEL: Record<Role, string> = { ADMIN: 'Admin', LEADER: 'Leader', STAFF: 'Nhân viên' };

/** User đang đăng nhập (đọc DB mỗi request nên khóa / đổi role có hiệu lực ngay). */
export const getCurrentUser = cache(async () => {
  const uid = verifyToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!uid) return null;
  const user = await db.user.findUnique({ where: { id: uid } });
  return user?.active ? user : null;
});

/** Dùng ở đầu mỗi page và server action. Không đủ quyền thì đá về trang chủ. */
export async function requireUser(...roles: Role[]) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (roles.length && !roles.includes(user.role)) redirect('/');
  return user;
}

export function setSessionCookie(res: NextResponse, uid: string, secure: boolean) {
  res.cookies.set(SESSION_COOKIE, signToken(uid, SESSION_TTL_MS), { httpOnly: true, sameSite: 'lax', secure, maxAge: SESSION_TTL_MS / 1000, path: '/' });
}

/** Tìm user theo Lark ID. Chưa có mà ID nằm trong ADMIN_LARK_IDS thì tạo Admin (khởi tạo hệ thống lần đầu). */
export async function findLoginUser(larkIds: string[]) {
  const user = await db.user.findFirst({ where: { larkUserId: { in: larkIds } } });
  if (user) return user;
  const admins = (process.env.ADMIN_LARK_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const adminId = larkIds.find((id) => admins.includes(id));
  return adminId ? db.user.create({ data: { larkUserId: adminId, role: 'ADMIN' } }) : null;
}

/** URL tuyệt đối theo host người dùng đang truy cập. Sau proxy (Render) req.url là localhost:PORT nên phải đọc header. */
export function absUrl(path: string, req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? req.nextUrl.protocol.replace(':', '');
  return new URL(path, host ? `${proto}://${host}` : req.url);
}
