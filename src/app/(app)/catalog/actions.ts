'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { audit, BRAND_ROLES } from '@/lib/booking/catalog';
import { GROUP0, KL_LEVELS, KL_METRICS, parseRules, type BrandRules, type KlRule } from '@/lib/matching/spec';
import { db } from '@/lib/db';
import { isUniqueError, optInt, str } from '@/lib/form';
import { brandKey } from '@/lib/booking/listing';
import { requirePerm, requireUser } from '@/lib/auth/session';

// Danh mục: người có quyền "Sửa danh mục" (Phân quyền) sửa, mọi người xem.
const editor = () => requirePerm('catalog.edit');
const opt = (fd: FormData, k: string) => str(fd, k) || null;
/** Ô nhiều giá trị: mỗi dòng hoặc cách nhau dấu phẩy / chấm phẩy. */
const list = (fd: FormData, k: string) => [...new Set(str(fd, k).split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean))];
/** Số thực ≥ 0 (cho phép dấu phẩy thập phân); '' → null; sai → NaN. */
const optNum = (fd: FormData, k: string) => { const v = str(fd, k).replace(',', '.').replace('%', ''); if (!v) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : NaN; };
const url = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return !v ? null : /^https?:\/\//i.test(v) ? v : undefined;
};

export async function saveBrand(_: string | null, fd: FormData): Promise<string | null> {
  const me = await editor();
  const id = str(fd, 'id');
  const name = str(fd, 'name');
  const logoUrl = url(fd, 'logoUrl');
  if (!name) return 'Nhập tên brand.';
  if (logoUrl === undefined) return 'Link logo phải bắt đầu bằng http(s)://';
  const data = {
    name, logoUrl, usp: opt(fd, 'usp'), guideline: opt(fd, 'guideline'), checklist: opt(fd, 'checklist'), keywords: opt(fd, 'keywords'), note: opt(fd, 'note'),
    // Thông tin brand dùng cho Creator matching
    category: opt(fd, 'category'), subCategory: opt(fd, 'subCategory'), group: opt(fd, 'group'), audience: opt(fd, 'audience'), tone: opt(fd, 'tone'),
    rtb: opt(fd, 'rtb'), bannedClaims: list(fd, 'bannedClaims'), competitors: list(fd, 'competitors'),
  };
  let b;
  try {
    b = id ? await db.brand.update({ where: { id }, data }) : await db.brand.create({ data });
  } catch (e) {
    if (isUniqueError(e)) return `Brand "${name}" đã có.`;
    throw e;
  }
  await audit(me.id, 'Brand', b.id, id ? 'Sửa' : 'Tạo', { name });
  revalidatePath('/catalog');
  redirect(`/catalog/${b.id}`);
}

/** Lấy brand và gian hàng từ booking Lark (cột Brand, Store) làm danh mục ban đầu. Không ghi đè cái đã có. */
export async function importFromBookings() {
  const me = await editor();
  const pairs = await db.booking.findMany({ where: { brand: { not: null } }, distinct: ['brand', 'store'], select: { brand: true, store: true } });
  // Khớp brand theo khoá chuẩn hoá như đồng bộ Lark ("PH CARE" = "pH Care"), không tạo brand trùng.
  const have = new Set((await db.brand.findMany({ select: { name: true } })).map((b) => brandKey(b.name)));
  const brands = [...new Map(pairs.map((p) => [brandKey(p.brand), p.brand!.trim()] as const).filter(([k]) => k && !have.has(k))).values()];
  await db.brand.createMany({ data: brands.map((name) => ({ name })), skipDuplicates: true });
  const idOf = new Map((await db.brand.findMany({ select: { id: true, name: true } })).map((b) => [brandKey(b.name), b.id]));
  const stores = pairs.filter((p) => p.store?.trim()).flatMap((p) => p.store!.split(', ').map((s) => ({ brandId: idOf.get(brandKey(p.brand))!, name: s.trim() })));
  await db.store.createMany({ data: stores.filter((s) => s.brandId && s.name), skipDuplicates: true });
  await audit(me.id, 'Brand', '*', 'Nhập từ booking Lark', { brands: brands.length });
  revalidatePath('/catalog');
  redirect('/catalog');
}

