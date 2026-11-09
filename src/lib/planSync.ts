// Đồng bộ bảng "4.1 Plan order tổng" (Lark Base B2C_Quản lý Booking) vào Plan / PlanLine.
// Mỗi tháng trên Lark ("2026/11") = 1 plan. Mỗi dòng Lark (gian hàng × tháng) tách thành các dòng plan: video affiliate trả phí
// (theo KL1–KL7 nếu Lark có chia tier), video self channel, phiên livestream. Freecast (TAP) không phải booking trả phí: chỉ ghi chú.
// Id lấy từ Lark ("lark-2026-11", "lark-<record_id>-self") nên đồng bộ lại không đổi id: job, matching đã gắn vào dòng vẫn giữ.
// Plan / dòng tạo tay trong app (id cuid) không bị đụng tới.
import { type LarkRecord, searchPages, toText } from './bookingSync';
import { db } from './db';
import { tenantToken } from './lark';
import { brandKey } from './listing';
import { people, syncMasterJob } from './masterSync';

const TABLE = 'tblvgyOkneDKOVsB';
const KL = ['KL1', 'KL2', 'KL3', 'KL4', 'KL5', 'KL6', 'KL7'];
// Tên cột trên Lark. Đổi tên cột bên Lark thì sửa ở đây.
const COL = {
  store: 'Gian hàng',
  brand: 'Brand',
  month: 'Tháng',
  b2c: 'B2C phụ trách',
  video: 'Số video affiliate',
  videoAdj: '(sau điều chỉnh) Số video affliate',
  videoCost: 'Chi phí booking video affiliate',
  tapBrand: 'TAP Brand',
  tap: 'TAP',
  tapUp: 'TAP UpAffiliate',
  self: 'Booking - Số video self channel',
  selfAdj: '(sau điều chỉnh) Booking - Số video self channel',
  selfCost: 'Booking - Chi phí video self channel',
  live: 'Số phiên livestream affiliate',
  liveAdj: '(sau điều chỉnh) Số phiên live affliate',
  liveCost: 'Chi phí booking livestream affiliate',
  pic: 'Booking phụ trách',
  picLookup: 'Booking PIC',
} as const;

/** Plan / dòng plan đến từ Lark: chỉ sửa trên Lark, app không cho sửa. */
export const fromLark = (id: string) => id.startsWith('lark-');

const num = (v: unknown) => (typeof v === 'number' ? v : 0);
// Chi phí trên Lark là gross; Lark quy net = gross / 1.08 / 1.1 (cột "(Net) Chi phí ..."). Ngân sách dòng dùng net để so với giá job (net).
const net = (v: unknown) => Math.round(num(v) / 1.08 / 1.1) || null;

export interface LineDraft {
  id: string;
  month: string; // "2026-11"
  brand: string | null;
  pic: { id: string; name: string } | null;
  tier: string | null;
  contentType: string;
  quantity: number;
  budget: number | null;
  note: string | null;
}

/** Một dòng Lark → các dòng plan (chưa khớp brand / PIC của app). Không có tháng hợp lệ hoặc không có số liệu → []. */
export function toLines(r: LarkRecord): LineDraft[] {
  const f = r.fields;
  const t = (k: keyof typeof COL) => toText(f[COL[k]], new Map())?.trim() || null;
  const m = t('month')?.match(/^(\d{4})\/(\d{2})$/);
  if (!m) return [];
  // Cột "(sau điều chỉnh)" là số đang chạy; trống thì lấy số ban đầu.
  const qty = (adj: keyof typeof COL, orig: keyof typeof COL) => num(f[COL[adj]] ?? f[COL[orig]]);
  const foc = num(f[COL.tapBrand]) + num(f[COL.tap]) + num(f[COL.tapUp]);
  const base = { month: `${m[1]}-${m[2]}`, brand: t('brand'), pic: people(f[COL.pic])[0] ?? people(f[COL.picLookup])[0] ?? null };
  const note = (extra?: string | false) => [t('store'), extra, !f[COL.b2c] && 'B2C không phụ trách'].filter(Boolean).join(' · ') || null;

  const out: LineDraft[] = [];
  const add = (key: string, tier: string | null, contentType: string, quantity: number, budget: number | null, n = note()) => {
    if (quantity > 0 || budget) out.push({ ...base, id: `lark-${r.record_id}-${key}`, tier, contentType, quantity: Math.max(0, quantity), budget, note: n });
  };
  let cast = qty('videoAdj', 'video') - foc; // video affiliate trả phí = tổng − freecast
  for (const k of KL) {
    add(k, k, 'Video', num(f[k]), null);
    cast -= num(f[k]);
  }
  add('video', null, 'Video', cast, net(f[COL.videoCost]), note(foc > 0 && `Freecast (TAP) ${foc} video, không tính vào SL`));
  add('self', null, 'Video self channel', qty('selfAdj', 'self'), net(f[COL.selfCost]));
  add('live', null, 'Phiên livestream', qty('liveAdj', 'live'), net(f[COL.liveCost]));
  return out;
}

