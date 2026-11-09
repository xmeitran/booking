// Xuất Excel (CSV) dữ liệu KOC: dùng cho Danh bạ (theo bộ lọc) và Creator matching (danh sách khớp tiêu chí).
import type { Koc, User } from '@prisma/client';
import { fmtPct } from './format';
import { profileInsights, USD_VND } from './kocInsights';

type K = Koc & { pic: Pick<User, 'name'> | null };
const vnDate = (d: Date | null) => (d ? d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');

// bank: chỉ Admin / Leader. Liên hệ và địa chỉ nhận hàng đã hiện cho mọi vai trò trong app nên xuất luôn.
const COLS: { h: string; v: (k: K, p: ReturnType<typeof profileInsights>) => unknown; bank?: boolean }[] = [
  { h: 'ID kênh', v: (k) => k.handle },
  { h: 'Tên kênh', v: (k) => k.nickname ?? k.name },
  { h: 'Link kênh', v: (k) => k.channelUrl ?? `https://www.tiktok.com/@${k.handle}` },
  { h: 'Nền tảng', v: (k) => k.platform },
  { h: 'Tệp kênh', v: (k) => k.niche },
  { h: 'Ngành hàng', v: (k) => k.category },
  { h: 'Cấp KOL', v: (k) => k.kl ?? k.klAuto },
  { h: 'Follower', v: (k) => k.followers },
  { h: 'View TB / video bán hàng', v: (k) => k.avgViews },
  { h: 'View TB / LIVE', v: (k) => k.avgLiveViews },
  { h: 'Số món bán 30 ngày', v: (k) => k.unitsSold },
  { h: 'GMV 30 ngày', v: (k, p) => p.gmvExactVnd ?? k.gmvRange },
  { h: 'GPM (₫)', v: (k) => (k.gpmUsd == null ? '' : Math.round(k.gpmUsd * USD_VND)) },
  { h: 'GMV / khách', v: (_, p) => p.aovText },
  { h: 'Tỷ trọng nữ', v: (_, p) => fmtPct(p.female) },
  { h: 'Tỷ trọng 18-24', v: (_, p) => fmtPct(p.age18_24) },
  { h: 'Tỷ trọng 25-34', v: (_, p) => fmtPct(p.age25_34) },
  { h: 'Location', v: (_, p) => p.locations.map((l) => `${l.name} ${fmtPct(l.share)}`).join('; ') },
  { h: 'Ngành hàng TikTok', v: (_, p) => p.categories.map((c) => `${c.name} ${fmtPct(c.share)}`).join('; ') },
  { h: 'Tỷ lệ tương tác', v: (_, p) => fmtPct(p.engagement, 2) },
  { h: 'Số TikTok cập nhật', v: (k) => vnDate(k.statsAt) },
  { h: 'Số booking với UB', v: (k) => k.bookingCount },
  { h: 'Book gần nhất', v: (k) => vnDate(k.lastBookingAt) },
  { h: 'Giá tham khảo / video', v: (k) => k.rateCard },
  { h: 'PIC', v: (k) => k.pic?.name },
  { h: 'SĐT', v: (k) => k.phone },
  { h: 'Zalo', v: (k) => k.zalo },
  { h: 'Email', v: (k) => k.email },
  { h: 'Người nhận hàng', v: (k) => k.receiverName },
  { h: 'SĐT nhận hàng', v: (k) => k.receiverPhone },
  { h: 'Địa chỉ nhận hàng', v: (k) => k.address },
  { h: 'Ghi chú', v: (k) => k.note },
  { h: 'Chủ tài khoản', v: (k) => k.bankHolder, bank: true },
  { h: 'Số tài khoản', v: (k) => k.bankAccount, bank: true },
  { h: 'Ngân hàng', v: (k) => k.bankName, bank: true },
  { h: 'CCCD / MST', v: (k) => k.idNumber, bank: true },
];

/** Tiêu đề + dòng cho csvResponse. extra: cột thêm ở đầu (vd "Khớp tiêu chí" của matching). */
export function kocTable(kocs: K[], bank: boolean, extra: { h: string; v: (k: K) => unknown }[] = []) {
  const cols = COLS.filter((c) => bank || !c.bank);
  return {
    header: [...extra.map((e) => e.h), ...cols.map((c) => c.h)],
    rows: kocs.map((k) => {
      const p = profileInsights(k.ttsProfile);
      return [...extra.map((e) => e.v(k)), ...cols.map((c) => c.v(k, p))];
    }),
  };
}
