// Listing: mỗi dòng KOC tự điền theo sheet "[Booking] - Requirement Excel Listing (UpAI)" (tab Excel Listing _ Final).
import { db } from './db';
import { fmtPct } from './format';
import { bookingsOf, collabSummary, defaultViewTarget, forecast, profileInsights, USD_VND } from './kocInsights';

// Lựa chọn lấy từ tab "Excel Listing _ Final" và "Các loại giá".
export const PRICE_TYPES = [
  'Video', 'Phiên livestream', 'Post', 'Cấp mã Ads lần đầu', 'Gắn giỏ hàng/link sản phẩm vào video/post', 'Gắn giỏ Showcase',
  'Gia hạn mã Ads', 'SDHA của video', 'SDHA của KOC/KOL', 'Video reup gắn giỏ nền tảng khác',
];
export const CONTACT_STATUS = ['Đang liên hệ', 'Không phản hồi', 'Nhận sản phẩm', 'Trải nghiệm sản phẩm'];
export const RECOMMEND = ['Must Have', 'Recommend', 'Optional'];
export const BRAND_CHOICE = ['Yes', 'No', 'Cân nhắc'];

/** "@abc", "abc", "https://www.tiktok.com/@abc/video/1?q=" → "abc". Không hợp lệ → null. */
export function parseHandle(s: string): string | null {
  const t = s.trim();
  const m = t.match(/tiktok\.com\/@([A-Za-z0-9._]+)/i) ?? t.match(/^@?([A-Za-z0-9._]{2,24})$/);
  return m ? m[1].toLowerCase() : null;
}

