import { NextRequest, NextResponse } from 'next/server';
import { absUrl, SESSION_COOKIE } from '@/lib/session';

export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(absUrl('/login', req), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
