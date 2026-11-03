import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { exchangeCode } from '@/lib/lark';
import { findLoginUser, setSessionCookie } from '@/lib/session';

const toLogin = (req: NextRequest, error: string) => NextResponse.redirect(new URL(`/login?error=${error}`, req.url));

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  if (!code || !state || state !== req.cookies.get('lark_state')?.value) return toLogin(req, 'state');

  let lark;
  try {
    lark = await exchangeCode(code);
  } catch (e) {
    console.error('[lark callback]', e);
    return toLogin(req, 'lark');
  }
  if (process.env.LARK_TENANT_KEY && lark.tenant_key !== process.env.LARK_TENANT_KEY) return toLogin(req, 'tenant');

  const secure = req.nextUrl.protocol === 'https:';
  const ids = [lark.user_id, lark.open_id].filter((x): x is string => Boolean(x));
  const user = await findLoginUser(ids);

  if (!user || !user.active) {
    const res = toLogin(req, user ? 'disabled' : 'not_allowed');
    // Hiện Lark ID trên trang login để người dùng gửi cho Admin.
    res.cookies.set('lark_info', JSON.stringify({ name: lark.name, userId: lark.user_id ?? null, openId: lark.open_id }), {
      httpOnly: true, sameSite: 'lax', secure, maxAge: 600, path: '/login',
    });
    return res;
  }

  await db.user.update({
    where: { id: user.id },
    data: {
      name: user.name || lark.name,
      email: user.email || lark.enterprise_email || lark.email || null,
      avatarUrl: lark.avatar_url ?? user.avatarUrl,
      lastLoginAt: new Date(),
    },
  });

  const res = NextResponse.redirect(new URL('/', req.url));
  setSessionCookie(res, user.id, secure);
  res.cookies.delete('lark_state');
  return res;
}
