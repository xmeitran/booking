// Job: booking quản lý trong app, theo vòng đời trong tài liệu B2C-Ops.
export const STAGES = ['Đã duyệt', 'Đã chốt', 'Gửi hàng', 'Đang quay', 'Đã nộp', 'Nghiệm thu', 'Thanh toán'] as const;
export const CANCELLED = 'Đã huỷ';
export const STAGE_HINT: Record<string, string> = {
  'Đã duyệt': 'Brand đã chọn, chưa chốt giá / lịch với KOC',
  'Đã chốt': 'Đã chốt giá, deadline, brief với KOC',
  'Gửi hàng': 'Đang gửi hàng mẫu',
  'Đang quay': 'KOC đã nhận hàng, đang làm video',
  'Đã nộp': 'KOC đã nộp link, chờ nghiệm thu',
  'Nghiệm thu': 'Nghiệm thu đạt, chờ đề nghị thanh toán',
  'Thanh toán': 'Đã vào đề nghị thanh toán',
};
export const STAGE_TONE: Record<string, string> = {
  'Đã nộp': 'bg-warning-soft text-warning', 'Nghiệm thu': 'bg-positive-soft text-positive', 'Thanh toán': 'bg-accent-soft text-accent', [CANCELLED]: 'bg-critical-soft text-critical',
};
export const SAMPLE = ['Không cần', 'Cần gửi', 'Đã gửi', 'KOC đã nhận', 'Đã hoàn'];
export const RESULTS = ['Đạt', 'Cần sửa', 'Không đạt'] as const;
export const RESULT_TONE: Record<string, string> = { Đạt: 'bg-positive-soft text-positive', 'Cần sửa': 'bg-warning-soft text-warning', 'Không đạt': 'bg-critical-soft text-critical' };
export type ReviewItem = { item: string; result: (typeof RESULTS)[number] | ''; at: string; note: string };
export const jobCode = (n: number) => `JOB-${String(n).padStart(4, '0')}`;

/** Brief nháp từ dữ liệu có sẵn (brand, sản phẩm, job); B2C sửa rồi duyệt trước khi gửi KOC. */
export function briefTemplate(j: {
  koc: { handle: string; nickname: string | null; name: string };
  brand: { name: string; usp: string | null; guideline: string | null } | null;
  product: { name: string; usp: string | null; link: string | null } | null;
  priceType: string; deadline: Date | null; note: string | null;
}, checklist: string[]) {
  const d = j.deadline ? j.deadline.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }) : '(chưa chốt)';
  return [
    `BRIEF – ${j.brand?.name ?? ''}${j.product ? ` – ${j.product.name}` : ''}`,
    `KOC: ${j.koc.nickname ?? j.koc.name} (@${j.koc.handle})`,
    `Định dạng: ${j.priceType} · Hạn air: ${d}`,
    '',
    '1. Sản phẩm',
    j.product ? `- ${j.product.name}${j.product.link ? ` (${j.product.link})` : ''}` : '- (chọn sản phẩm cho job)',
    j.product?.usp ? `- USP: ${j.product.usp}` : j.brand?.usp ? `- USP: ${j.brand.usp}` : '- USP: (bổ sung ở Danh mục)',
    '',
    '2. Thông điệp và cách làm',
    j.note ? `- ${j.note}` : '- (content note từ listing / plan)',
    '',
    '3. Lưu ý từ brand',
    j.brand?.guideline ? j.brand.guideline : '- (bổ sung brand guideline ở Danh mục)',
    '',
    '4. Tiêu chí nghiệm thu',
    ...checklist.map((c) => `- ${c}`),
  ].join('\n');
}

/**
 * Chọn dòng plan cho từng job mới: cùng tier KOC (dòng tier "Bất kỳ" nếu không có), lấp dòng sớm nhất còn thiếu theo thứ tự
 * truyền vào (tuần tăng dần); đầy hết thì dòng cuối. Không có dòng phù hợp: null (job ngoài plan).
 */
export function linePicker<L extends { id: string; tier: string | null; quantity: number; used: number }>(all: L[]) {
  const lines = all.filter((l) => l.quantity > 0); // dòng chỉ giữ ngân sách (0 KOC) không nhận job
  const used = new Map(lines.map((l) => [l.id, l.used]));
  return (tier: string | null): L | null => {
    const same = lines.filter((l) => l.tier === tier);
    const pool = same.length ? same : lines.filter((l) => !l.tier);
    const l = pool.find((x) => used.get(x.id)! < x.quantity) ?? pool.at(-1);
    if (l) used.set(l.id, used.get(l.id)! + 1);
    return l ?? null;
  };
}
