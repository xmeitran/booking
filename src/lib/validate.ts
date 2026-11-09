// Kiểm soát nhập liệu: chuẩn hoá + kiểm tra định dạng. '' → null (không bắt buộc); sai định dạng → undefined.
export const TIKTOK_USERNAME = /^[a-z0-9._]{2,24}$/;

const digits = (s: string) => s.replace(/[\s.\-()]/g, '');

/** SĐT Việt Nam: 0xxxxxxxxx hoặc +84xxxxxxxxx (9 số sau đầu số) → dạng 0xxxxxxxxx. */
export function phoneVN(s: string): string | null | undefined {
  if (!s.trim()) return null;
  const d = digits(s).replace(/^\+?84/, '0');
  return /^0\d{9}$/.test(d) ? d : undefined;
}

/** CCCD 12 số, CMND 9 số, MST 10 số hoặc 13 số (có / không gạch: 0101234567-001). */
export function idNumber(s: string): string | null | undefined {
  if (!s.trim()) return null;
  const d = s.replace(/\s/g, '');
  return /^(\d{9}|\d{12}|\d{10}(-?\d{3})?)$/.test(d) ? d : undefined;
}

/** Số tài khoản ngân hàng: 6–19 chữ số (bỏ dấu cách, chấm, gạch). */
export function bankAccount(s: string): string | null | undefined {
  if (!s.trim()) return null;
  const d = digits(s);
  return /^\d{6,19}$/.test(d) ? d : undefined;
}
