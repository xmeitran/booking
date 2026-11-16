// Lark OAuth (luồng authen/v1 giống repo b2c cũ, đã chạy được với tenant UpBase).
const domain = () => process.env.LARK_DOMAIN || 'open.larksuite.com';

export const larkConfigured = () => Boolean(process.env.LARK_APP_ID && process.env.LARK_APP_SECRET);

export const larkAuthUrl = (redirectUri: string, state: string) =>
  `https://${domain()}/open-apis/authen/v1/index?app_id=${process.env.LARK_APP_ID}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

/** Gọi Lark, thử lại khi mạng lỗi (Lark đôi khi cắt kết nối giữa chừng: "terminated"). Lỗi nghiệp vụ (code ≠ 0) thì ném luôn. */
async function call(path: string, init: RequestInit) {
  for (let attempt = 1; ; attempt++) {
    let json;
    try {
      json = await (await fetch(`https://${domain()}${path}`, { ...init, cache: 'no-store' })).json();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    if (json.code !== 0) throw new Error(`Lark [${json.code}] ${json.msg}`);
    return json;
  }
}

export const larkPost = (path: string, body: object, token?: string) =>
  call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body),
  });

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

// ---- API dùng tenant token: danh bạ (contact:*) và Lark Base (bitable:*), quyền xem README.

export async function tenantToken(): Promise<string> {
  const { tenant_access_token } = await larkPost('/open-apis/auth/v3/tenant_access_token/internal', {
    app_id: process.env.LARK_APP_ID,
    app_secret: process.env.LARK_APP_SECRET,
  });
  return tenant_access_token;
}

export const larkGet = async (path: string, token: string) => (await call(path, { headers: { Authorization: `Bearer ${token}` } })).data;

/** Gọi API batch của Lark theo lô 50 id (giới hạn của Lark). */
async function batchGet<T>(path: string, key: string, ids: string[], extra: string, token: string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const q = ids.slice(i, i + 50).map((id) => `${key}=${encodeURIComponent(id)}`).join('&');
    out.push(...((await larkGet(`${path}?${q}&${extra}`, token)).items ?? []));
  }
  return out;
}

interface LarkContactUser {
  user_id?: string;
  open_id?: string;
  name?: string;
  email?: string;
  enterprise_email?: string;
  avatar?: { avatar_240?: string; avatar_origin?: string };
  department_ids?: string[];
  job_title?: string;
}

export interface LarkProfile {
  name?: string;
  email?: string;
  avatarUrl?: string;
  department?: string;
  jobTitle?: string;
}

/** Tra danh bạ Lark theo user_id hoặc open_id (ou_...). Id không có trên Lark thì không có trong Map. */
export async function fetchLarkProfiles(ids: string[]): Promise<Map<string, LarkProfile>> {
  const token = await tenantToken();
  const users: LarkContactUser[] = [];
  for (const type of ['open_id', 'user_id'] as const) {
    const group = ids.filter((id) => id.startsWith('ou_') === (type === 'open_id'));
    users.push(...(await batchGet<LarkContactUser>('/open-apis/contact/v3/users/batch', 'user_ids', group, `user_id_type=${type}&department_id_type=open_department_id`, token)));
  }

  const deptIds = [...new Set(users.flatMap((u) => u.department_ids ?? []))].filter((d) => d !== '0'); // "0" = gốc tổ chức
  const depts = await batchGet<{ open_department_id: string; name: string }>('/open-apis/contact/v3/departments/batch', 'department_ids', deptIds, 'department_id_type=open_department_id', token);
  const deptName = new Map(depts.map((d) => [d.open_department_id, d.name]));

  const out = new Map<string, LarkProfile>();
  for (const u of users) {
    const department = (u.department_ids ?? []).map((d) => deptName.get(d)).filter(Boolean).join(', ');
    const profile: LarkProfile = {
      name: u.name || undefined,
      email: u.enterprise_email || u.email || undefined,
      avatarUrl: u.avatar?.avatar_240 || u.avatar?.avatar_origin || undefined,
      department: department || undefined,
      jobTitle: u.job_title || undefined,
    };
    for (const id of [u.open_id, u.user_id]) if (id) out.set(id, profile);
  }
  return out;
}
