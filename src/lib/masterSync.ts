// Đồng bộ master data dùng cho Booking từ Lark Base B2C_Quản lý Booking; chạy trước plan trong cùng lượt (src/lib/planSync.ts).
// - 5.1 Stores → Danh mục: brand + gian hàng (sàn, link). Không xoá gì; tỷ lệ chuyển đổi / AOV sửa trong app giữ nguyên.
// - 6.2 Nhân sự Booking → User: người team Booking còn tài khoản Lark được tạo user Nhân viên, đăng nhập bằng Lark
//   (như "quy tắc phòng ban tự cho đăng nhập" của app b2c). User đã có không bị đổi quyền / khoá.
// - 5.1 Stores "Người phụ trách" (người team Booking) → Nhân sự phụ trách brand: người đầu là Booking PIC, còn lại Booking Support. Chỉ thêm.
// - 5.6 Tệp cast → Bảng giá tier: chỉ nạp khi bảng giá trong app đang trống (sau đó Admin sửa ở Danh mục).
// - 3.5 Danh sách file brand → Guideline brand: chỉ điền brand chưa có guideline.
import type { Prisma } from '@prisma/client';
import { type LarkRecord, searchPages, toText } from './bookingSync';
import { db } from './db';
import { fetchLarkProfiles, tenantToken } from './lark';
import { brandKey } from './listing';

const T = { stores: 'tbldXi2AMbyGWUgY', staff: 'tblqWfTyEyRcYJCU', cast: 'tblzMmYoBuYFTB1f', files: 'tbl9y6mJH0bp9ZHl' };
// Tên cột trên Lark. Đổi tên cột bên Lark thì sửa ở đây.
const STORE = { name: 'Store_Operation', brand: 'Brand_Name', brandAlt: 'Brand', platform: 'Platform', url: 'Store_link', pic: 'Người phụ trách' } as const;
const STAFF = { team: 'Team', account: 'tai_khoan', title: 'Vị trí' } as const;
const CAST = { tier: 'Tệp KOC', min: 'Min cast', max: 'Max cast', group: 'Phân nhóm', range: 'Khoảng giá -1' } as const;
const FILES = { store: 'Store', booking: 'File Booking GG Sheet', ops: 'File vận hành', brief: 'Brief sản phẩm', handover: 'Link file bàn giao' } as const;
const BOOKING_TEAM = 'Booking';

const text = (v: unknown) => toText(v, new Map())?.trim() || null;
const lower = (s?: string | null) => s?.trim().toLowerCase() || null;

export interface LarkPerson { id: string; name: string }
/** Cột người (User) hoặc Lookup ra người → [{ id: open_id, name }]. */
export const people = (v: unknown): LarkPerson[] => {
  const a = (v as { value?: unknown } | null)?.value ?? v;
  return Array.isArray(a) ? a.filter((u) => u?.id) : [];
};

type AppUser = { id: string; larkUserId: string; name: string | null };
/**
 * Người Lark (open_id + tên) → user app. Khớp open_id trước. Theo tên chỉ khi đúng một user mang tên đó và user ấy được thêm bằng
 * User ID (không phải open_id): open_id khác nhau là hai người khác nhau dù trùng tên.
 */
export function matchUser<U extends AppUser>(users: U[], p: LarkPerson): U | undefined {
  const byId = users.find((u) => u.larkUserId === p.id);
  if (byId) return byId;
  const same = users.filter((u) => lower(u.name) && lower(u.name) === lower(p.name));
  return same.length === 1 && !same[0].larkUserId.startsWith('ou_') ? same[0] : undefined;
}

const PLATFORM: Record<string, string> = { tiktok: 'TikTok Shop', shopee: 'Shopee', lazada: 'Lazada' };
/** Sàn theo cột Platform; trống thì đoán từ tên gian ("Brand_TikTok_E2E-C"). */
export function platformOf(platform: string | null, storeName: string): string | null {
  if (platform) return PLATFORM[platform.toLowerCase()] ?? platform;
  return Object.entries(PLATFORM).find(([k]) => storeName.toLowerCase().includes(`_${k}`))?.[1] ?? null;
}

