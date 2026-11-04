// Listing: mỗi dòng KOC tự điền theo sheet "[Booking] - Requirement Excel Listing (UpAI)" (tab Excel Listing _ Final).
import { db } from './db';
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

export async function loadListing(batchId: string) {
  const batch = await db.listingBatch.findUnique({
    where: { id: batchId },
    include: { createdBy: true, items: { include: { koc: true, createdBy: true }, orderBy: { createdAt: 'asc' } } },
  });
  if (!batch) return null;
  const bookings = await bookingsOf(batch.items.map((i) => i.koc.handle));
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
    return { item, koc: k, kl, collab, p, viewTarget, viewTargetManual: item.viewTarget != null, price, f, gmv30 };
  });
  return { batch, rows };
}

export type ListingRow = NonNullable<Awaited<ReturnType<typeof loadListing>>>['rows'][number];

export const gpmVnd = (gpmUsd: number | null) => (gpmUsd == null ? null : gpmUsd * USD_VND);
