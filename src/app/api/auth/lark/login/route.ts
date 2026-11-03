import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { larkAuthUrl, larkConfigured } from '@/lib/lark';
import { absUrl } from '@/lib/session';

export async function GET(req: NextRequest) {
  if (!larkConfigured()) return NextResponse.redirect(absUrl('/login?error=not_configured', req));
  const state = randomBytes(24).toString('base64url');
  const redirectUri = absUrl('/api/auth/lark/callback', req).toString();
  const res = NextResponse.redirect(larkAuthUrl(redirectUri, state));
  res.cookies.set('lark_state', state, { httpOnly: true, sameSite: 'lax', secure: redirectUri.startsWith('https:'), maxAge: 600, path: '/' });
  return res;
}