async function readAll(table: string, fields: readonly string[], token: string) {
  const out: LarkRecord[] = [];
  for await (const page of searchPages(table, [...fields], token)) out.push(...page);
  return out;
}

export async function syncMaster() {
  const token = await tenantToken();
  const storeRows = await readAll(T.stores, Object.values(STORE), token);
  const staffRows = await readAll(T.staff, Object.values(STAFF), token);
  const castRows = await readAll(T.cast, Object.values(CAST), token);
  const fileRows = await readAll(T.files, Object.values(FILES), token);
  if (!storeRows.length) throw new Error('Bảng 5.1 Stores trên Lark trả về 0 dòng.');

  const stores = storeRows.flatMap((r) => {
    const name = text(r.fields[STORE.name]);
    const brand = name && (text(r.fields[STORE.brand]) ?? text(r.fields[STORE.brandAlt]) ?? name.split('_')[0].trim());
    if (!name || !brandKey(brand)) return [];
    return [{ recordId: r.record_id, name, brand: brand!, platform: platformOf(text(r.fields[STORE.platform]), name), url: text(r.fields[STORE.url]), pics: people(r.fields[STORE.pic]) }];
  });

  // Brand
  const loadBrands = async () => new Map((await db.brand.findMany({ select: { id: true, name: true, guideline: true } })).map((b) => [brandKey(b.name), b]));
  let brands = await loadBrands();
  const missing = new Map(stores.filter((s) => !brands.has(brandKey(s.brand))).map((s) => [brandKey(s.brand), s.brand]));
  const brandsAdded = missing.size ? (await db.brand.createMany({ data: [...missing.values()].map((name) => ({ name })), skipDuplicates: true })).count : 0;
  if (brandsAdded) brands = await loadBrands();

  // Gian hàng: khớp theo tên (Lark có vài dòng trùng tên, lấy dòng sau). Sàn / link theo Lark khi Lark có số liệu.
  const existing = new Map((await db.store.findMany({ select: { id: true, name: true, platform: true, url: true } })).map((s) => [brandKey(s.name), s]));
  const fresh: Prisma.StoreCreateManyInput[] = [];
  let storesUpdated = 0;
  for (const s of new Map(stores.map((x) => [brandKey(x.name), x])).values()) {
    const old = existing.get(brandKey(s.name));
    if (!old) {
      fresh.push({ brandId: brands.get(brandKey(s.brand))!.id, name: s.name, url: s.url, ...(s.platform && { platform: s.platform }) });
      continue;
    }
    const data = { ...(s.platform && s.platform !== old.platform && { platform: s.platform }), ...(s.url && s.url !== old.url && { url: s.url }) };
    if (!Object.keys(data).length) continue;
    await db.store.update({ where: { id: old.id }, data });
    storesUpdated++;
  }
  const storesAdded = fresh.length ? (await db.store.createMany({ data: fresh, skipDuplicates: true })).count : 0;

  // Bảng giá tier: KL7 không có trần (Lark ghi 30 tỷ, vượt kiểu Int) → để trống.
  let tiers = 0;
  if (!(await db.tierPrice.count())) {
    const price = (v: unknown) => (typeof v === 'number' && v <= 2_147_483_647 ? Math.round(v) : null);
    const data = castRows.flatMap((r) => {
      const tier = text(r.fields[CAST.tier]);
      if (!tier || !/^KL[1-7]$/.test(tier)) return []; // bỏ dòng TAP (freecast)
      const note = [text(r.fields[CAST.group]), text(r.fields[CAST.range])].filter(Boolean).join(' · ') || null;
      return [{ tier, priceType: 'Video', minPrice: price(r.fields[CAST.min]), maxPrice: price(r.fields[CAST.max]), note }];
    });
    tiers = (await db.tierPrice.createMany({ data, skipDuplicates: true })).count;
  }

  // Guideline brand: link file booking / vận hành / brief / bàn giao của gian hàng.
  const brandOfStore = new Map(stores.map((s) => [s.recordId, s.brand]));
  let guidelines = 0;
  for (const r of fileRows) {
    const b = brands.get(brandKey(brandOfStore.get(text(r.fields[FILES.store])?.split(', ')[0] ?? '')));
    if (!b || b.guideline) continue;
    const links = ([['File booking', FILES.booking], ['File vận hành', FILES.ops], ['Brief sản phẩm', FILES.brief], ['File bàn giao', FILES.handover]] as const)
      .map(([label, col]) => text(r.fields[col]) && `${label}: ${text(r.fields[col])}`)
      .filter(Boolean);
    if (!links.length) continue;
    b.guideline = links.join('\n');
    await db.brand.update({ where: { id: b.id }, data: { guideline: b.guideline } });
    guidelines++;
  }

  // User: team Booking. Lark chỉ trả hồ sơ người còn tài khoản, nên người đã nghỉ (tài khoản bị khoá) không được tạo.
  const team = new Map<string, string | null>(); // open_id → vị trí
  for (const r of staffRows) {
    if (text(r.fields[STAFF.team]) === BOOKING_TEAM) for (const p of people(r.fields[STAFF.account])) team.set(p.id, text(r.fields[STAFF.title]));
  }
  const profiles = team.size ? await fetchLarkProfiles([...team.keys()]) : new Map();
  const users = await db.user.findMany({ select: { id: true, larkUserId: true, name: true, email: true } });
  // Đã có (thêm tay bằng User ID, không phải open_id) thì nhận theo email / tên Lark, không tạo trùng.
  const newUsers = [...team.keys()].flatMap((id) => {
    const p = profiles.get(id);
    if (!p || matchUser(users, { id, name: p.name ?? '' }) || (p.email && users.some((u) => lower(u.email) === lower(p.email)))) return [];
    return [{ larkUserId: id, role: 'STAFF' as const, ...p, jobTitle: team.get(id) ?? p.jobTitle }];
  });
  const usersAdded = newUsers.length ? (await db.user.createMany({ data: newUsers, skipDuplicates: true })).count : 0;

  // Phân công: người phụ trách gian hàng (thuộc team Booking) → nhân sự phụ trách brand. Bỏ qua user đã khoá để bàn giao
  // (Phân quyền → Phân công) không bị lượt sau gán lại người cũ.
  const all = await db.user.findMany({ where: { active: true }, select: { id: true, larkUserId: true, name: true, email: true } });
  const members = new Map<string, Prisma.BrandMemberCreateManyInput>();
  for (const s of stores) {
    const b = brands.get(brandKey(s.brand))!;
    s.pics.filter((p) => team.has(p.id)).forEach((p, i) => {
      const u = matchUser(all, p);
      const role = i ? 'Booking Support' : 'Booking PIC';
      if (u) members.set(`${b.id}|${u.id}|${role}`, { brandId: b.id, userId: u.id, role });
    });
  }
  const membersAdded = members.size ? (await db.brandMember.createMany({ data: [...members.values()], skipDuplicates: true })).count : 0;

  return { stores: stores.length, brandsAdded, storesAdded, storesUpdated, tiers, guidelines, usersAdded, membersAdded };
}

export async function syncMasterJob() {
  const r = await syncMaster();
  const parts = [
    `${r.stores} gian hàng`, r.storesAdded && `${r.storesAdded} gian mới`, r.storesUpdated && `${r.storesUpdated} gian cập nhật`,
    r.brandsAdded && `${r.brandsAdded} brand mới`, r.usersAdded && `${r.usersAdded} user mới`, r.membersAdded && `${r.membersAdded} phân công mới`,
    r.tiers && `${r.tiers} giá tier`, r.guidelines && `${r.guidelines} guideline`,
  ];
  return parts.filter(Boolean).join(' · ');
}
