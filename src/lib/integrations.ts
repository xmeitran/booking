// Checklist tích hợp theo "Tài liệu giải pháp hệ thống B2C-Ops Phase 1" (mục 4: L1–L6, U1–U5, G1–G2).
// Mỗi tích hợp cần vài giá trị cấu hình. Giá trị đọc từ .env trước, không có thì đọc bản Admin nhập ở Phân quyền → Tích hợp
// (một dòng SyncState id "integrations"). Tích hợp chưa đủ cấu hình thì phần giao diện của nó không hiện (configured()).
// Tích hợp chưa có API thật (UpAffiliate) để items rỗng: không gọi, không đoán, chỉ ghi thứ cần bổ sung.
// ponytail: giá trị bí mật nhập qua giao diện lưu thẳng trong DB (không mã hoá); cần mã hoá thì đặt vào .env trên server.
import { cache } from 'react';
import { db } from './db';

export type CfgItem = { key: string; label: string; hint?: string; secret?: boolean; long?: boolean; optional?: boolean };
export type Integration = { id: string; code: string; name: string; what: string; items: CfgItem[]; todo?: string[] };

export const INTEGRATIONS: Integration[] = [
  {
    id: 'upaffiliate', code: 'U1 · U2 · U5', name: 'UpAffiliate / UpS',
    what: 'Tạm đóng: UpAffiliate chưa mở kết nối, app chỉ dùng số từ Lark và TikTok Shop.',
    items: [],
    todo: [
      'Tài liệu API và khoá truy cập cho: hồ sơ KOC, số liệu video affiliate và ads, thông tin nghiệm thu.',
    ],
  },
  {
    id: 'sheets', code: 'G1 · G2', name: 'Google Sheet gửi brand duyệt',
    what: 'Gửi đợt listing sang Google Sheet của brand, rồi lấy kết quả brand duyệt (Yes / No / Cân nhắc) về.',
    todo: ['Mỗi brand chia sẻ sheet cho email service account (quyền Editor), rồi dán link sheet vào trang đợt listing.'],
    items: [
      { key: 'GOOGLE_SERVICE_ACCOUNT_EMAIL', label: 'Email service account Google', hint: 'Brand chia sẻ sheet cho email này với quyền Editor' },
      { key: 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY', label: 'Private key service account', secret: true, long: true, hint: 'Trường private_key trong file JSON của service account' },
    ],
  },
  {
    id: 'mail', code: 'L6', name: 'Mail mời hợp tác KOC',
    what: 'Gửi mail mời hợp tác cho KOC trong đợt listing, từ hộp thư Lark Mail hoặc hộp thư khác.',
    todo: ['Mời hợp tác qua Zalo: cần tài khoản Zalo OA / ZNS.'],
    items: [
      { key: 'SMTP_HOST', label: 'SMTP host', hint: 'Lark Mail: smtp.larksuite.com' },
      { key: 'SMTP_PORT', label: 'SMTP port', hint: '465 (SSL) hoặc 587', optional: true },
      { key: 'SMTP_USER', label: 'Tài khoản gửi (email)' },
      { key: 'SMTP_PASS', label: 'Mật khẩu SMTP', secret: true },
      { key: 'MAIL_FROM_NAME', label: 'Tên người gửi hiển thị', hint: 'Trống = "UpBase Booking"', optional: true },
      { key: 'MAIL_INVITE_SUBJECT', label: 'Tiêu đề mail mời', hint: 'Dùng được {brand}, {koc}, {product}', optional: true },
      { key: 'MAIL_INVITE_BODY', label: 'Nội dung mail mời', long: true, hint: 'Dùng được {brand}, {koc}, {product}, {pic}. Trống = mẫu mặc định', optional: true },
    ],
  },
  {
    id: 'contract', code: 'U3 · U4', name: 'Hợp đồng (HĐNT, phụ lục, WeSign)',
    what: 'Tạm đóng, làm sau. Trạng thái, mã, link HĐNT vẫn nhập tay trong hồ sơ pháp lý của KOC.',
    items: [],
    todo: [
      'Tạo HĐNT / phụ lục / BBNT và ký WeSign: làm khi chốt giao diện hợp đồng và có API hợp đồng chính thức.',
    ],
  },
  {
    id: 'approval', code: 'L3 · L4 · L5', name: 'Duyệt ĐNTT trên Lark Approval',
    what: 'Gửi ĐNTT sang Lark Approval để duyệt, rồi lấy kết quả duyệt về app.',
    items: [
      { key: 'LARK_APPROVAL_CODE', label: 'Mã quy trình duyệt ĐNTT (approval code)', hint: 'Kế toán / admin Lark Approval cấp' },
      { key: 'LARK_APPROVAL_FORM_MAP', label: 'Mapping ô form Approval', long: true, hint: 'JSON { "<widget id>": "<trường>" }. Trường: code, amount, gross, jobs, koc, bank, note, creator. Widget id hiện ở danh sách bên dưới sau khi lưu mã quy trình.' },
    ],
    todo: [
      'Ghi phiếu vào bảng 6.1 Phiếu thanh toán và ghi kết quả nghiệm thu về 3.2 trên Lark: cần quyền ghi Lark Base cho app và tên cột chính xác.',
      'Trạng thái "Đã thanh toán" và số UNC: cần biết Kế toán ghi ở cột nào trên Lark. Hiện app chỉ lấy được Duyệt / Từ chối; bước đã thanh toán chuyển tay.',
    ],
  },
  {
    id: 'r2', code: 'Object storage', name: 'Lưu file (Cloudflare R2)',
    what: 'Tạm đóng: chưa có chức năng nào cần lưu file.',
    items: [],
    todo: [
      'Cần khi làm hợp đồng, giấy tờ pháp lý KOC hoặc ảnh nghiệm thu.',
    ],
  },
  {
    id: 'warehouse', code: 'DWH', name: 'Kho dữ liệu UpBase',
    what: 'Số liệu creator TikTok (follower, view, GMV, tệp follower, đơn của shop UpBase) cho Creator matching, trang creator và tab Dữ liệu.',
    todo: [
      'Nên xin team Data một tài khoản Metabase riêng cho Booking Hub, để khi tài khoản DX đổi mật khẩu thì số liệu không dừng cập nhật.',
    ],
    items: [
      { key: 'METABASE_URL', label: 'URL Metabase', hint: 'https://metabase.upbase.asia' },
      { key: 'METABASE_USER', label: 'Email đăng nhập Metabase' },
      { key: 'METABASE_PASSWORD', label: 'Mật khẩu Metabase', secret: true },
      { key: 'METABASE_DATABASE_ID', label: 'ID database ClickHouse trong Metabase', hint: 'Trống = 2 (database "clickhouse")', optional: true },
    ],
  },
  {
    id: 'ai', code: 'AI', name: 'API AI (Claude)',
    what: 'Claude đọc brief để điền yêu cầu đợt matching, chấm độ hợp nội dung của KOC và viết brief nháp cho job. Đặt hạn mức chi tiêu ở Anthropic Console.',
    todo: ['AI chấm video khi nghiệm thu: cần nguồn lời thoại (transcript) của video.', 'Tìm KOC theo đối thủ / hashtag / xu hướng và tìm kênh khác của KOC bằng AI (Kalodata, TikTok Shop): chưa làm.'],
    items: [{ key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', secret: true }],
  },
];

const ID = 'integrations';
const KEYS = new Set(INTEGRATIONS.flatMap((i) => i.items.map((x) => x.key)));

const saved = cache(async (): Promise<Record<string, string>> => ((await db.syncState.findUnique({ where: { id: ID } }))?.data ?? {}) as Record<string, string>);

/** Giá trị cấu hình: .env trước, rồi bản Admin nhập. '' khi chưa có. */
export async function cfg(key: string): Promise<string> {
  return process.env[key]?.trim() || (await saved())[key]?.trim() || '';
}

/** Tích hợp đã đủ mọi mục bắt buộc chưa. Chưa đủ thì phần giao diện tương ứng không hiện. */
export async function configured(integrationId: string) {
  const it = INTEGRATIONS.find((i) => i.id === integrationId)!;
  for (const x of it.items) if (!x.optional && !(await cfg(x.key))) return false;
  return it.items.length > 0;
}

/** Lấy nhiều giá trị; thiếu giá trị bắt buộc thì ném lỗi ghi rõ tên để người dùng biết bổ sung ở đâu. */
export async function requireCfg<K extends string>(integrationId: string, ...keys: K[]): Promise<Record<K, string>> {
  const out = {} as Record<K, string>;
  const missing: string[] = [];
  const it = INTEGRATIONS.find((i) => i.id === integrationId)!;
  for (const k of keys) {
    out[k] = await cfg(k);
    if (!out[k]) missing.push(it.items.find((x) => x.key === k)?.label ?? k);
  }
  if (missing.length) throw new NotConfigured(`Chưa cấu hình ${it.name}: thiếu ${missing.join(', ')}. Admin bổ sung ở Phân quyền → Tích hợp.`);
  return out;
}
export class NotConfigured extends Error {}

export type ItemStatus = CfgItem & { source: 'env' | 'db' | null; preview: string };
/** Trạng thái checklist cho trang Tích hợp. Giá trị bí mật không bao giờ trả ra, chỉ báo đã có. */
export async function checklist(): Promise<(Omit<Integration, 'items'> & { items: ItemStatus[]; missing: number })[]> {
  const s = await saved();
  return INTEGRATIONS.map((i) => {
    const items = i.items.map((x): ItemStatus => {
      const env = process.env[x.key]?.trim();
      const v = env || s[x.key]?.trim() || '';
      return { ...x, source: env ? 'env' : v ? 'db' : null, preview: !v ? '' : x.secret ? '••••••' : v.length > 60 ? `${v.slice(0, 60)}…` : v };
    });
    return { ...i, items, missing: items.filter((x) => !x.source && !x.optional).length };
  });
}

/** Lưu các ô Admin vừa điền (ô trống = giữ nguyên; "-" = xoá giá trị đã nhập). */
export async function saveCfg(values: Record<string, string>) {
  const next = { ...(await saved()) };
  for (const [k, v] of Object.entries(values)) {
    if (!KEYS.has(k) || !v.trim()) continue;
    if (v.trim() === '-') delete next[k];
    else next[k] = v.trim();
  }
  await db.syncState.upsert({ where: { id: ID }, create: { id: ID, data: next }, update: { data: next } });
  return Object.keys(values).filter((k) => KEYS.has(k) && values[k].trim());
}
