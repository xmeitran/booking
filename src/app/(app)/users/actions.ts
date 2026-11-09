'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { db } from '@/lib/db';
import { isUniqueError, str } from '@/lib/form';
import { fetchLarkProfiles } from '@/lib/lark';
import { ALL_PERMS, EDITABLE_ROLES, handoverWhere, readPolicy, writePolicy, type AccessPolicy } from '@/lib/access';
import { audit, BRAND_ROLES, JOB_ROLES } from '@/lib/catalog';
import { requirePerm, requireUser } from '@/lib/session';

export async function saveUser(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser('ADMIN');
  const id = str(fd, 'id');
  const larkUserId = str(fd, 'larkUserId');
  const role = str(fd, 'role') as Role;
  if (!larkUserId) return 'Nhập Lark User ID.';
  if (!Object.values(Role).includes(role)) return 'Vai trò không hợp lệ.';
  const jobRole = JOB_ROLES.includes(str(fd, 'jobRole')) ? str(fd, 'jobRole') : null;
  // Admin không tự đổi ID / quyền / khóa chính mình để tránh mất quyền truy cập.
  if (id === me.id) redirect('/users');

  const current = id ? await db.user.findUnique({ where: { id } }) : null;
  let profile = {};
  // Thêm mới hoặc đổi ID: lấy tên, email, avatar, phòng ban từ Lark; ID không có trên Lark thì không lưu.
  if (current?.larkUserId !== larkUserId) {
    let found;
    try {
      found = (await fetchLarkProfiles([larkUserId])).get(larkUserId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      // 99992360: Lark báo ID không hợp lệ / không tồn tại.
      return msg.includes('99992360') ? `Không tìm thấy ${larkUserId} trên Lark.` : `Không lấy được thông tin từ Lark. ${msg}`;
    }
    if (!found) return `Không tìm thấy ${larkUserId} trên Lark.`;
    // Một người có thể được nhập bằng User ID lẫn Open ID: chặn trùng theo email Lark.
    const dup = found.email && (await db.user.findFirst({ where: { email: found.email, ...(current && { NOT: { id: current.id } }) } }));
    if (dup) return `${found.name} đã có trong danh sách (Lark ID ${dup.larkUserId}).`;
    profile = found;
  }

  try {
    if (current) await db.user.update({ where: { id }, data: { larkUserId, role, jobRole, active: fd.get('active') === 'on', ...profile } });
    else await db.user.create({ data: { larkUserId, role, jobRole, ...profile } });
  } catch (e) {
    if (isUniqueError(e)) return 'Lark User ID này đã có trong danh sách.';
    throw e;
  }
  revalidatePath('/users');
  redirect('/users');
}

/** Cổng đăng nhập: phòng ban Lark được tự tạo user Nhân viên khi đăng nhập lần đầu (mỗi dòng một tên). */
export async function saveLoginDepts(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser('ADMIN');
  const policy = await readPolicy();
  const loginDepts = [...new Set(str(fd, 'depts').split('\n').map((s) => s.trim()).filter(Boolean))];
  if (loginDepts.some((d) => d.length < 3)) return 'Tên phòng ban tối thiểu 3 ký tự (khớp theo "chứa", tên quá ngắn sẽ cho cả phòng khác vào).';
  await writePolicy({ ...policy, loginDepts });
  await audit(me.id, 'Access', 'login', 'Sửa cổng đăng nhập', { loginDepts });
  revalidatePath('/users');
  redirect('/users');
}

/** Ma trận quyền: ô tick tên "ROLE|perm". Admin luôn đủ quyền nên không có trong form. */
export async function savePerms(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser('ADMIN');
  const policy = await readPolicy();
  const perms = Object.fromEntries(EDITABLE_ROLES.map((r) => [r, ALL_PERMS.filter((p) => fd.get(`${r}|${p}`) === 'on')])) as AccessPolicy['perms'];
  await writePolicy({ ...policy, perms });
  await audit(me.id, 'Access', 'perms', 'Sửa ma trận quyền', perms);
  revalidatePath('/', 'layout');
  redirect('/users/roles?saved=1');
}

// Phân công & bàn giao: người có quyền sửa danh mục (giống giao nhân sự ở Danh mục → brand).
const ASSIGN = '/users/assign';

export async function assignBrand(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requirePerm('catalog.edit');
  const userId = str(fd, 'userId');
  const role = str(fd, 'role');
  const brandIds = fd.getAll('brandId').map(String).filter(Boolean);
  if (!userId || !brandIds.length) return 'Chọn người và ít nhất một brand.';
  if (!BRAND_ROLES.includes(role)) return 'Vai trò không hợp lệ.';
  await db.brandMember.createMany({ data: brandIds.map((brandId) => ({ brandId, userId, role })), skipDuplicates: true });
  await audit(me.id, 'User', userId, `Giao ${brandIds.length} brand (${role})`, { brandIds });
  revalidatePath(ASSIGN);
  redirect(`${ASSIGN}#u-${userId}`);
}

export async function unassignBrand(fd: FormData) {
  const me = await requirePerm('catalog.edit');
  const key = { brandId: str(fd, 'brandId'), userId: str(fd, 'userId'), role: str(fd, 'role') };
  await db.brandMember.deleteMany({ where: key });
  await audit(me.id, 'User', key.userId, `Bỏ phân công brand (${key.role})`, key);
  revalidatePath(ASSIGN);
}

/** Bàn giao: brand phụ trách, job đang chạy, dòng plan từ tháng này, KOC phụ trách của một người sang người khác. */
export async function handover(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requirePerm('catalog.edit');
  const fromId = str(fd, 'fromId');
  const toId = str(fd, 'toId');
  const parts = new Set(fd.getAll('part').map(String));
  const lock = fd.get('lock') === 'on' && me.role === 'ADMIN' && fromId !== me.id;
  if (!toId || toId === fromId) return 'Chọn người nhận bàn giao.';
  if (!parts.size && !lock) return 'Chọn ít nhất một mục để bàn giao.';
  const [from, to] = await Promise.all([db.user.findUnique({ where: { id: fromId } }), db.user.findUnique({ where: { id: toId } })]);
  if (!from || !to?.active) return 'Người nhận không còn hoạt động.';
  const w = handoverWhere(fromId);
  const moved = await db.$transaction(async (tx) => {
    const r: Record<string, number> = {};
    if (parts.has('brands')) {
      const rows = await tx.brandMember.findMany({ where: { userId: fromId } });
      await tx.brandMember.createMany({ data: rows.map((m) => ({ ...m, userId: toId })), skipDuplicates: true });
      r.brands = (await tx.brandMember.deleteMany({ where: { userId: fromId } })).count;
    }
    if (parts.has('jobs')) r.jobs = (await tx.job.updateMany({ where: w.jobs, data: { picId: toId } })).count;
    if (parts.has('lines')) r.lines = (await tx.planLine.updateMany({ where: w.lines, data: { picId: toId } })).count;
    if (parts.has('kocs')) r.kocs = (await tx.koc.updateMany({ where: w.kocs, data: { picId: toId } })).count;
    if (lock) await tx.user.update({ where: { id: fromId }, data: { active: false } });
    return r;
  });
  await audit(me.id, 'User', fromId, `Bàn giao cho ${to.name ?? to.larkUserId}${lock ? ', khoá tài khoản' : ''}`, { toId, ...moved });
  revalidatePath(ASSIGN);
  redirect(`${ASSIGN}?done=${encodeURIComponent(`Đã bàn giao từ ${from.name ?? from.larkUserId} cho ${to.name ?? to.larkUserId}: ${moved.brands ?? 0} phân công brand, ${moved.jobs ?? 0} job, ${moved.lines ?? 0} dòng plan, ${moved.kocs ?? 0} KOC${lock ? '; đã khoá tài khoản' : ''}.`)}`);
}