export async function deleteBrand(fd: FormData) {
  const me = await requireUser('ADMIN');
  const id = str(fd, 'id');
  // Xoá brand xoá luôn gian hàng / sản phẩm / nhân sự và bỏ trống brand ở dòng plan, brief: chỉ cho xoá brand chưa dùng ở đâu.
  const used = await db.brand.findUniqueOrThrow({ where: { id }, select: { _count: { select: { jobs: true, planLines: true, briefs: true } } } });
  if (used._count.jobs || used._count.planLines || used._count.briefs) redirect(`/catalog/${id}`);
  await db.brand.delete({ where: { id } });
  await audit(me.id, 'Brand', id, 'Xoá');
  revalidatePath('/catalog');
  redirect('/catalog');
}

export async function saveStore(_: string | null, fd: FormData): Promise<string | null> {
  await editor();
  const id = str(fd, 'id');
  const brandId = str(fd, 'brandId');
  const name = str(fd, 'name');
  const link = url(fd, 'url');
  const aov = optInt(fd, 'aov');
  const crText = str(fd, 'cr').replace(',', '.').replace('%', '');
  const cr = crText ? Number(crText) / 100 : null;
  if (!name) return 'Nhập tên gian hàng.';
  if (link === undefined) return 'Link gian hàng phải bắt đầu bằng http(s)://';
  if (Number.isNaN(aov) || (cr != null && !(cr > 0 && cr <= 1))) return 'AOV là số ≥ 0, CR là % từ 0 tới 100.';
  const data = { brandId, name, platform: str(fd, 'platform') || 'TikTok Shop', url: link, aov, cr };
  try {
    if (id) await db.store.update({ where: { id }, data });
    else await db.store.create({ data });
  } catch (e) {
    if (isUniqueError(e)) return `Gian hàng "${name}" đã có.`;
    throw e;
  }
  revalidatePath(`/catalog/${brandId}`);
  redirect(`/catalog/${brandId}`);
}

export async function saveProduct(_: string | null, fd: FormData): Promise<string | null> {
  await editor();
  const id = str(fd, 'id');
  const brandId = str(fd, 'brandId');
  const name = str(fd, 'name');
  const imageUrl = url(fd, 'imageUrl');
  const link = url(fd, 'link');
  const price = optInt(fd, 'price');
  if (!name) return 'Nhập tên sản phẩm.';
  if (imageUrl === undefined || link === undefined) return 'Link ảnh / link sản phẩm phải bắt đầu bằng http(s)://';
  if (Number.isNaN(price)) return 'Giá là số nguyên ≥ 0.';
  const storeId = str(fd, 'storeId') || null;
  if (storeId && !(await db.store.count({ where: { id: storeId, brandId } }))) return 'Gian hàng không thuộc brand này.';
  // Thông tin sản phẩm dùng cho Creator matching
  const ageMin = optInt(fd, 'ageMin'), ageMax = optInt(fd, 'ageMax');
  const femaleMin = optNum(fd, 'femaleMin'), age18_34Min = optNum(fd, 'age18_34Min'), regionMin = optNum(fd, 'regionMin');
  if ([ageMin, ageMax].some(Number.isNaN) || (ageMin != null && ageMax != null && ageMin > ageMax)) return 'Độ tuổi mục tiêu: nhập số, "từ" không lớn hơn "đến".';
  if ([femaleMin, age18_34Min, regionMin].some((x) => Number.isNaN(x) || (x != null && x > 100))) return 'Ngưỡng % follower nhập từ 0 tới 100.';
  const gender = str(fd, 'targetGender');
  const data = {
    brandId, name, storeId, imageUrl, link, price, usp: opt(fd, 'usp'),
    sku: opt(fd, 'sku'), line: opt(fd, 'line'), targetGender: gender === 'Nữ' || gender === 'Nam' ? gender : null, ageMin, ageMax,
    kocVisual: opt(fd, 'kocVisual'), problem: opt(fd, 'problem'), exclusions: list(fd, 'exclusions'), channelTypes: fd.getAll('channelTypes').map(String).filter(Boolean),
    bannedWords: list(fd, 'bannedWords'), femaleMin, age18_34Min, regions: list(fd, 'regions'), regionMin, reviewerId: opt(fd, 'reviewerId'),
  };
  if (id) await db.product.update({ where: { id }, data });
  else await db.product.create({ data });
  revalidatePath(`/catalog/${brandId}`);
  redirect(`/catalog/${brandId}`);
}

export async function removeItem(fd: FormData) {
  await editor();
  const brandId = str(fd, 'brandId');
  const kind = str(fd, 'kind');
  const id = str(fd, 'id');
  if (kind === 'store') await db.store.delete({ where: { id } });
  if (kind === 'product') await db.product.delete({ where: { id } });
  if (kind === 'member') {
    const [userId, role] = id.split('|');
    await db.brandMember.delete({ where: { brandId_userId_role: { brandId, userId, role } } });
  }
  revalidatePath(`/catalog/${brandId}`);
  redirect(`/catalog/${brandId}`);
}

