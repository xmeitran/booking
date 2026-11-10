// Liên hệ, giá, PIC của KOC từ 2 bảng KOC trên Lark Base B2C_Quản lý Booking (3.4 KOCs tổng hợp, 3.4 List KOCs tổng hợp).
// Chỉ điền ô đang trống ở Danh bạ (sửa tay không bị ghi đè), như CCCD / số TK lấy từ booking (bookingSync.fillBankInfo).
// Chạy trong lượt đồng bộ booking mỗi giờ. Lark không có địa chỉ nhận mẫu (cột trống), phần đó nhập trong app.
import { db } from './db';
import { toText, searchPages } from './bookingSync';
import { parseHandle } from './listing';
import { matchUser, people } from './masterSync';
import { phoneVN } from './validate';

const KOCS = 'tblTzGxo27dWxfjT'; // 3.4 KOCs tổng hợp
const KOCS_LIST = 'tblY8408KFBMJVFw'; // 3.4 List KOCs tổng hợp
const F1 = { channel: 'ID kênh', link: 'Link kênh', zalo: 'Zalo', email: 'Email', pic: 'PIC', price: 'Giá booking gần nhất' } as const;
const F2 = { link: '🎃Link kênh', price: 'Giá net video' } as const;

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[a-z]{2,}$/i;
/** Handle từ link kênh TikTok, không có thì từ cột ID kênh (bỏ @, khoảng trắng như booking). */
export const handleOf = (link: string | null, id: string | null) =>
  (link && parseHandle(link)) || id?.split(', ')[0]?.trim().replace(/^@/, '').toLowerCase() || null;
/** Zalo trên Lark lẫn "0", "zl", "."...: chỉ nhận số điện thoại VN hợp lệ. */
export const phoneOf = (raw: string | null) => (raw ? phoneVN(raw.split(/[,;/]/)[0].trim()) ?? null : null);
export const emailOf = (raw: string | null) => {
  const e = raw?.split(/[,;\s]+/).find((x) => EMAIL.test(x));
  return e ? e.toLowerCase() : null;
};
const priceOf = (raw: string | null) => {
  const n = Math.round(Number(raw?.split(', ')[0]));
  return Number.isFinite(n) && n > 0 ? n : null;
};

type Row = { phone: string | null; email: string | null; picId: string | null; rate: number | null };


export async function syncKocContacts(token: string) {
  const opts = new Map<string, string>();
  const users = await db.user.findMany({ where: { active: true }, select: { id: true, larkUserId: true, name: true } });
  const alias = new Map((await db.kocAlias.findMany({ select: { handle: true, koc: { select: { handle: true } } } })).map((a) => [a.handle, a.koc.handle]));
  const canon = (h: string | null) => (h ? alias.get(h) ?? h : null);
  const rows = new Map<string, Row>();
  const row = (h: string) => rows.get(h) ?? (rows.set(h, { phone: null, email: null, picId: null, rate: null }), rows.get(h)!);

  for await (const page of searchPages(KOCS, Object.values(F1), token)) {
    for (const r of page) {
      const f = r.fields;
      const h = canon(handleOf(toText(f[F1.link], opts), toText(f[F1.channel], opts)));
      if (!h) continue;
      const x = row(h);
      x.phone ??= phoneOf(toText(f[F1.zalo], opts));
      x.email ??= emailOf(toText(f[F1.email], opts));
      x.picId ??= people(f[F1.pic]).map((p) => matchUser(users, p)?.id).find(Boolean) ?? null;
      x.rate ??= priceOf(toText(f[F1.price], opts));
    }
  }
  // Giá net video (bảng List) ưu tiên hơn "giá booking gần nhất".
  for await (const page of searchPages(KOCS_LIST, Object.values(F2), token)) {
    for (const r of page) {
      const h = canon(handleOf(toText(r.fields[F2.link], opts), null));
      const price = priceOf(toText(r.fields[F2.price], opts));
      if (h && price) row(h).rate = price;
    }
  }

  return fillKocContacts(rows);
}

export type ContactFill = { phone?: string | null; email?: string | null; picId?: string | null; rate?: number | null; address?: string | null };
/** Điền liên hệ / PIC / giá / địa chỉ nhận mẫu vào Danh bạ theo handle, chỉ ô đang trống. Trả số ô điền thêm. */
export async function fillKocContacts(rows: Map<string, ContactFill>) {
  const list = [...rows].filter(([, v]) => v.phone || v.email || v.picId || v.rate || v.address);
  if (!list.length) return { phone: 0, email: 0, pic: 0, rate: 0, address: 0 };
  const count = () => db.koc.aggregate({ _count: { phone: true, email: true, picId: true, rateCard: true, address: true } });
  const before = await count();
  const col = <K extends keyof ContactFill>(k: K) => list.map(([, v]) => v[k] ?? null);
  await db.$executeRaw`
    update "Koc" k set
      phone = coalesce(k.phone, v.phone), zalo = coalesce(k.zalo, v.phone), email = coalesce(k.email, v.email),
      "picId" = coalesce(k."picId", v.pic), "rateCard" = coalesce(k."rateCard", v.rate), address = coalesce(k.address, v.address)
    from unnest(${list.map(([h]) => h)}::text[], ${col('phone')}::text[], ${col('email')}::text[], ${col('picId')}::text[],
                ${col('rate')}::int[], ${col('address')}::text[]) as v(h, phone, email, pic, rate, address)
    where k.handle = v.h and k.platform = 'TikTok'
      and (k.phone is null or k.zalo is null or k.email is null or k."picId" is null or k."rateCard" is null or k.address is null)`;
  const after = await count();
  return {
    phone: after._count.phone - before._count.phone, email: after._count.email - before._count.email, pic: after._count.picId - before._count.picId,
    rate: after._count.rateCard - before._count.rateCard, address: after._count.address - before._count.address,
  };
}
