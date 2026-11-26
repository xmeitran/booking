// AI cho Creator matching (Claude): đọc brief của brand để điền yêu cầu đợt, và chấm mức hợp nội dung của creator.
// Chỉ gửi thông tin công khai của creator (tiêu đề video nổi bật, sản phẩm đã gắn, ngành bán, brand từng hợp tác, tệp follower);
// không gửi SĐT, địa chỉ, tài khoản. Key ở Phân quyền → Tích hợp → API AI (ANTHROPIC_API_KEY).
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { cfg, configured } from '../integrations';
import { CHANNELS, KL_LEVELS, OBJECTIVES } from './spec';

export const aiOn = () => configured('ai');

async function askJson<T>(system: string, user: string, schema: Record<string, unknown>, maxTokens = 16000): Promise<T> {
  const apiKey = await cfg('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Chưa gắn key Claude: Admin nhập ở Phân quyền → Tích hợp → API AI.');
  const client = new Anthropic({ apiKey });
  const res = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: maxTokens,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    // Bị bộ lọc an toàn từ chối thì máy chủ tự chạy lại bằng model dự phòng phù hợp.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (res.stop_reason === 'refusal') throw new Error('AI từ chối xử lý nội dung này.');
  if (res.stop_reason === 'max_tokens') throw new Error('AI trả lời quá dài, thử lại với ít nội dung hơn.');
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return JSON.parse(text) as T;
}

const S = (description: string) => ({ type: 'string', description });
const I = (description: string) => ({ type: 'integer', description });
const L = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

export type BriefDraft = {
  name: string; brand: string; product: string; channel: string; objective: string; airMonth: string; airWeek: number;
  budget: number; feeCap: number; gmvTarget: number; dealPrice: number; format: string; slots: { kl: string; count: number; role: string }[];
  summary: string; targetGender: string; ageMin: number; ageMax: number; regions: string[]; tone: string; usp: string;
  competitors: string[]; bannedWords: string[]; exclusions: string[]; keywords: string[];
};

const BRIEF_SCHEMA = obj({
  name: S('Tên đợt ngắn dạng "Brand – sản phẩm – T12/2026"'),
  brand: S('Tên brand đúng y như một dòng trong danh sách brand đưa kèm; không khớp dòng nào thì ""'),
  product: S('Tên sản phẩm đúng y như danh sách sản phẩm của brand đó; không khớp thì ""'),
  channel: { type: 'string', enum: [...CHANNELS], description: 'Kênh đăng video; không rõ thì TikTok' },
  objective: { type: 'string', enum: [...OBJECTIVES], description: 'Convert = mục tiêu bán hàng; Awareness = tăng nhận diện' },
  airMonth: S('Tháng air dạng YYYY-MM; không rõ thì ""'),
  airWeek: I('Tuần air trong tháng (1–5); không rõ thì 0'),
  budget: I('Tổng ngân sách đợt (VND); không rõ thì 0'),
  feeCap: I('Phí tối đa cho mỗi KOC (VND); không rõ thì 0'),
  gmvTarget: I('Mục tiêu GMV (VND); không rõ thì 0'),
  dealPrice: I('Giá bán sản phẩm trong đợt (VND); không rõ thì 0'),
  format: S('Định dạng, thời lượng video; không rõ thì ""'),
  slots: { type: 'array', description: 'Số KOC theo cấp KL; chỉ ghi khi brief nói rõ cấp KL1–KL7, không thì []', items: obj({ kl: { type: 'string', enum: [...KL_LEVELS] }, count: I('Số KOC'), role: S('Vai trò (review, seeding...) hoặc ""') }) },
  summary: S('Tóm tắt yêu cầu trong 2–3 câu: sản phẩm, thông điệp, kiểu KOC cần, số lượng KOC nếu brief có nói'),
  targetGender: { type: 'string', enum: ['Nữ', 'Nam', 'Tất cả', ''], description: 'Giới tính khách mục tiêu' },
  ageMin: I('Tuổi khách mục tiêu từ; không rõ thì 0'),
  ageMax: I('Tuổi khách mục tiêu đến; không rõ thì 0'),
  regions: L('Khu vực ưu tiên nếu có, vd "Hồ Chí Minh"'),
  tone: S('Tone / phong cách mong muốn'),
  usp: S('Điểm bán hàng / thông điệp chính'),
  competitors: L('Tên brand đối thủ được nêu trong brief'),
  bannedWords: L('Từ, claim bị cấm nói'),
  exclusions: L('Kiểu KOC brand không muốn (mỗi ý một dòng)'),
  keywords: L('6–15 từ khoá ngắn (1–4 chữ, tiếng Việt có dấu) để tìm creator có tiêu đề video hoặc sản phẩm đã bán chứa từ đó: loại sản phẩm, công dụng, vấn đề của khách, tên brand đối thủ. Không dùng từ chung như review, sản phẩm, xu hướng'),
});

