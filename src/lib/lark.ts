// Lark OAuth (luồng authen/v1 giống repo b2c cũ, đã chạy được với tenant UpBase).
const domain = () => process.env.LARK_DOMAIN || 'open.larksuite.com';

export const larkConfigured = () => Boolean(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);

export const larkAuthUrl = (redirectUri: string, state: string) =>
  `https://${domain()}/open-apis/authen/v1/index?app_id=${process.env.LARK_APP_ID}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

async function larkPost(path: string, body: object, token?: string) {
  const res = await fetch(`https://${domain()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`Lark ${path} [${json.code}] ${json.msg}`);
  return json;
}

export interface LarkUser {
  user_id?: string; // cần quyền "Obtain user ID" trên Lark app
  open_id: string;
  name: string;
  email?: string;
  enterprise_email?: string;
  avatar_url?: string;
  tenant_key?: string;
}

export async function exchangeCode(code: string): Promise<LarkUser> {
  const { app_access_token } = await larkPost('/open-apis/auth/v3/app_access_token/internal', {
    app_id: process.env.LARK_APP_ID,
    app_secret: process.env.LARK_APP_SECRET,
  });
  const { data } = await larkPost('/open-apis/authen/v1/access_token', { grant_type: 'authorization_code', code }, app_access_token);
  return data;
}