export async function syncPlans() {
  const token = await tenantToken();
  const drafts: LineDraft[] = [];
  let rows = 0;
  for await (const page of searchPages(TABLE, [...Object.values(COL), ...KL], token)) {
    rows += page.length;
    for (const r of page) drafts.push(...toLines(r));
  }
  if (!rows) throw new Error('Bảng plan trên Lark trả về 0 dòng, không đồng bộ để tránh xoá nhầm.');

  // Brand khớp Danh mục theo tên (bỏ khoảng trắng, ký tự đặc biệt); chưa có thì thêm để "Tìm KOC" và gắn job theo brand chạy được.
  const loadBrands = async () => new Map((await db.brand.findMany({ select: { id: true, name: true, members: { where: { role: 'Booking PIC' }, select: { userId: true } } } })).map((b) => [brandKey(b.name), b]));
  let brands = await loadBrands();
  const missing = new Map(drafts.filter((d) => brandKey(d.brand) && !brands.has(brandKey(d.brand))).map((d) => [brandKey(d.brand), d.brand!]));
  const newBrands = missing.size ? (await db.brand.createMany({ data: [...missing.values()].map((name) => ({ name })), skipDuplicates: true })).count : 0;
  if (newBrands) brands = await loadBrands();

  // PIC: user Lark (open_id) → user app; chưa đăng nhập app thì khớp theo tên; không có thì Booking PIC của brand.
  const users = await db.user.findMany({ select: { id: true, larkUserId: true, name: true } });
  const lower = (s?: string | null) => s?.trim().toLowerCase();
  const lines = drafts.map((d) => {
    const b = brands.get(brandKey(d.brand));
    const u = d.pic && (users.find((x) => x.larkUserId === d.pic!.id) ?? users.find((x) => lower(x.name) === lower(d.pic!.name)));
    return {
      id: d.id, planId: `lark-${d.month}`, brandId: b?.id ?? null, productId: null, week: null,
      tier: d.tier, contentType: d.contentType, quantity: d.quantity, budget: d.budget,
      picId: u?.id ?? b?.members[0]?.userId ?? null, note: d.note,
    };
  });

  const months = [...new Set(drafts.map((d) => d.month))];
  await db.plan.createMany({
    data: months.map((m) => ({
      id: `lark-${m}`, month: m, name: `Plan order tổng ${m.split('-').reverse().join('/')}`, createdById: 'lark',
      note: 'Đồng bộ từ Lark Base (4.1 Plan order tổng), sửa số liệu trên Lark',
    })),
    skipDuplicates: true,
  });

  const old = new Map((await db.planLine.findMany({ where: { id: { startsWith: 'lark-' } } })).map((l) => [l.id, l]));
  const fresh = lines.filter((l) => !old.has(l.id));
  const changed = lines.filter((l) => {
    const o = old.get(l.id);
    return o && (Object.keys(l) as (keyof typeof l)[]).some((k) => o[k] !== l[k]);
  });
  const created = (await db.planLine.createMany({ data: fresh, skipDuplicates: true })).count;
  // ponytail: cập nhật từng dòng; plan ít đổi nên mỗi lượt chỉ vài chục dòng. Gom batch nếu chậm.
  for (const l of changed) await db.planLine.update({ where: { id: l.id }, data: l });
  const keep = new Set(lines.map((l) => l.id));
  const removed = (await db.planLine.deleteMany({ where: { id: { in: [...old.keys()].filter((id) => !keep.has(id)) } } })).count;
  // Tháng không còn trên Lark: xoá plan nếu không còn dòng nào (kể cả dòng thêm tay).
  await db.plan.deleteMany({ where: { id: { startsWith: 'lark-', notIn: months.map((m) => `lark-${m}`) }, lines: { none: {} } } });

  return { rows, plans: months.length, lines: lines.length, created, updated: changed.length, removed, newBrands };
}

/** Một lượt đồng bộ master data rồi plan, trả câu tóm tắt lưu ở SyncState (cron và nút "Đồng bộ ngay" ở tab Plan). */
export async function syncPlansJob() {
  const master = await syncMasterJob(); // brand, gian hàng, user, phân công phải có trước để dòng plan gắn được brand / PIC
  const r = await syncPlans();
  return `${master} · Plan: ${r.plans} tháng · ${r.lines} dòng plan · ${r.created} mới · ${r.updated} cập nhật · ${r.removed} xoá${r.newBrands ? ` · ${r.newBrands} brand mới` : ''}`;
}