export async function addMember(fd: FormData) {
  await editor();
  const brandId = str(fd, 'brandId');
  const role = str(fd, 'role');
  const userId = str(fd, 'userId');
  if (userId && BRAND_ROLES.includes(role)) await db.brandMember.createMany({ data: [{ brandId, userId, role }], skipDuplicates: true });
  revalidatePath(`/catalog/${brandId}`);
  redirect(`/catalog/${brandId}`);
}

/** Bảng giá theo tier: lưu cả lưới một lần (ô trống = xoá). */
export async function saveTierPrices(_: string | null, fd: FormData): Promise<string | null> {
  const me = await editor();
  const rows: { tier: string; priceType: string; minPrice: number | null; maxPrice: number | null }[] = [];
  for (const key of new Set([...fd.keys()].filter((k) => k.startsWith('min|') || k.startsWith('max|')).map((k) => k.slice(4)))) {
    const [tier, priceType] = key.split('|');
    const minPrice = optInt(fd, `min|${key}`);
    const maxPrice = optInt(fd, `max|${key}`);
    if (Number.isNaN(minPrice) || Number.isNaN(maxPrice)) return `Giá ${tier} · ${priceType} phải là số.`;
    if (minPrice != null && maxPrice != null && minPrice > maxPrice) return `Giá ${tier} · ${priceType}: "từ" lớn hơn "đến".`;
    rows.push({ tier, priceType, minPrice, maxPrice });
  }
  await db.$transaction([
    db.tierPrice.deleteMany({}),
    db.tierPrice.createMany({ data: rows.filter((r) => r.minPrice != null || r.maxPrice != null) }),
  ]);
  await audit(me.id, 'TierPrice', '*', 'Sửa bảng giá');
  revalidatePath('/catalog');
  redirect('/catalog?tab=prices');
}

/** Quy tắc lọc KOC của brand (ngưỡng theo cấp KOC, chống trùng, đối thủ, yêu cầu riêng). */
export async function saveRules(_: string | null, fd: FormData): Promise<string | null> {
  const me = await editor();
  const brandId = str(fd, 'brandId');
  const kl: BrandRules['kl'] = {};
  for (const lv of KL_LEVELS) {
    const row: KlRule = {};
    for (const [k, label] of KL_METRICS) {
      const v = optInt(fd, `${k}|${lv}`);
      if (Number.isNaN(v)) return `${lv} · ${label}: nhập số nguyên ≥ 0.`;
      if (v != null) row[k] = v;
    }
    row.must = fd.getAll(`must|${lv}`).map(String).filter((m) => KL_METRICS.some(([k]) => k === m));
    if (str(fd, `approver|${lv}`)) row.approver = str(fd, `approver|${lv}`);
    if (KL_METRICS.some(([k]) => row[k] != null) || row.approver) kl[lv] = row;
  }
  const group0 = GROUP0.map((c) => ({ id: c.id, mode: str(fd, `g0|${c.id}`) })).filter((g) => g.mode === 'must' || g.mode === 'score') as BrandRules['group0'];
  if (group0.length && (group0.length < 3 || group0.length > 5)) return `Nhóm 0: chọn 3–5 tiêu chí (đang chọn ${group0.length}), hoặc không chọn để lấy điểm nhóm A.`;
  const ints = ['industryGmvMin', 'industryContentMin', 'cooldownDays', 'priceBand', 'adsCodeDays', 'holdDays', 'competitorDays'] as const;
  const vals: Partial<Record<(typeof ints)[number], number>> = {};
  for (const k of ints) {
    const v = optInt(fd, k);
    if (Number.isNaN(v)) return 'Các ô số ở quy tắc brand phải là số nguyên ≥ 0.';
    if (v != null) vals[k] = v;
  }
  const rules = parseRules({
    ...vals, kl, group0, scandal: str(fd, 'scandal'), k3: str(fd, 'k3') === '1',
    reupChannels: fd.getAll('reupChannels').map(String), exceptionApprover: str(fd, 'exceptionApprover') || null,
  });
  await db.brand.update({ where: { id: brandId }, data: { rules } });
  await audit(me.id, 'Brand', brandId, 'Sửa quy tắc matching');
  revalidatePath(`/catalog/${brandId}`);
  redirect(`/catalog/${brandId}#rules`);
}
