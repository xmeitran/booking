// Truy vấn dùng chung cho tab Booking, trang chi tiết và Tổng quan.
import type { Prisma } from '@prisma/client';

// Thứ tự chặng theo cột Pipeline_text trên Lark.
export const PIPELINE = ['Gửi hàng', 'Tạm ứng', 'Demo', 'On Air', 'Làm ĐNTT', 'Done'];
export const PIPELINE_TONE: Record<string, string> = { Done: 'bg-positive-soft text-positive', 'On Air': 'bg-accent-soft text-accent', 'Làm ĐNTT': 'bg-warning-soft text-warning' };

// Phiếu bị trả / thu hồi mà chưa được duyệt lại.
export const isPayIssue = (s: string | null) => Boolean(s && /Rejected|Recalled/.test(s) && !/Approved/.test(s));

const startOfToday = () => new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) + 'T00:00:00+07:00');

// Lọc nhanh. Cờ "Cảnh báo trễ SLA" của Lark bật cả ở booking cũ đứng chặng, nên luôn loại booking đã Done.
export const FLAGS: Record<string, { label: string; where: () => Prisma.BookingWhereInput }> = {
  airLate: {
    label: 'Trễ air',
    where: () => ({ airDate: null, planAirDate: { lt: startOfToday() }, pipeline: { notIn: ['Làm ĐNTT', 'Done'] } }),
  },
  noLink: {
    label: 'Đã air thiếu link',
    where: () => ({ airDate: { not: null }, OR: [{ linkAir: null }, { NOT: { linkAir: { startsWith: 'http' } } }] }),
  },
  sla: { label: 'Cảnh báo SLA', where: () => ({ slaLate: true, NOT: { pipeline: 'Done' } }) },
  payIssue: { label: 'Phiếu TT bị trả / thu hồi', where: () => ({ OR: [{ paymentStatus: { contains: 'Rejected' } }, { paymentStatus: { contains: 'Recalled' } }], NOT: { paymentStatus: { contains: 'Approved' } } }) },
  payment: { label: 'Chờ ĐNTT', where: () => ({ pipeline: 'Làm ĐNTT' }) },
};

export type BookingFilters = { q?: string; month?: string; brand?: string; pipeline?: string; owner?: string; person?: string; flag?: string };

export function bookingWhere(f: BookingFilters): Prisma.BookingWhereInput {
  const q = f.q?.trim();
  const contains = { contains: q, mode: 'insensitive' as const };
  return {
    AND: [
      f.month ? { planMonth: f.month } : {},
      f.brand ? { brand: f.brand } : {},
      f.pipeline ? { pipeline: f.pipeline } : {},
      f.owner ? { owner: f.owner } : {},
      // Việc của một người: phụ trách, hoặc có tên trong Booking PIC / Account PIC / Leader (Lark ghi nhiều tên cách dấu phẩy).
      f.person ? { OR: [{ owner: f.person }, { bookingPic: { contains: f.person } }, { accountPic: { contains: f.person } }, { leader: { contains: f.person } }] } : {},
      q ? { OR: [{ code: contains }, { channel: contains }, { store: contains }, { brand: contains }] } : {},
      f.flag && FLAGS[f.flag] ? FLAGS[f.flag].where() : {},
    ],
  };
}
