import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { larkAuthUrl, larkConfigured } from '@/lib/lark';

export async function GET(req: NextRequest) {
  if (!larkConfigured()) return NextResponse.redirect(new URL('/login?error=not_configured', req.url));
  const state = randomBytes(24).toString('base64url');
  const redirectUri = new URL('/api/auth/lark/callback', req.url).toString();
  const res = NextResponse.redirect(larkAuthUrl(redirectUri, state));
  res.cookies.set('lark_state', state, { httpOnly: true, sameSite: 'lax', secure: req.nextUrl.protocol === 'https:', maxAge: 600, path: '/' });
  return res;
}
