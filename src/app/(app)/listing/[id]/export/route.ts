import { NextRequest } from 'next/server';
import { fmtPct } from '@/lib/format';
import { loadListing, type ListingRow } from '@/lib/listing';
import { requireUser } from '@/lib/session';

const vnDate = (d: Date | null) => (d ? d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');
const round = (n: number | null) => (n == null ? '' : Math.round(n));

// Thứ tự cột theo tab "Excel Listing _ Final". personal = không xuất cho Brand; bank = chỉ Admin / Leader.
type Col = { h: string; v: (r: ListingRow) => string | number | null | undefined; personal?: boolean; bank?: boolean };
const COLS: Col[] = [
  { h: 'Ngày điền', v: (r) => vnDate(r.item.createdAt) },
  { h: 'Tháng', v: (r) => r.item.createdAt.toLocaleDateString('vi-VN', { month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' }) },
  { h: 'Nhân sự điền', v: (r) => r.item.createdBy.name },
  { h: 'Đợt listing', v: () => '' }, // điền ở dưới theo đợt
  { h: 'Store', v: () => '' },
  { h: 'Sản phẩm', v: () => '' },
  { h: 'ID kênh', v: (r) => r.koc.handle },
  { h: 'Tên người ảnh hưởng (Tên kênh)', v: (r) => r.koc.nickname ?? r.koc.name },
  { h: 'Link kênh', v: (r) => r.koc.channelUrl ?? `https://www.tiktok.com/@${r.koc.handle}` },
  { h: 'Follower', v: (r) => r.koc.followers },
  { h: 'Tệp kênh', v: (r) => r.koc.niche },
  { h: 'Tệp Booking', v: (r) => r.kl },
  { h: 'Giá đã hợp tác trước đó (Giá dự kiến)', v: (r) => round(r.collab.lastPrice) },
  { h: 'Loại giá', v: (r) => r.item.priceType },
  { h: 'Giá net video', v: (r) => round(r.price) },
  { h: 'Phí booking kèm thuế TNCN', v: (r) => round(r.f.fee) },
  { h: 'Trạng thái', v: (r) => r.item.status },
  { h: 'Đề xuất từ UpBase', v: (r) => r.item.recommendation },
  { h: 'Content note', v: (r) => r.item.contentNote },
  { h: 'Brand chọn', v: (r) => r.item.brandChoice },
  { h: 'Lý do từ chối', v: (r) => r.item.rejectReason },
  { h: 'Thành quả hợp tác với UB', v: (r) => (r.collab.count ? `${r.collab.count} booking; ${r.collab.brands.slice(0, 5).join(', ')}${r.collab.best ? `; GMV 30 ngày tốt nhất ${Math.round(r.collab.best.gmv30)} (${r.collab.best.code})` : ''}` : '') },
  { h: 'Thành quả hợp tác với brand ngoài', v: (r) => (r.p.brandCount != null ? `${r.p.brandCount} brand đã hợp tác; GMV ${r.koc.gmvRange ?? '—'}` : '') },
  { h: 'Doanh số (nếu có)', v: (r) => round(r.p.gmvExactVnd) },
  { h: 'Doanh số ước tính trong 30 ngày', v: (r) => round(r.gmv30) },
  { h: 'Số món bán ra', v: (r) => r.koc.unitsSold },
  { h: 'GPM', v: (r) => round(r.f.gpmVnd) },
  { h: 'GMV từ mỗi khách hàng/ AOV', v: (r) => r.p.aovText },
  { h: 'View trung bình video/ trung vị video', v: (r) => r.koc.avgViews },
  { h: 'Cost per view', v: (r) => (r.f.cpv == null ? '' : Math.round(r.f.cpv * 10) / 10) },
  { h: 'Tỉ trọng GMV từ video', v: (r) => fmtPct(r.p.gmvVideo) },
  { h: 'Tỉ trọng GMV từ Live', v: (r) => fmtPct(r.p.gmvLive) },
  { h: 'Tỉ trọng GMV từ thẻ sản phẩm', v: (r) => fmtPct(r.p.gmvShowcase) },
  { h: 'Tỉ trọng ngành hàng', v: (r) => r.p.categories.map((c) => `${c.name} ${fmtPct(c.share)}`).join('; ') },
  { h: 'Tỉ trọng Nam', v: (r) => fmtPct(r.p.male) },
  { h: 'Tỉ trọng Nữ', v: (r) => fmtPct(r.p.female) },
  { h: 'Tỉ trọng 18-24', v: (r) => fmtPct(r.p.age18_24) },
  { h: 'Tỉ trọng 25-34', v: (r) => fmtPct(r.p.age25_34) },
  { h: 'Location', v: (r) => r.p.locations.map((l) => `${l.name} ${fmtPct(l.share)}`).join('; ') },
  { h: 'Ngày air plan', v: (r) => vnDate(r.item.planAirDate) },
  { h: 'GMV Target', v: (r) => round(r.f.gmvTarget) },
  { h: 'View trung vị', v: () => '' }, // TikTok Shop API chưa có view video không gắn giỏ
  { h: 'CTR', v: (r) => (r.f.ctr == null ? '' : fmtPct(r.f.ctr, 2)) },
  { h: 'CR', v: () => '' },
  { h: 'View Target', v: (r) => r.viewTarget },
  { h: 'Tỷ lệ tương tác', v: (r) => fmtPct(r.p.engagement, 2) },
  { h: 'Email', v: (r) => r.koc.email, personal: true },
  { h: 'Zalo', v: (r) => r.koc.zalo, personal: true },
  { h: 'Người nhận hàng', v: (r) => r.koc.receiverName, personal: true },
  { h: 'SĐT nhận hàng', v: (r) => r.koc.receiverPhone, personal: true },
  { h: 'Địa chỉ nhận hàng', v: (r) => r.koc.address, personal: true },
  { h: 'Tên tài khoản ngân hàng', v: (r) => r.koc.bankHolder, personal: true, bank: true },
  { h: 'Số tài khoản', v: (r) => r.koc.bankAccount, personal: true, bank: true },
  { h: 'Ngân hàng', v: (r) => r.koc.bankName, personal: true, bank: true },
  { h: 'Số CCCD', v: (r) => r.koc.idNumber, personal: true, bank: true },
];

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// CSV (UTF-8 có BOM) mở thẳng bằng Excel; đủ dùng, không cần thư viện xlsx.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const data = await loadListing(id);
  if (!data) return new Response('Không có đợt listing này', { status: 404 });
  const forBrand = req.nextUrl.searchParams.get('mode') === 'brand';
  const cols = COLS.filter((c) => !(forBrand && c.personal) && !(c.bank && me.role === 'STAFF'));
  const { batch, rows } = data;
  const fixed: Record<string, string | null> = { 'Đợt listing': batch.name, Store: batch.store, 'Sản phẩm': batch.product, CR: batch.cr == null ? '' : fmtPct(batch.cr) };

  const lines = [cols.map((c) => cell(c.h)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => cell(c.h in fixed ? fixed[c.h] : c.v(r))).join(','));
  const name = `${batch.name}${forBrand ? ' - gui Brand' : ' - noi bo'}.csv`.replace(/[\\/:*?"<>|]/g, '-');
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="listing.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
