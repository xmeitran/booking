// Đọc kho dữ liệu UpBase (ClickHouse) qua Metabase của DX: ClickHouse chỉ mở trong VPN, Metabase mở ra internet và chạy được
// SQL native trên database "clickhouse". Cấu hình ở Phân quyền → Tích hợp → Kho dữ liệu. Tên bảng phải ghi kèm database
// (upbase_prod.…, dbt_prod.…); cột mảng / tuple phải đổi sang chuỗi (toJSONString) vì Metabase không trả được.
import { cfg, requireCfg } from '../integrations';

export type Row = Record<string, unknown>;

const mbError = (t: string) => { try { const j = JSON.parse(t); return String(j.error ?? j.via?.[0]?.error ?? j.message ?? t); } catch { return t; } };

// Phiên Metabase dùng lại giữa các truy vấn (trang creator hỏi kho mỗi lần mở); hết hạn / bị thu hồi (401) thì đăng nhập lại.
let session: { base: string; id: string } | null = null;
async function login(base: string, user: string, password: string) {
  const res = await fetch(`${base}/api/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ username: user, password }),
  });
  if (!res.ok) throw new Error(`Metabase đăng nhập lỗi ${res.status}: ${mbError(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { id: string }).id;
}

/** Chạy SQL native qua Metabase. Dùng API export JSON: không bị giới hạn 2.000 dòng như /api/dataset, và Metabase ghi mỗi dòng
 *  kết quả trên một dòng văn bản ("[", "{…},", …, "]") nên đọc theo luồng, không phải giữ cả trăm MB trong bộ nhớ. */
export async function* warehouseQuery(sql: string): AsyncGenerator<Row> {
  const c = await requireCfg('warehouse', 'METABASE_URL', 'METABASE_USER', 'METABASE_PASSWORD');
  const base = c.METABASE_URL.replace(/\/+$/, '');
  const q = { database: Number(await cfg('METABASE_DATABASE_ID')) || 2, type: 'native', native: { query: sql } };
  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!session || session.base !== base) session = { base, id: await login(base, c.METABASE_USER, c.METABASE_PASSWORD) };
    res = await fetch(`${base}/api/dataset/json`, {
      method: 'POST', headers: { 'X-Metabase-Session': session.id }, body: new URLSearchParams({ query: JSON.stringify(q), format_rows: 'false' }), cache: 'no-store',
    });
    if (res.status !== 401) break;
    session = null;
  }
  if (!res!.ok || !res!.body) throw new Error(`Metabase ${res!.status}: ${mbError(await res!.text()).slice(0, 300)}`);
  const decoder = new TextDecoder();
  let buf = '';
  const parse = (line: string) => {
    const t = line.trim().replace(/,$/, '');
    if (!t || t === '[' || t === ']') return null;
    const r = JSON.parse(t) as Row;
    if (Object.keys(r).length <= 3 && 'error' in r) throw new Error(`Metabase: ${String(r.error).slice(0, 300)}`); // lỗi giữa chừng (dòng chỉ có error / status)
    return r;
  };
  for await (const chunk of res!.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const r = parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (r) yield r;
    }
  }
  const r = parse(buf);
  if (r) yield r;
}
