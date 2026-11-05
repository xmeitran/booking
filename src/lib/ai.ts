// Content Copilot: Claude viết brief nháp cho job; B2C sửa và duyệt trước khi gửi KOC.
// Bật khi có ANTHROPIC_API_KEY. Chỉ gửi thông tin công khai của KOC (kênh, tệp, số TikTok) và của brand / sản phẩm;
// không gửi SĐT, địa chỉ, tài khoản, CCCD.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

const SYSTEM = `Bạn là chuyên viên booking KOC của team MKT B2C UpBase. Viết brief gửi KOC TikTok bằng tiếng Việt: rõ ràng, thân thiện, đọc trên điện thoại được.
Chỉ dùng thông tin trong dữ liệu được cung cấp. Thiếu thông tin nào thì ghi "(cần bổ sung: ...)" đúng chỗ đó, không tự bịa USP, giá, ưu đãi hay công dụng.
Không viết claim y tế, cam kết hiệu quả, hay so sánh với đối thủ nếu brand guideline không cho phép rõ ràng.
Bố cục, mỗi mục là tiêu đề ngắn rồi gạch đầu dòng:
1. Sản phẩm và USP
2. Thông điệp chính (1–2 câu)
3. Gợi ý kịch bản: hook 3 giây đầu, thân video, CTA gắn giỏ; điều chỉnh theo tệp kênh và cấp KOC
4. Bắt buộc có / không được làm (theo brand guideline)
5. Tiêu chí nghiệm thu (giữ nguyên danh sách được cung cấp)
6. Định dạng, deadline, cách nộp link
Chỉ trả về nội dung brief, không giải thích thêm.`;

export type BriefInput = {
  brand: string | null; brandUsp: string | null; guideline: string | null;
  product: string | null; productUsp: string | null; productLink: string | null;
  koc: { handle: string; name: string; niche: string | null; tier: string | null; followers: number | null; avgViews: number | null };
  format: string; deadline: string | null; note: string | null; checklist: string[];
};

export async function aiBrief(input: BriefInput): Promise<string> {
  const client = new Anthropic();
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'medium' }, // brief ngắn, không cần suy luận sâu
    // Bị bộ lọc an toàn từ chối thì máy chủ tự chạy lại bằng model dự phòng phù hợp.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{ role: 'user', content: `Dữ liệu job (JSON):\n${JSON.stringify(input, null, 2)}\n\nViết brief cho KOC này.` }],
  });
  if (res.stop_reason === 'refusal') throw new Error('AI từ chối viết brief này, dùng "Tạo brief nháp" rồi sửa tay.');
  const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n').trim();
  if (!text) throw new Error('AI không trả về nội dung.');
  return text;
}
