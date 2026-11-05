'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { audit, BRAND_ROLES } from '@/lib/catalog';
import { db } from '@/lib/db';
import { isUniqueError, optInt, str } from '@/lib/form';
import { requireUser } from '@/lib/session';

// Danh mục: Admin / Leader sửa, mọi người xem.
const editor = () => requireUser('ADMIN', 'LEADER');
const opt = (fd: FormData, k: string) => str(fd, k) || null;
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
  const data = { name, logoUrl, usp: opt(fd, 'usp'), guideline: opt(fd, 'guideline'), checklist: opt(fd, 'checklist'), note: opt(fd, 'note') };
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
  const brands = [...new Set(pairs.map((p) => p.brand!.trim()).filter(Boolean))];
  await db.brand.createMany({ data: brands.map((name) => ({ name })), skipDuplicates: true });
  const idOf = new Map((await db.brand.findMany({ select: { id: true, name: true } })).map((b) => [b.name, b.id]));
  const stores = pairs.filter((p) => p.store?.trim()).flatMap((p) => p.store!.split(', ').map((s) => ({ brandId: idOf.get(p.brand!.trim())!, name: s.trim() })));
  await db.store.createMany({ data: stores.filter((s) => s.brandId && s.name), skipDuplicates: true });
  await audit(me.id, 'Brand', '*', 'Nhập từ booking Lark', { brands: brands.length });
  revalidatePath('/catalog');
  redirect('/catalog');
}

export async function deleteBrand(fd: FormData) {
  const me = await requireUser('ADMIN');
  const id = str(fd, 'id');
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
  const data = { brandId, name, storeId: str(fd, 'storeId') || null, imageUrl, link, price, usp: opt(fd, 'usp') };
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
