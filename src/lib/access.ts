// Phân quyền (tham khảo tab "Phân quyền & Cổng truy cập" của app b2c, rút gọn cho Booking Hub):
// - Ma trận vai trò × quyền: Admin luôn có mọi quyền; quyền của Leader / Nhân viên do Admin bật tắt ở /users/roles.
//   Mọi quyền trong danh sách đều được kiểm tra thật trên server (can() trong session.ts).
// - Cổng đăng nhập: người chưa có user mà thuộc phòng ban Lark được cho phép thì tự được tạo user Nhân viên khi đăng nhập.
// Lưu một dòng SyncState id "access-policy" để không phải thêm bảng.
import type { Role } from '@prisma/client';
import { db } from './db';
import { CANCELLED } from './jobs';

export const PERMS = {
  'data.all': { label: 'Xem dữ liệu mọi brand', hint: 'Tắt: chỉ thấy Plan, Job, Listing, Booking, Thanh toán của brand được giao (Danh mục → nhân sự) và việc mình là PIC / người tạo.' },
  'plan.edit': { label: 'Tạo, sửa plan', hint: 'Plan và dòng plan tạo trong app; plan từ Lark luôn chỉ đọc.' },
  'catalog.edit': { label: 'Sửa danh mục, phân công, bàn giao', hint: 'Brand, gian hàng, sản phẩm, bảng giá tier, nhân sự phụ trách brand, bàn giao gian hàng.' },
  'koc.edit': { label: 'Sửa danh bạ KOC', hint: 'Thêm, sửa, gộp, xoá KOC.' },
  'koc.bank': { label: 'Xem số tài khoản, CCCD', hint: 'Ở ĐNTT và trong file xuất.' },
  'payment.approve': { label: 'Duyệt ĐNTT, xác nhận đã thanh toán', hint: '' },
  'data.export': { label: 'Tải file Excel', hint: 'Danh bạ KOC, listing, KOC khớp brief, ĐNTT.' },
  'brief.deleteAny': { label: 'Xoá brief của người khác', hint: 'Người tạo luôn xoá được brief của mình.' },
  'job.delete': { label: 'Xoá job', hint: '' },
} as const;
export type Perm = keyof typeof PERMS;
export const ALL_PERMS = Object.keys(PERMS) as Perm[];
export type EditableRole = Exclude<Role, 'ADMIN'>;
export const EDITABLE_ROLES: EditableRole[] = ['LEADER', 'STAFF'];

export interface AccessPolicy {
  perms: Record<EditableRole, Perm[]>;
  loginDepts: string[]; // tên (một phần) phòng ban Lark được tự cho đăng nhập
}

// Mặc định giữ đúng quyền trước khi có ma trận; riêng Nhân viên chỉ xem brand được giao.
export const DEFAULT_POLICY: AccessPolicy = {
  perms: {
    LEADER: ['data.all', 'plan.edit', 'catalog.edit', 'koc.edit', 'koc.bank', 'payment.approve', 'data.export', 'brief.deleteAny'],
    STAFF: ['data.export'],
  },
  loginDepts: [],
};

const POLICY_ID = 'access-policy';

/** Bản lưu cũ / sai kiểu → điền mặc định, bỏ mã quyền không còn tồn tại. */
export function normalizePolicy(raw: unknown): AccessPolicy {
  const r = (raw ?? {}) as Partial<AccessPolicy>;
  const perms = Object.fromEntries(EDITABLE_ROLES.map((role) => {
    const saved = r.perms?.[role];
    return [role, Array.isArray(saved) ? ALL_PERMS.filter((p) => saved.includes(p)) : DEFAULT_POLICY.perms[role]];
  })) as AccessPolicy['perms'];
  const loginDepts = Array.isArray(r.loginDepts) ? r.loginDepts.filter((d): d is string => typeof d === 'string' && !!d.trim()).map((d) => d.trim()) : [];
  return { perms, loginDepts };
}

export async function readPolicy() {
  return normalizePolicy((await db.syncState.findUnique({ where: { id: POLICY_ID } }))?.data);
}

export async function writePolicy(p: AccessPolicy) {
  const data = { ...normalizePolicy(p) } as object;
  await db.syncState.upsert({ where: { id: POLICY_ID }, create: { id: POLICY_ID, data }, update: { data } });
}

export const permsOf = (role: Role, p: AccessPolicy): Set<Perm> => new Set(role === 'ADMIN' ? ALL_PERMS : p.perms[role]);

/** Phòng ban Lark ("Booking, Marketing B2C") có chứa một trong các tên được phép (không phân biệt hoa thường). */
export function deptAllowed(department: string | null | undefined, allowed: string[]) {
  const d = (department ?? '').toLowerCase();
  return !!d && allowed.some((a) => d.includes(a.toLowerCase()));
}

const vnMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
/** Việc của một người được chuyển khi bàn giao (Phân quyền → Phân công): job đang chạy, dòng plan từ tháng này, KOC phụ trách. */
/** Không truyền userId: điều kiện cho mọi người (đếm theo từng PIC). */
export const handoverWhere = (userId?: string) => {
  const picId = userId ?? { not: null };
  return {
    jobs: { picId, stage: { notIn: ['Thanh toán', CANCELLED] }, paymentId: null },
    lines: { picId, plan: { month: { gte: vnMonth() } } },
    kocs: { picId },
  };
};
