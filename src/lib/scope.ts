// Phạm vi dữ liệu (như filterScoped* của app b2c): ai không có quyền "Xem dữ liệu mọi brand" chỉ thấy Plan, Job, Listing,
// Booking, Thanh toán của brand mình được giao (Danh mục → nhân sự phụ trách) và việc mình là PIC / người tạo.
// Danh bạ KOC, Dữ liệu, Danh mục, Creator matching vẫn xem chung.
import 'server-only';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { db } from './db';
import { bookingWhere } from './bookings';
import { brandKey } from './listing';
import { can, type Me } from './session';

/** null = xem tất cả. Booking / Listing lưu brand bằng chữ nên giữ sẵn các cách viết tên brand khớp brandKey. */
export type Scope = { userId: string; name: string | null; brandIds: string[]; bookingBrands: string[]; listingBrands: string[] } | null;

const load = cache(async (userId: string, name: string | null): Promise<Scope> => {
  const brands = await db.brand.findMany({ where: { members: { some: { userId } } }, select: { id: true, name: true } });
  const keys = new Set(brands.map((b) => brandKey(b.name)));
  const spellings = (rows: { brand: string | null }[]) => rows.map((r) => r.brand!).filter((b) => keys.has(brandKey(b)));
  const [bookings, listings] = keys.size
    ? await Promise.all([
        db.booking.findMany({ where: { brand: { not: null } }, distinct: ['brand'], select: { brand: true } }),
        db.listingBatch.findMany({ where: { brand: { not: null } }, distinct: ['brand'], select: { brand: true } }),
      ])
    : [[], []];
  return { userId, name, brandIds: brands.map((b) => b.id), bookingBrands: spellings(bookings), listingBrands: spellings(listings) };
});

export const scopeOf = (me: Me): Promise<Scope> => (can(me, 'data.all') ? Promise.resolve(null) : load(me.id, me.name));

// Điều kiện where theo phạm vi; {} khi xem tất cả. Dùng trong AND để không đè điều kiện lọc khác.
export const jobScope = (s: Scope): Prisma.JobWhereInput => (s ? { OR: [{ brandId: { in: s.brandIds } }, { picId: s.userId }, { createdById: s.userId }] } : {});
export const lineScope = (s: Scope): Prisma.PlanLineWhereInput => (s ? { OR: [{ brandId: { in: s.brandIds } }, { picId: s.userId }] } : {});
export const planScope = (s: Scope): Prisma.PlanWhereInput => (s ? { OR: [{ lines: { some: lineScope(s) } }, { createdById: s.userId }] } : {});
export const listingScope = (s: Scope): Prisma.ListingBatchWhereInput => (s ? { OR: [{ brand: { in: s.listingBrands } }, { createdById: s.userId }] } : {});
export const paymentScope = (s: Scope): Prisma.PaymentRequestWhereInput => (s ? { OR: [{ createdById: s.userId }, { jobs: { some: jobScope(s) } }] } : {});
export const bookingScope = (s: Scope): Prisma.BookingWhereInput =>
  s ? { OR: [{ brand: { in: s.bookingBrands } }, ...(s.name ? [bookingWhere({ person: s.name })] : [])] } : {};

/** Chặn thao tác (server action / route) trên bản ghi ngoài phạm vi: server action gọi được trực tiếp, không chỉ qua giao diện. */
export async function guard(me: Me, kind: 'job' | 'listing' | 'item' | 'payment' | 'line' | 'booking', id: string) {
  const s = await scopeOf(me);
  if (!s) return;
  const n = await {
    job: () => db.job.count({ where: { id, AND: [jobScope(s)] } }),
    listing: () => db.listingBatch.count({ where: { id, AND: [listingScope(s)] } }),
    item: () => db.listingItem.count({ where: { id, batch: listingScope(s) } }),
    payment: () => db.paymentRequest.count({ where: { id, AND: [paymentScope(s)] } }),
    line: () => db.planLine.count({ where: { id, AND: [lineScope(s)] } }),
    booking: () => db.booking.count({ where: { id, AND: [bookingScope(s)] } }),
  }[kind]();
  if (!n) notFound();
}
