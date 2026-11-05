// Danh mục dùng chung: vai trò nghiệp vụ (theo tài liệu B2C-Ops), checklist nghiệm thu mặc định, audit log.
import type { Prisma } from '@prisma/client';
import { db } from './db';

export const JOB_ROLES = ['Trưởng phòng', 'Booking PIC', 'Booking Support', 'Brand Manager'];
export const BRAND_ROLES = ['Booking PIC', 'Booking Support', 'Brand Manager'];

// Dùng khi brand chưa có checklist riêng (Danh mục → brand → Checklist nghiệm thu).
export const DEFAULT_CHECKLIST = [
  'Nhắc đúng tên brand và tên sản phẩm',
  'Sản phẩm xuất hiện rõ trong video',
  'Nói đúng USP / thông điệp chính trong brief',
  'Không dùng từ cấm, không claim sai (điều trị, cam kết hiệu quả)',
  'Gắn giỏ hàng / link sản phẩm đúng',
  'Đúng định dạng và thời lượng đã thống nhất',
  'Hình ảnh, âm thanh rõ, không lỗi',
];
export const checklistOf = (text: string | null | undefined) => {
  const lines = (text ?? '').split('\n').map((l) => l.replace(/^[-•*\d.)\s]+/, '').trim()).filter(Boolean);
  return lines.length ? lines : DEFAULT_CHECKLIST;
};

/** Ghi lịch sử thay đổi. Không chặn thao tác chính nếu ghi lỗi. */
export const audit = (userId: string | null, entity: string, entityId: string, action: string, detail?: Prisma.InputJsonValue) =>
  db.auditLog.create({ data: { userId, entity, entityId, action, detail } }).catch(() => undefined);
