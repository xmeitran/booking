// Bộ lọc Danh bạ, dùng chung cho trang và nút tải Excel.
import type { Prisma } from '@prisma/client';

export type KocFilters = { q?: string; platform?: string; niche?: string; kl?: string; flag?: string };

const endOfToday = () => new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) + 'T23:59:59+07:00');
// Lọc nhanh: việc cần làm với hồ sơ KOL.
export const FLAGS: Record<string, { label: string; where: () => Prisma.KocWhereInput }> = {
  followUp: { label: 'Đến hẹn liên hệ', where: () => ({ notes: { some: { doneAt: null, followUpAt: { lte: endOfToday() } } } }) },
  noPic: { label: 'Chưa có PIC', where: () => ({ picId: null }) },
  noStats: { label: 'Chưa có số TikTok', where: () => ({ statsAt: null }) },
  noContact: { label: 'Thiếu liên hệ', where: () => ({ phone: null, zalo: null, email: null }) },
  noShip: { label: 'Thiếu địa chỉ nhận hàng', where: () => ({ OR: [{ receiverName: null }, { address: null }] }) },
  noBank: { label: 'Thiếu thông tin thanh toán', where: () => ({ OR: [{ bankAccount: null }, { idNumber: null }] }) },
};

/** Điều kiện trừ lọc nhanh (để đếm số cho từng chip). */
export function kocBase({ q = '', platform, niche, kl }: KocFilters): Prisma.KocWhereInput[] {
  const contains = { contains: q.trim(), mode: 'insensitive' as const };
  return [
    platform ? { platform } : {},
    niche ? { niche } : {},
    kl ? { OR: [{ kl }, { kl: null, klAuto: kl }] } : {}, // cấp nhập tay, trống thì theo booking gần nhất
    q.trim() ? { OR: [{ name: contains }, { handle: contains }, { phone: contains }, { zalo: contains }, { email: contains }] } : {},
  ];
}

export const kocWhere = (f: KocFilters): Prisma.KocWhereInput => ({ AND: [...kocBase(f), f.flag && FLAGS[f.flag] ? FLAGS[f.flag].where() : {}] });