/** "pH Care", "pHCare", "PH CARE" là một brand. */
export const sameBrand = (a?: string | null, b?: string | null) => {
  const n = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return Boolean(n(a)) && n(a) === n(b);
};
const prevMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}/12` : `${y}/${String(mo - 1).padStart(2, '0')}`;
};

export async function loadListing(batchId: string) {
  const batch = await db.listingBatch.findUnique({
    where: { id: batchId },
    include: { createdBy: true, items: { include: { koc: true, createdBy: true }, orderBy: { createdAt: 'asc' } } },
  });
  if (!batch) return null;
  const [bookings, others] = await Promise.all([
    bookingsOf(batch.items.map((i) => i.koc.handle)),
    // List trùng: cùng KOC ở đợt listing khác cùng tháng (2 người cùng liên hệ một KOC).
    db.listingItem.findMany({
      where: { kocId: { in: batch.items.map((i) => i.kocId) }, batchId: { not: batch.id }, batch: { month: batch.month } },
      select: { kocId: true, batch: { select: { name: true, createdBy: { select: { name: true } } } } },
    }),
  ]);
  // ...hoặc đã có booking cùng brand ở tháng plan này / tháng trước.
  const months = [batch.month.replace('-', '/'), prevMonth(batch.month)];
  const rows = batch.items.map((item) => {
    const k = item.koc;
    const collab = collabSummary(bookings.get(k.handle) ?? [], item.priceType);
    const p = profileInsights(k.ttsProfile);
    const kl = k.kl ?? collab.kl;
    const viewTarget = item.viewTarget ?? defaultViewTarget({ kl, avgViews: k.avgViews, gpmUsd: k.gpmUsd, unitsSold: k.unitsSold });
    const price = item.price ?? collab.lastPrice;
    const f = forecast({ viewTarget, gpmUsd: k.gpmUsd, cr: batch.cr, aov: batch.aov, price });
    // "Doanh số ước tính 30 ngày" = GMV / khách × số món bán (spec); có GMV chính xác thì dùng luôn.
    const gmv30 = p.gmvExactVnd ?? (p.aovMid && k.unitsSold ? p.aovMid * k.unitsSold : null);
    const dup = [
      ...others.filter((o) => o.kocId === k.id).map((o) => `Ở đợt "${o.batch.name}" (${o.batch.createdBy.name ?? '—'})`),
      ...(bookings.get(k.handle) ?? []).filter((b) => sameBrand(b.brand, batch.brand) && months.includes(b.planMonth ?? ''))
        .map((b) => `Đã book ${b.brand} tháng ${b.planMonth}: ${b.code} (${b.pipeline ?? '—'})`),
    ];
    return { item, koc: k, kl, collab, p, viewTarget, viewTargetManual: item.viewTarget != null, price, f, gmv30, dup };
  });
  return { batch, rows };
}

export type ListingRow = NonNullable<Awaited<ReturnType<typeof loadListing>>>['rows'][number];

export const gpmVnd = (gpmUsd: number | null) => (gpmUsd == null ? null : gpmUsd * USD_VND);

const vnDate = (d: Date | null) => (d ? d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');
const round = (n: number | null) => (n == null ? '' : Math.round(n));

// Thứ tự cột theo tab "Excel Listing _ Final". personal = không xuất cho Brand; bank = chỉ Admin / Leader.
export const COL_GROUPS = {
  meta: 'Người & ngày điền', batch: 'Thông tin đợt', koc: 'Thông tin KOC', price: 'Giá & phê duyệt', perf: 'Hiệu quả',
  audience: 'Tỷ trọng & khán giả', plan: 'Kế hoạch & dự báo', contact: 'Liên hệ & nhận hàng', bank: 'Thanh toán',
} as const;
export type Col = { h: string; g: keyof typeof COL_GROUPS; v: (r: ListingRow) => string | number | null | undefined; personal?: boolean; bank?: boolean };
export const COLS: Col[] = [
  { h: 'Ngày điền', g: 'meta', v: (r) => vnDate(r.item.createdAt) },
  { h: 'Tháng', g: 'meta', v: (r) => r.item.createdAt.toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }) },
  { h: 'Nhân sự điền', g: 'meta', v: (r) => r.item.createdBy.name },
  { h: 'Đợt listing', g: 'batch', v: () => '' }, // điền ở dưới theo đợt
  { h: 'Store', g: 'batch', v: () => '' },
  { h: 'Sản phẩm', g: 'batch', v: () => '' },
  { h: 'ID kênh', g: 'koc', v: (r) => r.koc.handle },
  { h: 'Tên người ảnh hưởng (Tên kênh)', g: 'koc', v: (r) => r.koc.nickname ?? r.koc.name },
  { h: 'Link kênh', g: 'koc', v: (r) => r.koc.channelUrl ?? `https://www.tiktok.com/@${r.koc.handle}` },
  { h: 'Follower', g: 'koc', v: (r) => r.koc.followers },
  { h: 'Tệp kênh', g: 'koc', v: (r) => r.koc.niche },
  { h: 'Tệp Booking', g: 'koc', v: (r) => r.kl },
  { h: 'Giá đã hợp tác trước đó (Giá dự kiến)', g: 'price', v: (r) => round(r.collab.lastPrice) },
  { h: 'Loại giá', g: 'price', v: (r) => r.item.priceType },
  { h: 'Giá net video', g: 'price', v: (r) => round(r.price) },
  { h: 'Phí booking kèm thuế TNCN', g: 'price', v: (r) => round(r.f.fee) },
  { h: 'Trạng thái', g: 'price', v: (r) => r.item.status },
  { h: 'Đề xuất từ UpBase', g: 'price', v: (r) => r.item.recommendation },
  { h: 'Content note', g: 'price', v: (r) => r.item.contentNote },
  { h: 'Brand chọn', g: 'price', v: (r) => r.item.brandChoice },
  { h: 'Lý do từ chối', g: 'price', v: (r) => r.item.rejectReason },
  { h: 'Thành quả hợp tác với UB', g: 'perf', v: (r) => (r.collab.count ? `${r.collab.count} booking; ${r.collab.brands.slice(0, 5).join(', ')}${r.collab.best ? `; GMV 30 ngày tốt nhất ${Math.round(r.collab.best.gmv30)} (${r.collab.best.code})` : ''}` : '') },
  { h: 'Thành quả hợp tác với brand ngoài', g: 'perf', v: (r) => (r.p.brandCount != null ? `${r.p.brandCount} brand đã hợp tác; GMV ${r.koc.gmvRange ?? '—'}` : '') },
  { h: 'Doanh số (nếu có)', g: 'perf', v: (r) => round(r.p.gmvExactVnd) },
  { h: 'Doanh số ước tính trong 30 ngày', g: 'perf', v: (r) => round(r.gmv30) },
  { h: 'Số món bán ra', g: 'perf', v: (r) => r.koc.unitsSold },
  { h: 'GPM', g: 'perf', v: (r) => round(r.f.gpmVnd) },
  { h: 'GMV từ mỗi khách hàng/ AOV', g: 'perf', v: (r) => r.p.aovText },
  { h: 'View trung bình video/ trung vị video', g: 'perf', v: (r) => r.koc.avgViews },
  { h: 'Cost per view', g: 'perf', v: (r) => (r.f.cpv == null ? '' : Math.round(r.f.cpv * 10) / 10) },
  { h: 'Tỉ trọng GMV từ video', g: 'audience', v: (r) => fmtPct(r.p.gmvVideo) },
  { h: 'Tỉ trọng GMV từ Live', g: 'audience', v: (r) => fmtPct(r.p.gmvLive) },
  { h: 'Tỉ trọng GMV từ thẻ sản phẩm', g: 'audience', v: (r) => fmtPct(r.p.gmvShowcase) },
  { h: 'Tỉ trọng ngành hàng', g: 'audience', v: (r) => r.p.categories.map((c) => `${c.name} ${fmtPct(c.share)}`).join('; ') },
  { h: 'Tỉ trọng Nam', g: 'audience', v: (r) => fmtPct(r.p.male) },
  { h: 'Tỉ trọng Nữ', g: 'audience', v: (r) => fmtPct(r.p.female) },
  { h: 'Tỉ trọng 18-24', g: 'audience', v: (r) => fmtPct(r.p.age18_24) },
  { h: 'Tỉ trọng 25-34', g: 'audience', v: (r) => fmtPct(r.p.age25_34) },
  { h: 'Location', g: 'audience', v: (r) => r.p.locations.map((l) => `${l.name} ${fmtPct(l.share)}`).join('; ') },
  { h: 'Ngày air plan', g: 'plan', v: (r) => vnDate(r.item.planAirDate) },
  { h: 'GMV Target', g: 'plan', v: (r) => round(r.f.gmvTarget) },
  { h: 'View trung vị', g: 'plan', v: () => '' }, // TikTok Shop API chưa có view video không gắn giỏ
  { h: 'CTR', g: 'plan', v: (r) => (r.f.ctr == null ? '' : fmtPct(r.f.ctr, 2)) },
  { h: 'CR', g: 'batch', v: () => '' },
  { h: 'View Target', g: 'plan', v: (r) => r.viewTarget },
  { h: 'Tỷ lệ tương tác', g: 'audience', v: (r) => fmtPct(r.p.engagement, 2) },
  { h: 'Email', g: 'contact', v: (r) => r.koc.email, personal: true },
  { h: 'Zalo', g: 'contact', v: (r) => r.koc.zalo, personal: true },
  { h: 'Người nhận hàng', g: 'contact', v: (r) => r.koc.receiverName, personal: true },
  { h: 'SĐT nhận hàng', g: 'contact', v: (r) => r.koc.receiverPhone, personal: true },
  { h: 'Địa chỉ nhận hàng', g: 'contact', v: (r) => r.koc.address, personal: true },
  { h: 'Tên tài khoản ngân hàng', g: 'bank', v: (r) => r.koc.bankHolder, personal: true, bank: true },
  { h: 'Số tài khoản', g: 'bank', v: (r) => r.koc.bankAccount, personal: true, bank: true },
  { h: 'Ngân hàng', g: 'bank', v: (r) => r.koc.bankName, personal: true, bank: true },
  { h: 'Số CCCD', g: 'bank', v: (r) => r.koc.idNumber, personal: true, bank: true },
];
