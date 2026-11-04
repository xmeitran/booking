// Định dạng hiển thị dùng chung. Thiếu số thì "—".
const vn = new Intl.NumberFormat('vi-VN');
const short = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });

export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : vn.format(Math.round(n)));
export const fmtShort = (n: number | null | undefined) => (n == null ? '—' : short.format(n));
export const fmtVnd = (n: number | null | undefined) => (n == null ? '—' : `${vn.format(Math.round(n))} ₫`);
export const fmtPct = (x: number | null | undefined, digits = 1) => (x == null ? '—' : `${(x * 100).toFixed(digits).replace('.', ',')}%`);
export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '—';
