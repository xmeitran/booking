// Kiểm soát nhập liệu trên Lark Base: booking điền thiếu / sai khiến app không khớp được KOL, không tính được chi phí.
// Chỉ xét booking gần đây (air / dự kiến air trong 60 ngày qua trở đi, hoặc tháng plan từ 2 tháng trước), để danh sách là
// việc còn sửa được. Không lọc theo ngày sửa trên Lark: Lark đổi ngày sửa của mọi dòng mỗi khi cột công thức tính lại.
import { Prisma } from '@prisma/client';
import { db } from './db';

export const QUALITY_DAYS = 60;

export const CHECKS: { key: string; label: string; hint: string; where: Prisma.Sql }[] = [
  {
    key: 'badChannel', label: 'ID kênh TikTok sai định dạng', hint: 'Có dấu cách, dấu tiếng Việt, tên người…: không khớp Danh bạ, không tra được TikTok (bỏ qua VJ, CTV, Facebook…)',
    where: Prisma.sql`channel is not null and channel !~* '^[a-z0-9._]{2,24}$' and coalesce(extra->>'platform', 'TikTok') = 'TikTok'`,
  },
  { key: 'noChannel', label: 'Thiếu ID kênh', hint: 'Không biết booking của KOL nào', where: Prisma.sql`channel is null` },
  { key: 'noCost', label: 'Thiếu chi phí', hint: 'Chi phí trống hoặc 0', where: Prisma.sql`coalesce(cost, 0) = 0` },
  { key: 'noMonth', label: 'Thiếu tháng plan', hint: 'Không vào được KPI tháng ở Tổng quan', where: Prisma.sql`"planMonth" is null` },
  { key: 'noOwner', label: 'Thiếu người phụ trách', hint: 'Không vào "Việc của bạn" của ai', where: Prisma.sql`owner is null` },
  {
    key: 'dup', label: 'Nghi trùng: cùng kênh, brand, tháng plan', hint: 'Có thể là 2 video thật; kiểm tra lại nếu không phải',
    where: Prisma.sql`(lower(channel), brand, "planMonth") in (
      select lower(channel), brand, "planMonth" from "Booking" where channel is not null and brand is not null and "planMonth" is not null
      group by 1, 2, 3 having count(*) > 1)`,
  },
];

const recent = Prisma.sql`(coalesce("airDate", "planAirDate") >= now() - make_interval(days => ${QUALITY_DAYS}::int)
  or "planMonth" >= to_char(now() - interval '2 months', 'YYYY/MM'))`;

export type QualityRow = { id: string; code: string; channel: string | null; brand: string | null; owner: string | null; planMonth: string | null; cost: number | null };

export async function qualityCounts() {
  return Promise.all(CHECKS.map(async (c) => {
    const [r] = await db.$queryRaw<{ n: number }[]>`select count(*)::int n from "Booking" where ${recent} and ${c.where}`;
    return { ...c, n: r.n };
  }));
}

export function qualityRows(key: string, limit = 500) {
  const c = CHECKS.find((x) => x.key === key);
  if (!c) return null;
  return db.$queryRaw<QualityRow[]>`
    select id, code, channel, brand, owner, "planMonth", cost from "Booking" where ${recent} and ${c.where}
    order by lower(channel), brand, "larkUpdatedAt" desc limit ${limit}`;
}
