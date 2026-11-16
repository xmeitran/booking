import crypto from 'node:crypto';

// Cookie phiên: <base64url(payload)>.<hmac>. Chỉ chứa id user; quyền đọc lại từ DB mỗi request.
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('Thiếu AUTH_SECRET trong .env');
  return s;
}

const hmac = (data: string) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

export function signToken(uid: string, ttlMs: number, now = Date.now()): string {
  const data = Buffer.from(JSON.stringify({ uid, exp: now + ttlMs })).toString('base64url');
  return `${data}.${hmac(data)}`;
}

export function verifyToken(token: string | undefined, now = Date.now()): string | null {
  const [data, sig] = token?.split('.') ?? [];
  if (!data || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(hmac(data));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return typeof uid === 'string' && typeof exp === 'number' && now < exp ? uid : null;
  } catch {
    return null;
  }
}
