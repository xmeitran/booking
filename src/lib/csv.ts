// CSV UTF-8 có BOM: Excel mở thẳng, đúng tiếng Việt; đủ dùng, không cần thư viện xlsx.
const cell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  // Chữ bắt đầu bằng = + - @ (tên kênh TikTok, lý do Brand nhập...) Excel coi là công thức: thêm ' để hiện như chữ.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csvResponse(fileName: string, header: string[], rows: unknown[][]) {
  const body = [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const name = fileName.replace(/[\\/:*?"<>|]/g, '-');
  return new Response('﻿' + body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}
