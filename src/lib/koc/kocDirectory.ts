// Định nghĩa của tab Danh bạ KOC / KOL, chép đúng bản đã chốt trên app b2c (web-admin: lib/types.ts, kocUtils.ts,
// kocRating.ts, kocChannelReviewService.ts, KocMasterDataView.tsx). Chỉ lấy định nghĩa, không lấy dữ liệu của b2c.

/** Ngành hàng (KocCategory, 9 nhóm). Giá trị lưu ở Koc.category; null = "Chưa phân loại". */
export const KOC_CATEGORIES = [
  ['Personal care', 'Personal care (Mỹ phẩm & Chăm sóc cá nhân)'],
  ['Mom and baby', 'Mom and baby (Mẹ & Bé)'],
  ['Reviewer', 'Reviewer (Đánh giá tổng hợp)'],
  ['Lifestyle', 'Lifestyle (Đời sống)'],
  ['Fashion', 'Fashion (Thời trang)'],
  ['ELHA', 'ELHA (Gia dụng & Điện tử)'],
  ['F&B', 'F&B (Ẩm thực & Thực phẩm)'],
  ['Social / Comedian', 'Social / Comedian (Giải trí)'],
  ['Travel/Hospitality', 'Travel/Hospitality (Du lịch)'],
] as const;
export const CATEGORY_VALUES: string[] = KOC_CATEGORIES.map(([v]) => v);

// Kênh khác của KOC (KocSocialChannelsModal). Kênh TikTok chính là Koc.handle; còn lại lưu ở KocChannel.
export const OTHER_PLATFORMS = [
  { key: 'Shopee', label: 'Shopee Video / Affiliate', placeholder: 'username hoặc link shopee.vn/...' },
  { key: 'Facebook', label: 'Facebook / Reels', placeholder: 'username hoặc link facebook.com/...' },
  { key: 'Instagram', label: 'Instagram Reels', placeholder: '@username hoặc link instagram.com/...' },
  { key: 'Threads', label: 'Threads', placeholder: '@username hoặc link threads.net/@...' },
] as const;
export const TIKTOK_ROLES = [
  ['Kênh TikTok phụ (Vlog / Đời sống)', 'Kênh phụ · Vlog / Đời sống'],
  ['Kênh TikTok phụ (Review / Chuyên môn)', 'Kênh phụ · Review / Chuyên môn'],
  ['Kênh TikTok phụ (Livestream / Bán hàng)', 'Kênh phụ · Livestream / Bán hàng'],
  ['Kênh TikTok phụ (Cùng chủ sở hữu)', 'Kênh phụ · Cùng chủ sở hữu'],
] as const;

/** "@handle (+1 TikTok · +4 MXH)" như formatKocPrimaryChannelSummary. */
export function channelSummary(handle: string, channels: { platform: string }[]) {
  const tt = channels.filter((c) => c.platform === 'TikTok').length;
  const other = channels.length - tt;
  const base = `@${handle}`;
  if (tt && other) return `${base} (+${tt} TikTok · +${other} MXH)`;
  if (tt) return `${base} (+${tt} TikTok)`;
  if (other) return `${base} (+${other} MXH)`;
  return base;
}

