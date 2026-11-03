import { NextRequest, NextResponse } from 'next/server';
import { findLoginUser, setSessionCookie } from '@/lib/session';

// Chỉ để test khi chưa cấu hình Lark. Tắt hẳn ngoài `next dev`.
export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') return new NextResponse(null, { status: 404 });
  const id = String((await req.formData()).get('id') ?? '').trim();
  const user = id ? await findLoginUser([id]) : null;
  if (!user?.active) return NextResponse.redirect(new URL('/login?error=not_allowed', req.url), 303);
  const res = NextResponse.redirect(new URL('/', req.url), 303);
  setSessionCookie(res, user.id, false);
  return res;
}