/** Đọc brief / content plan của brand, trả các trường để điền form đợt matching. brands: danh sách brand ở Danh mục (kèm sản phẩm). */
export function readBrief(text: string, brands: { name: string; products: string[] }[]) {
  const system = `Bạn là trợ lý booking KOC của agency UpBase. Đọc brief brand gửi (tiếng Việt hoặc Anh) và trích thông tin để điền form tìm KOC.
Chỉ lấy thông tin có trong brief. Không có thì để trống ("", 0 hoặc []). Không bịa số liệu, tên đối thủ hay từ cấm.
Riêng "keywords" thì tự suy ra từ sản phẩm và brief để tìm creator phù hợp.`;
  const list = brands.map((b) => `- ${b.name}${b.products.length ? `: ${b.products.slice(0, 30).join('; ')}` : ''}`).join('\n');
  return askJson<BriefDraft>(system, `Danh sách brand (và sản phẩm) trong hệ thống:\n${list || '(trống)'}\n\nBrief:\n"""\n${text}\n"""`, BRIEF_SCHEMA);
}

export type FitInput = {
  handle: string; name: string; followers: number | null; gmv30: number | null; categories: string[]; videos: string[]; brands: string[];
  audience: string | null; keywordHits: string[];
};
export type Fit = { handle: string; score: number; reason: string };

const FIT_SCHEMA = obj({
  results: { type: 'array', items: obj({ handle: S('ID kênh đúng như đầu vào'), score: { type: 'integer', enum: [1, 2, 3, 4, 5] }, reason: S('Một câu, tối đa 25 chữ, nêu bằng chứng cụ thể') }) },
});
const BATCH = 25;

/** Chấm mức hợp nội dung (1–5) của các creator với yêu cầu đợt; chia lô 25, chạy song song. */
export async function rankFit(requirement: string, items: FitInput[]): Promise<Fit[]> {
  const system = `Bạn là chuyên viên booking KOC của agency UpBase. Chấm mức hợp của từng creator TikTok với yêu cầu nội dung của đợt, chỉ dựa trên dữ liệu đưa vào.
5 = nội dung và sản phẩm đã bán đúng ngành / đúng vấn đề của sản phẩm, tone hợp; 4 = khá hợp; 3 = liên quan một phần hoặc thiếu dữ liệu; 2 = ít liên quan; 1 = lệch hẳn.
Lý do viết tiếng Việt, một câu ngắn, nêu bằng chứng (tên video, sản phẩm, ngành). Dữ liệu quá ít thì cho 3 và ghi "ít dữ liệu".`;
  const batches = Array.from({ length: Math.ceil(items.length / BATCH) }, (_, i) => items.slice(i * BATCH, i * BATCH + BATCH));
  const out = await Promise.all(batches.map((b) =>
    askJson<{ results: Fit[] }>(system, `Yêu cầu của đợt:\n${requirement}\n\nCreator (JSON):\n${JSON.stringify(b)}\n\nChấm đủ ${b.length} creator.`, FIT_SCHEMA)));
  const known = new Set(items.map((x) => x.handle));
  return out.flatMap((r) => r.results).filter((r) => known.has(r.handle) && r.score >= 1 && r.score <= 5);
}