/** Handle từ "@abc", "abc" hoặc link (tiktok.com/@abc, instagram.com/abc/, threads.net/@abc...). */
export function cleanHandle(raw: string) {
  const s = raw.trim();
  const fromUrl = s.match(/^(?:https?:\/\/)?(?:[\w-]+\.)*[\w-]+\.[a-z.]+\/@?([^/?#\s]+)/i)?.[1];
  return (fromUrl ?? s).replace(/^@+/, '').trim().toLowerCase();
}

// Tab KOC mới / tiềm năng
export const READINESS: Record<string, { label: string; chip: string; tone: string }> = {
  'SẴN_SÀNG_BOOKING': { label: 'Sẵn sàng booking', chip: 'Sẵn sàng booking', tone: 'bg-positive-soft text-positive' },
  'TIẾP_CẬN_BỔ_SUNG_PHÁP_LÝ': { label: 'Có liên hệ · Bổ sung pháp lý', chip: 'Bổ sung pháp lý', tone: 'bg-accent-soft text-accent' },
  'CẦN_XIN_LIÊN_HỆ': { label: 'Cần xin SĐT/Zalo', chip: 'Cần xin SĐT', tone: 'bg-warning-soft text-warning' },
  'CHỜ_TIẾP_CẬN': { label: 'Chờ tiếp cận', chip: 'Chờ tiếp cận', tone: 'bg-sunken text-ink-2' },
};
export const READINESS_OPTIONS = [
  ['SẴN_SÀNG_BOOKING', 'Sẵn sàng booking ngay'],
  ['TIẾP_CẬN_BỔ_SUNG_PHÁP_LÝ', 'Có liên hệ · Bổ sung pháp lý'],
  ['CẦN_XIN_LIÊN_HỆ', 'Cần xin SĐT/Zalo'],
  ['CHỜ_TIẾP_CẬN', 'Chờ tiếp cận'],
] as const;
export const CONTACT_STATUS = [
  ['CHƯA_LIÊN_HỆ', 'Chưa liên hệ'],
  ['ĐÃ_LIÊN_HỆ', 'Đã liên hệ'],
  ['ĐANG_THƯƠNG_LƯỢNG', 'Đang thương lượng báo giá'],
  ['TỪ_CHỐI', 'KOC từ chối'],
] as const;
export const CONTACT_CHANNELS = ['Zalo', 'TikTok DM', 'Email', 'Điện thoại', 'Lark'];
/** Nhãn ô "Sẵn sàng & liên hệ"; TỪ_CHỐI hiện "Chưa liên hệ" như b2c. */
export const contactLabel = (s: string | null) => (s === 'ĐANG_THƯƠNG_LƯỢNG' ? 'Đang thương lượng' : s === 'ĐÃ_LIÊN_HỆ' ? 'Đã liên hệ' : 'Chưa liên hệ');
/** Độ sẵn sàng lúc tạo KOC (CreateKocModal): đủ CCCD + số TK / có liên hệ / chờ tiếp cận. */
export const initialReadiness = (k: { idNumber?: string | null; bankAccount?: string | null; phone?: string | null; email?: string | null }) =>
  k.idNumber && k.bankAccount ? 'SẴN_SÀNG_BOOKING' : k.phone || k.email ? 'TIẾP_CẬN_BỔ_SUNG_PHÁP_LÝ' : 'CHỜ_TIẾP_CẬN';

// Đánh giá kênh theo brand (KocChannelReview): nhật ký chỉ thêm, nhiều lượt / brand.
export const ALL_BRANDS_SCOPE = 'Toàn hệ thống B2C';
export const VERDICTS: Record<string, { label: string; short: string; tone: string; button: string; placeholder: string }> = {
  SUITABLE: { label: 'Phù hợp', short: 'Phù hợp', tone: 'bg-positive-soft text-positive', button: '✓ Phù hợp', placeholder: 'Ghi rõ ý kiến vì sao kênh phù hợp với Brand này (VD: Tệp mẹ bỉm tương tác hỏi mua tốt, hình ảnh hợp nhãn, đơn giá hợp lý)...' },
  CAUTION: { label: 'Cân nhắc / Lưu ý', short: 'Cân nhắc', tone: 'bg-warning-soft text-warning', button: 'Cân nhắc', placeholder: 'Ghi rõ điểm cần lưu ý khi book kênh này cho Brand (VD: Cần deal lại giá hoặc duyệt kỹ kịch bản trước khi quay)...' },
  NOT_SUITABLE: { label: 'Không phù hợp', short: 'K.Phù hợp', tone: 'bg-critical-soft text-critical', button: '✕ Không phù hợp', placeholder: 'Ghi rõ ý kiến vì sao kênh không phù hợp với Brand này (VD: Đã liên hệ báo giá quá cao so với view thực tế, kênh đang gắn giỏ độc quyền đối thủ)...' },
};
export const REVIEW_REASONS: Record<string, string[]> = {
  SUITABLE: [
    'Tệp khán giả khớp chân dung khách hàng Brand', 'Tương tác thật & chuyển đổi giỏ hàng tốt', 'Hình ảnh / Giọng điệu hợp định vị Brand',
    'Đơn giá hợp lý so với lượt xem thực tế', 'Phối hợp nhanh, trả bài đúng hạn SLA', 'Từng lên video hiệu quả cao cùng ngành', 'Khác (Ghi rõ ở phần ý kiến)',
  ],
  CAUTION: [
    'Cần thương lượng giảm đơn giá trước khi book', 'Chỉ phù hợp gửi mẫu FOC / Affiliate 0đ', 'Cần duyệt kỹ kịch bản & từ khóa trước khi quay',
    'Phản hồi hơi chậm, cần theo sát tiến độ', 'Lượt xem biến động mạnh giữa các video', 'Khác (Ghi rõ ở phần ý kiến)',
  ],
  NOT_SUITABLE: [
    'Tệp khán giả không khớp ngành hàng', 'Hình ảnh / Nội dung không hợp Brand', 'Đơn giá cao so với chuyển đổi thực tế', 'Tương tác thấp / Nghi vấn buff view',
    'Đã hợp tác độc quyền đối thủ', 'Phản hồi chậm / Từng trễ hạn SLA', 'Tỷ lệ hoàn hủy cao / Điểm uy tín thấp', 'Khác (Ghi rõ ở phần ý kiến)',
  ],
};

/** Tóm tắt đánh giá kênh như getChannelSummary: lượt mới nhất (mọi brand), số lượt theo kết luận, kết luận mới nhất theo từng brand. */
export function reviewSummary<T extends { verdict: string; brand: string; createdAt: Date }>(reviews: T[]) {
  if (!reviews.length) return null;
  const sorted = [...reviews].sort((a, b) => +b.createdAt - +a.createdAt);
  const byBrand = new Map<string, { brand: string; latest: T; count: number }>();
  for (const r of sorted) {
    const key = r.brand.toLowerCase();
    const cur = byBrand.get(key);
    if (cur) cur.count++;
    else byBrand.set(key, { brand: r.brand, latest: r, count: 1 });
  }
  const count = (v: string) => sorted.filter((r) => r.verdict === v).length;
  return { latest: sorted[0], total: sorted.length, suitable: count('SUITABLE'), caution: count('CAUTION'), notSuitable: count('NOT_SUITABLE'), byBrand: [...byBrand.values()] };
}

// Đánh giá sao sau deal (KocRating): mỗi deal (mã BO trên Lark hoặc job trong app) một lượt.
// b2c quản lý danh mục nhận định trong bảng KocRatingTag; khi bảng trống dùng danh sách mặc định dưới đây.
export const RATING_TAGS = [
  { code: 'REPLY_FAST', label: 'Phản hồi nhanh', positive: true },
  { code: 'ON_TIME', label: 'Đúng hạn', positive: true },
  { code: 'EDIT_FAST', label: 'Sửa bài nhanh', positive: true },
  { code: 'ON_BRIEF', label: 'Đúng brief', positive: true },
  { code: 'COOPERATIVE', label: 'Phối hợp tốt', positive: true },
  { code: 'DOCS_READY', label: 'Hồ sơ thanh toán gọn', positive: true },
  { code: 'REPLY_SLOW', label: 'Phản hồi chậm', positive: false },
  { code: 'LATE', label: 'Trễ hạn', positive: false },
  { code: 'EDIT_SLOW', label: 'Sửa bài chậm', positive: false },
  { code: 'OFF_BRIEF', label: 'Lệch brief', positive: false },
  { code: 'HARD_TO_WORK', label: 'Khó phối hợp', positive: false },
  { code: 'DOCS_LATE', label: 'Hồ sơ thanh toán chậm', positive: false },
] as const;
export const LOW_RATING = 2;

/** summarizeKocRatings + buildKocRatingIndex: trung bình 1 chữ số thập phân, điểm thấp khi ≤ 2, 3 nhận định tiêu cực hay gặp nhất. */
export function ratingSummary(ratings: { stars: number; tags: string[] }[]) {
  const count = ratings.length;
  const average = count ? Math.round((ratings.reduce((s, r) => s + r.stars, 0) / count) * 10) / 10 : 0;
  const tally = new Map<string, number>();
  for (const r of ratings) for (const t of new Set(r.tags)) tally.set(t, (tally.get(t) ?? 0) + 1);
  const tags = RATING_TAGS.filter((t) => tally.has(t.code)).map((t) => ({ ...t, count: tally.get(t.code)! })).sort((a, b) => b.count - a.count);
  return { count, average, isLow: count > 0 && average <= LOW_RATING, tags, negativeTags: tags.filter((t) => !t.positive).slice(0, 3).map((t) => t.label) };
}

// Hồ sơ pháp lý (KocLegalProfilesSection, kocUtils getKocLegalProfiles / evaluateLegalProfileContractReadiness, kocLegalValidation).
export type LegalType = 'INDIVIDUAL' | 'HOUSEHOLD' | 'COMPANY';
export const LEGAL_TYPES: LegalType[] = ['INDIVIDUAL', 'HOUSEHOLD', 'COMPANY'];
export const LEGAL_TYPE_LABEL: Record<LegalType, string> = { INDIVIDUAL: 'Cá nhân', HOUSEHOLD: 'Hộ kinh doanh', COMPANY: 'Công ty' };
export const LEGAL_FILTER_LABEL: Record<LegalType | 'MULTI', string> = { INDIVIDUAL: 'Cá nhân', HOUSEHOLD: 'Hộ kinh doanh', COMPANY: 'Công ty / MCN', MULTI: 'Từ 2 hồ sơ' };
export const LEGAL_FORM_LABEL: Record<LegalType, string> = { INDIVIDUAL: 'Cá nhân (CCCD - TNCN 10%)', HOUSEHOLD: 'Hộ kinh doanh (HKD)', COMPANY: 'Công ty / MCN (VAT 8%/10%)' };
export const TAX_ACCOUNT_OPTIONS: Record<LegalType, string[]> = {
  INDIVIDUAL: ['(Thuế TNCN 10%) Tài khoản cá nhân', 'TK cá nhân tính thuế TNCN 10%', 'Không tính thuế TNCN (Chưa đến ngưỡng)', 'Người thân nhận ủy quyền (Khấu trừ TNCN 10%)'],
  HOUSEHOLD: ['HKD xuất hóa đơn (Thuế 7%: 5% VAT + 2% TNCN)', 'Hộ kinh doanh cá thể'],
  COMPANY: ['(VAT 8%) Tài khoản doanh nghiệp', '(VAT 10%) Tài khoản doanh nghiệp / MCN'],
};
export const DEFAULT_TAX_ACCOUNT: Record<LegalType, string> = { INDIVIDUAL: '(Thuế TNCN 10%) Tài khoản cá nhân', HOUSEHOLD: 'HKD xuất hóa đơn', COMPANY: '(VAT 8%) Tài khoản doanh nghiệp' };
export const SIGN_ROLES = ['Chính chủ KOC', 'Hộ kinh doanh cá thể', 'Pháp nhân Công ty / MCN đại diện', 'Người thân / Đại diện nhận ủy quyền'];
export const DEFAULT_SIGN_ROLE: Record<LegalType, string> = { INDIVIDUAL: 'Chính chủ KOC', HOUSEHOLD: 'Hộ kinh doanh cá thể', COMPANY: 'Pháp nhân Công ty / MCN đại diện' };
export const VAT_OPTIONS: Record<Exclude<LegalType, 'INDIVIDUAL'>, [number, string][]> = {
  COMPANY: [[8, 'VAT 8% (Doanh nghiệp)'], [10, 'VAT 10% (Doanh nghiệp)'], [0, '0% (Không chịu VAT)']],
  HOUSEHOLD: [[5, 'HKD xuất hóa đơn (5% VAT + 2% TNCN)'], [0, 'HKD không xuất hóa đơn']],
};
export const DEFAULT_VAT: Record<LegalType, number> = { INDIVIDUAL: 0, HOUSEHOLD: 5, COMPANY: 8 };
export const CONTRACT_STATUS: Record<string, string> = { 'CHƯA_KÝ': 'Chưa ký', 'ĐANG_TRÌNH_KÝ': 'Đang trình ký', 'ĐÃ_KÝ': 'Đã ký', 'HẾT_HẠN': 'Hết hạn' };
export const profileCode = (n: number) => `HSPL-0${n}`;

/** inferLegalTypeFromText: loại pháp nhân theo chế độ thuế / tên người đứng tên. */
export function inferLegalType(holderName?: string | null, taxAccountType?: string | null): LegalType {
  const tax = (taxAccountType ?? '').toLowerCase();
  const holder = (holderName ?? '').toUpperCase();
  if (tax.includes('hộ kinh doanh') || tax.includes('hkd') || /HO KINH DOANH|HỘ KINH DOANH|HKD/.test(holder)) return 'HOUSEHOLD';
  if (tax.includes('doanh nghiệp') || tax.includes('vat') || /CONG TY|CÔNG TY|CTY|TNHH|CO PHAN|CỔ PHẦN|MEDIA|NETWORK|ENTERTAINMENT|AGENCY|GROUP/.test(holder)) return 'COMPANY';
  return 'INDIVIDUAL';
}

export type LegalProfileView = {
  id: string | null; // null = dựng từ cột cũ của Koc, chưa lưu hồ sơ
  code: string; legalType: LegalType; isDefault: boolean; holderName: string;
  taxAccountType?: string | null; cccd?: string | null; cccdIssueDate?: string | null; cccdIssuePlace?: string | null;
  taxCode?: string | null; businessLicenseNo?: string | null; representativeName?: string | null; representativeTitle?: string | null;
  address?: string | null; contactPhone?: string | null; bankName?: string | null; bankAccount?: string | null; bankHolderName?: string | null;
  contractStatus?: string | null;
};
type KocLegacy = { idNumber: string | null; bankAccount: string | null; bankHolder: string | null; bankName: string | null; phone?: string | null; address?: string | null };

const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '');
/** Số trên cột cũ là MST khi có "-" hoặc dài 10 / 13 số; còn lại là CCCD. */
const looksLikeTaxCode = (s: string) => s.includes('-') || [10, 13].includes(digits(s).length);

/**
 * Hồ sơ pháp lý của KOC: bản đã lưu (mặc định đứng đầu); chưa có thì dựng HSPL-01 từ CCCD / số TK đồng bộ từ Lark
 * (loại pháp nhân suy từ tên chủ TK và "Loại tài khoản" của booking gần nhất), như getKocLegalProfiles của b2c.
 */
export function legalProfilesOf<T extends LegalProfileView>(saved: T[], koc: KocLegacy, accountType?: string | null): LegalProfileView[] {
  if (saved.length) return [...saved].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.code.localeCompare(b.code));
  if (!koc.idNumber && !koc.bankAccount) return [];
  const legalType = inferLegalType(koc.bankHolder, accountType);
  const id = koc.idNumber ?? '';
  const tax = id && (legalType !== 'INDIVIDUAL' || looksLikeTaxCode(id));
  return [{
    id: null, code: profileCode(1), legalType, isDefault: true, holderName: koc.bankHolder ?? '',
    taxAccountType: accountType ?? DEFAULT_TAX_ACCOUNT[legalType], cccd: tax ? null : id || null, taxCode: tax ? id : null,
    bankName: koc.bankName, bankAccount: koc.bankAccount, bankHolderName: koc.bankHolder, contactPhone: koc.phone, address: koc.address,
  }];
}

/** hasLegalId: hồ sơ mặc định có CCCD / MST / ĐKKD. */
export const hasLegalId = (p?: LegalProfileView) => Boolean(p && (p.legalType === 'INDIVIDUAL' ? p.cccd || p.taxCode : p.taxCode || p.businessLicenseNo || p.cccd));

/** evaluateLegalProfileContractReadiness: các trường bắt buộc để ký hợp đồng theo loại pháp nhân. */
export function contractReadiness(p: LegalProfileView, koc: { phone?: string | null; address?: string | null }) {
  const t = p.legalType;
  const checks: [boolean, string][] = [[Boolean(p.holderName?.trim()), t === 'INDIVIDUAL' ? 'Họ tên pháp lý' : 'Tên đơn vị pháp nhân']];
  if (t === 'INDIVIDUAL') {
    checks.push([cccdError(p.cccd ?? '') === null && Boolean(p.cccd), 'Số CCCD (12 số)'], [dateError(p.cccdIssueDate ?? '') === null && Boolean(p.cccdIssueDate), 'Ngày cấp CCCD (DD/MM/YYYY)'], [placeError(p.cccdIssuePlace ?? '') === null && Boolean(p.cccdIssuePlace), 'Nơi cấp CCCD (phải là chữ)']);
  } else if (t === 'HOUSEHOLD') {
    checks.push([Boolean(p.taxCode?.trim() || p.businessLicenseNo?.trim()), 'Mã số thuế / ĐKKD HKD'], [Boolean(p.representativeName?.trim()), 'Chủ hộ kinh doanh']);
  } else {
    checks.push([(p.taxCode?.trim() || p.businessLicenseNo?.trim() || '').length >= 7, 'Mã số thuế Công ty'], [Boolean(p.representativeName?.trim()), 'Người đại diện pháp luật'], [Boolean(p.representativeTitle?.trim()), 'Chức vụ người đại diện']);
  }
  checks.push(
    [Boolean(p.address?.trim() || koc.address?.trim()), 'Địa chỉ pháp lý'],
    [Boolean(p.bankName?.trim()), 'Tên ngân hàng'],
    [Boolean(p.bankAccount?.trim()), 'Số tài khoản'],
    [Boolean((p.bankHolderName || p.holderName)?.trim()), 'Chủ tài khoản (IN HOA KHÔNG DẤU)'],
    [Boolean(p.contactPhone?.trim() || koc.phone?.trim()), 'SĐT hợp đồng'],
  );
  const missing = checks.filter(([ok]) => !ok).map(([, label]) => label);
  return { ready: !missing.length, missing, filled: checks.length - missing.length, total: checks.length };
}

// kocLegalValidation (nguyên văn b2c): null = hợp lệ.
export function cccdError(raw: string) {
  const s = raw.trim();
  if (!s) return 'Số CCCD không được để trống';
  if (!/^\d+$/.test(s)) return 'Số CCCD chỉ bao gồm chữ số, không chứa chữ cái hay ký tự đặc biệt';
  return s.length === 12 ? null : `Số CCCD phải gồm đúng 12 chữ số (hiện có ${s.length} số)`;
}
export function dateError(raw: string) {
  const s = raw.trim();
  if (!s) return 'Ngày cấp không được để trống';
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 'Ngày cấp phải đúng định dạng ngày/tháng/năm (VD: 11/11/2026 hoặc 15/05/2022)';
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12) return 'Tháng không hợp lệ (phải từ 01 đến 12)';
  if (d < 1 || d > 31) return 'Ngày không hợp lệ (phải từ 01 đến 31)';
  if (y < 1900) return 'Năm không hợp lệ';
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d > days) return `Tháng ${mo}/${y} chỉ có tối đa ${days} ngày`;
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` > today ? 'Ngày cấp CCCD không được lớn hơn ngày hiện tại' : null;
}
export function placeError(raw: string) {
  const s = raw.trim();
  if (!s) return 'Nơi cấp CCCD không được để trống';
  if (/^\d+$/.test(s)) return 'Nơi cấp CCCD phải là chữ, điền số là sai';
  return /[a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]/.test(s) && s.length >= 3 ? null : 'Nơi cấp CCCD phải là tên cơ quan hợp lệ (VD: Cục Cảnh sát QLHC về TTXH)';
}
export function accountError(raw: string) {
  const s = raw.replace(/\s+/g, '');
  if (!s) return 'Số tài khoản không được để trống';
  if (s.length < 6) return 'Số tài khoản phải từ 6 chữ số trở lên';
  return /^[A-Za-z0-9]+$/.test(s) ? null : 'Số tài khoản chỉ chứa số hoặc chữ, không chứa ký tự đặc biệt';
}
/** normalizeBankHolderUpperNoAccent: tên chủ tài khoản IN HOA KHÔNG DẤU như trên ngân hàng / phiếu thanh toán Lark. */
export const upperNoAccent = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
/** Che số nhạy cảm: ****1234. */
export const mask = (v?: string | null) => (v ? `****${v.slice(-4)}` : '');

// ---------------------------------------------------------------- Lọc danh bạ (KocMasterDataView: baseFiltered, matchesIssue...)
/** Số liệu booking trên Lark gộp theo ID kênh: dòng Hợp tác, Đơn giá, PIC, loại tài khoản. */
export type LarkInfo = {
  n: number; paid: number; foc: number; minCost: number | null; maxCost: number | null; lastVideo: number | null; lastCost: number | null;
  brands: number; brand: string | null; month: string | null; code: string | null; pic: string | null; pics: string | null; accountType: string | null;
};
export type DirKoc = {
  id: string; handle: string; name: string; nickname: string | null; platform: string; avatarUrl: string | null; channelUrl: string | null;
  phone: string | null; zalo: string | null; email: string | null; niche: string | null; category: string | null; kl: string | null; klAuto: string | null;
  picName: string | null; statsAt: Date | null; receiverName: string | null; address: string | null; blacklisted: boolean; tags: string[];
  bookingCount: number; jobs: number; coopConfirmed: boolean; readiness: string | null; contactStatus: string | null;
  idNumber: string | null; bankAccount: string | null; bankHolder: string | null; bankName: string | null; rateCard: number | null;
  followers: number | null; avgViews: number | null; unitsSold: number | null; gmvRange: string | null; updatedAt: Date; lastBookingAt: Date | null;
  saved: (LegalProfileView & { id: string })[]; channels: { platform: string; handle: string; role: string | null }[]; aliases: string[];
  reviews: { verdict: string; brand: string; createdAt: Date }[]; ratings: { stars: number; tags: string[] }[];
  lark: LarkInfo | null; followUp: boolean;
};
export type DirFilters = {
  tab?: string; q?: string; pic?: string; niche?: string; category?: string; kl?: string; legal?: string; platform?: string;
  issue?: string; readiness?: string; contact?: string; flag?: string; tag?: string; owner?: string;
};

export const UNCATEGORIZED = 'Chưa phân loại';
export const isCoop = (k: Pick<DirKoc, 'bookingCount' | 'jobs' | 'coopConfirmed'>) => k.bookingCount > 0 || k.jobs > 0 || k.coopConfirmed;
/** PIC chính: PIC trong Booking Hub, chưa có thì Booking PIC đầu tiên của booking gần nhất trên Lark. */
export const picOf = (k: Pick<DirKoc, 'picName' | 'lark'>) => k.picName ?? k.lark?.pic?.split(/[\n,]/)[0].trim() ?? null;
export const salaryOf = (k: Pick<DirKoc, 'kl' | 'klAuto'>) => k.kl ?? k.klAuto;
export const legalOf = (k: DirKoc) => legalProfilesOf(k.saved, k, k.lark?.accountType);
export const hasContact = (k: Pick<DirKoc, 'phone' | 'email'>) => Boolean(k.email?.trim() || k.phone?.trim());
export const readinessOf = (k: Pick<DirKoc, 'readiness'>) => (k.readiness && READINESS[k.readiness] ? k.readiness : 'CHỜ_TIẾP_CẬN');
const suitable = (k: DirKoc) => k.reviews.some((r) => r.verdict === 'SUITABLE');
const notSuitable = (k: DirKoc) => k.reviews.some((r) => r.verdict === 'NOT_SUITABLE');
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();

/**
 * findDuplicates: kênh trùng (Booking Hub không cho trùng ID kênh nên dùng cách nhận "có thể trùng KOC" của trang KOC:
 * ID kênh bỏ dấu / dấu chấm / gạch / số cuối giống nhau) và chung chủ / MCN (trùng SĐT, email, CCCD / MST).
 */
export function findDuplicates(kocs: Pick<DirKoc, 'id' | 'handle' | 'phone' | 'email' | 'idNumber'>[], dupKey: (h: string) => string) {
  const keyers: [string, (k: (typeof kocs)[number]) => string][] = [
    ['kênh', (k) => { const v = dupKey(k.handle); return v.length >= 3 ? v : ''; }],
    ['SĐT', (k) => { const v = (k.phone ?? '').replace(/\D/g, ''); return v.length >= 9 ? v : ''; }],
    ['Email', (k) => { const v = (k.email ?? '').trim().toLowerCase(); return v.includes('@') && v.length >= 5 ? v : ''; }],
    ['CCCD / MST', (k) => { const v = (k.idNumber ?? '').replace(/\D/g, ''); return v.length >= 9 && !/^0+$/.test(v) ? v : ''; }],
  ];
  const out = new Map<string, Map<string, string[]>>(); // id → id khác → các trường trùng
  for (const [field, keyOf] of keyers) {
    const groups = new Map<string, string[]>();
    for (const k of kocs) {
      const key = keyOf(k);
      if (key) groups.set(key, [...(groups.get(key) ?? []), k.id]);
    }
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) for (const other of ids) {
        if (other === id) continue;
        const m = out.get(id) ?? new Map<string, string[]>();
        m.set(other, [...(m.get(other) ?? []), field]);
        out.set(id, m);
      }
    }
  }
  return out;
}

export const EXTRA_FLAGS: Record<string, { label: string; test: (k: DirKoc) => boolean }> = {
  followUp: { label: 'Đến hẹn liên hệ', test: (k) => k.followUp },
  noPic: { label: 'Chưa có PIC', test: (k) => !picOf(k) },
  noStats: { label: 'Chưa có số TikTok', test: (k) => !k.statsAt },
  noShip: { label: 'Thiếu địa chỉ nhận hàng', test: (k) => !k.receiverName || !k.address },
  blacklist: { label: 'Blacklist', test: (k) => k.blacklisted },
};
export const ISSUES = { MISSING: 'Thiếu giấy tờ', NO_CONTACT: 'Thiếu Email/SĐT', DUPLICATE: 'Trùng kênh', SHARED_OWNER: 'Chung chủ / MCN', SUITABLE: 'Phù hợp', NOT_SUITABLE: 'Không phù hợp' } as const;
export const CONTACT_FILTERS = { CONTACTED: 'Đã liên hệ', NOT_CONTACTED: 'Chưa liên hệ', HAS_PHONE: 'Có SĐT/Email', SUITABLE: 'Phù hợp', NOT_SUITABLE: 'Không phù hợp' } as const;
export const PLATFORM_FILTERS = ['TikTok', 'Shopee', 'Facebook', 'Instagram', 'Threads'];

/** Toàn bộ logic lọc / đếm của màn danh sách; boHandles = ID kênh có mã BO khớp ô tìm. */
export function directory(all: DirKoc[], f: DirFilters, dupKey: (h: string) => string, boHandles = new Set<string>()) {
  const dups = findDuplicates(all, dupKey);
  const isDup = (k: DirKoc) => [...(dups.get(k.id)?.values() ?? [])].some((fields) => fields.includes('kênh'));
  const isShared = (k: DirKoc) => dups.has(k.id) && !isDup(k);
  const coop = all.filter(isCoop);
  const fresh = all.filter((k) => !isCoop(k));
  const tab = f.tab === 'new' ? 'new' : 'coop';
  const active = tab === 'coop' ? coop : fresh;

  const q = norm((f.q ?? '').trim()).replace(/^@+/, '');
  const terms = q.split(/\s+/).filter(Boolean);
  const qDigits = q.replace(/\D/g, '');
  const ownerGroup = f.owner ? new Set([f.owner, ...[...(dups.get(f.owner)?.entries() ?? [])].filter(([, fl]) => fl.some((x) => x !== 'kênh')).map(([id]) => id)]) : null;
  const base = active.filter((k) => {
    if (terms.length) {
      const legal = legalOf(k);
      const hay = norm([k.name, k.nickname, k.handle, k.phone, k.zalo, k.email, k.niche, k.category, k.lark?.brand, k.lark?.pics, k.bankHolder,
        ...k.channels.map((c) => c.handle), ...k.aliases, ...legal.flatMap((p) => [p.holderName, p.cccd, p.taxCode, p.bankAccount])].filter(Boolean).join(' '));
      const byTerms = terms.every((t) => hay.includes(t));
      const byDigits = qDigits.length >= 4 && [k.phone, k.idNumber, k.bankAccount].some((v) => (v ?? '').replace(/\D/g, '').includes(qDigits));
      if (!byTerms && !byDigits && !boHandles.has(k.handle)) return false;
    }
    if (f.pic && picOf(k) !== f.pic) return false;
    if (f.niche && k.niche !== f.niche) return false;
    if (f.category && (k.category ?? UNCATEGORIZED) !== f.category) return false;
    if (f.kl && salaryOf(k) !== f.kl) return false;
    if (tab === 'coop' && f.platform && !(k.platform === f.platform || k.channels.some((c) => c.platform === f.platform))) return false;
    if (f.flag && EXTRA_FLAGS[f.flag] && !EXTRA_FLAGS[f.flag].test(k)) return false;
    if (f.tag && !k.tags.includes(f.tag)) return false;
    if (ownerGroup && !ownerGroup.has(k.id)) return false;
    return true;
  });

  const matchLegal = (k: DirKoc, l: string) => {
    if (!l) return true;
    if (l === 'MULTI') return k.saved.length > 1;
    return legalOf(k).some((p) => p.legalType === l);
  };
  const matchIssue = (k: DirKoc, i: string) => {
    if (!i) return true;
    if (i === 'MISSING') return !hasLegalId(legalOf(k)[0]);
    if (i === 'NO_CONTACT') return !hasContact(k);
    if (i === 'DUPLICATE') return isDup(k);
    if (i === 'SHARED_OWNER') return isShared(k);
    if (i === 'SUITABLE') return suitable(k);
    if (i === 'NOT_SUITABLE') return notSuitable(k);
    return true;
  };
  const matchContact = (k: DirKoc, c: string) => {
    if (!c) return true;
    if (c === 'CONTACTED') return k.contactStatus === 'ĐÃ_LIÊN_HỆ' || k.contactStatus === 'ĐANG_THƯƠNG_LƯỢNG';
    if (c === 'NOT_CONTACTED') return !k.contactStatus || k.contactStatus === 'CHƯA_LIÊN_HỆ';
    if (c === 'HAS_PHONE') return hasContact(k);
    if (c === 'SUITABLE') return suitable(k);
    if (c === 'NOT_SUITABLE') return notSuitable(k);
    return true;
  };
  const matchReady = (k: DirKoc, r: string) => !r || readinessOf(k) === r;

  const legal = f.legal ?? '', issue = f.issue ?? '', contact = f.contact ?? '', ready = f.readiness ?? '';
  const rows = tab === 'coop'
    ? base.filter((k) => matchLegal(k, legal) && matchIssue(k, issue))
    : base.filter((k) => matchReady(k, ready) && matchContact(k, contact));
  const issueBase = base.filter((k) => matchLegal(k, legal));
  const readyBase = base.filter((k) => matchContact(k, contact));
  const contactBase = base.filter((k) => matchReady(k, ready));
  const uniq = (v: (string | null | undefined)[]) => [...new Set(v.filter((x): x is string => !!x?.trim()))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  return {
    tab, rows, dups, isDup,
    counts: { coop: coop.length, new: fresh.length },
    issueAll: issueBase.length,
    issueChips: (Object.keys(ISSUES) as (keyof typeof ISSUES)[]).map((key) => ({ key, label: ISSUES[key], count: issueBase.filter((k) => matchIssue(k, key)).length }))
      .filter((c) => c.count > 0 || c.key === 'DUPLICATE'),
    legalOptions: (['INDIVIDUAL', 'HOUSEHOLD', 'COMPANY', 'MULTI'] as const).map((key) => ({ key, label: LEGAL_FILTER_LABEL[key], count: base.filter((k) => matchIssue(k, issue) && matchLegal(k, key)).length })),
    readinessChips: [{ key: '', label: 'Tất cả', count: readyBase.length }, ...Object.entries(READINESS).map(([key, v]) => ({ key, label: v.chip, count: readyBase.filter((k) => matchReady(k, key)).length }))],
    contactOptions: (Object.keys(CONTACT_FILTERS) as (keyof typeof CONTACT_FILTERS)[]).map((key) => ({ key, label: CONTACT_FILTERS[key], count: contactBase.filter((k) => matchContact(k, key)).length })),
    options: { pic: uniq(active.map(picOf)), niche: uniq(active.map((k) => k.niche)), category: uniq(active.map((k) => k.category ?? UNCATEGORIZED)), kl: uniq(active.map(salaryOf)) },
  };
}
