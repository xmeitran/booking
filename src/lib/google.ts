// Google Sheets API bằng service account (G1, G2): ký JWT bằng node:crypto, không cần thư viện googleapis.
import 'server-only';
import { createSign } from 'node:crypto';
import { requireCfg } from './integrations';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** "https://docs.google.com/spreadsheets/d/<id>/edit#gid=0" hoặc id → id. Không hợp lệ → null. */
export const sheetIdOf = (s: string) => s.match(/\/spreadsheets\/d\/([\w-]{20,})/)?.[1] ?? (/^[\w-]{20,}$/.test(s.trim()) ? s.trim() : null);

async function token() {
  const c = await requireCfg('sheets', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');
  const now = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: c.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  // Key dán từ file JSON thường còn "\n" dạng chữ.
  const sig = createSign('RSA-SHA256').update(head).sign(c.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n'), 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${sig}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`Chưa kết nối được Google Sheet, báo Admin kiểm tra cài đặt (${j.error_description ?? j.error ?? res.status}).`);
  return j.access_token as string;
}

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${path}`, {
    ...init, headers: { Authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
  });
  const j = await res.json();
  if (!res.ok) {
    const m = j.error?.message ?? res.status;
    throw new Error(res.status === 403 || res.status === 404 ? 'Không mở được Google Sheet. Nhờ brand chia sẻ sheet (quyền chỉnh sửa) cho email ghi ở khung Google Sheet.' : `Google Sheet báo lỗi: ${m}`);
  }
  return j;
}

type Cell = string | number | null | undefined;

/** Ghi đè cả tab (tạo tab nếu chưa có). Trả link tới sheet. */
export async function writeTab(sheetId: string, tab: string, rows: Cell[][]) {
  const meta = await call(`${sheetId}?fields=sheets.properties.title`);
  if (!meta.sheets.some((s: { properties: { title: string } }) => s.properties.title === tab)) {
    await call(`${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }) });
  }
  const range = encodeURIComponent(`'${tab}'`);
  await call(`${sheetId}/values/${range}:clear`, { method: 'POST', body: '{}' });
  // RAW: không để Google tự hiểu "=..." là công thức (ô do người ngoài nhập đi vòng về app).
  await call(`${sheetId}/values/${range}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: rows.map((r) => r.map((c) => c ?? '')) }) });
}

export async function readTab(sheetId: string, tab: string): Promise<string[][]> {
  return (await call(`${sheetId}/values/${encodeURIComponent(`'${tab}'`)}`)).values ?? [];
}
