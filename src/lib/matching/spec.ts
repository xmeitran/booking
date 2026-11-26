// Đặc tả Creator matching theo "Tổng hợp tiêu chí chuẩn hóa – AI Creator Matching (v0.1)", Lark docx
// C6NNdKVzdol43txs9Xylw5bKg4d: luồng 10 bước (Sơ đồ 2), knock-out K1–K15 (3.2), chấm điểm 6 nhóm (3.3), thư viện nhóm 0,
// trọng số theo kênh, thang kết luận, tiêu chí riêng Threads. Chỉ là dữ liệu; cách tính ở engine.ts.
// Doc chỉ cho mốc 1 / 3 / 5 điểm; khoảng giữa hai mốc (vd view rate 5–10%) được 2 hoặc 4 điểm.

export const STEPS = [
  { n: 1, title: 'Đầu vào', hint: 'Brand, cấu hình SKU và nhu cầu đợt (Khối 1–4)' },
  { n: 2, title: 'Pool ứng viên', hint: 'Danh bạ KOC + kho creator, lọc ngành và ngưỡng kênh' },
  { n: 3, title: 'Loại bằng dữ liệu', hint: 'K6, K7, K9, K10, K13, K15 tự động' },
  { n: 4, title: 'Loại theo nội dung', hint: 'K1, K2, K3, K4, K5, K8, K11 trên 20–30 video gần nhất' },
  { n: 5, title: 'Chấm sơ bộ & shortlist', hint: 'Chấm A–E, lấy top N để liên hệ' },
  { n: 6, title: 'KOC báo giá & xác nhận', hint: 'Rate card, ads code, cam kết đối thủ, chứng chỉ (K8, K12, K14)' },
  { n: 7, title: 'Chấm hoàn chỉnh', hint: 'Tính CPV theo giá báo, nhóm 0, nhóm D, tổng 0–100' },
  { n: 8, title: 'B2C duyệt', hint: 'Duyệt list, kiểm tra ngân sách, số KOC theo KL, mục tiêu GMV' },
  { n: 9, title: 'Xuất list', hint: 'Ẩn K15; kèm điểm 6 nhóm, mức kết luận và lý do chính' },
  { n: 10, title: 'Đánh giá sau air', hint: 'GMV/video, CPV, ROI → book lại, vào core hoặc dừng' },
] as const;

/**
 * Trạng thái của một ứng viên trong đợt. Không bước nào xoá KOC khỏi danh sách: KOC không qua bước chỉ đổi trạng thái
 * và xếp xuống dưới (OUT = không khớp bộ lọc pool, vẫn giữ để xem).
 */
export const STAGES = {
  APPROVED: 'B2C đã duyệt',
  CONFIRMED: 'Đã báo giá',
  SHORTLIST: 'Shortlist',
  POOL: 'Trong pool',
  REJECTED: 'Đã loại',
  KO: 'Bị loại tự động',
  OUT: 'Ngoài pool',
} as const;
export type Stage = keyof typeof STAGES;
/** Thứ tự xếp danh sách ở mọi bước: đi xa nhất lên đầu, trong cùng trạng thái xếp theo điểm. */
export const STAGE_ORDER = Object.keys(STAGES) as Stage[];
/** KOC "được chọn" ở từng bước (lên đầu, không mờ); còn lại xếp dưới. */
export const STEP_PICKED: Record<number, Stage[]> = {
  2: ['APPROVED', 'CONFIRMED', 'SHORTLIST', 'POOL', 'REJECTED', 'KO'], 3: ['APPROVED', 'CONFIRMED', 'SHORTLIST', 'POOL'], 4: ['APPROVED', 'CONFIRMED', 'SHORTLIST', 'POOL'],
  5: ['APPROVED', 'CONFIRMED', 'SHORTLIST'], 6: ['APPROVED', 'CONFIRMED'], 7: ['APPROVED', 'CONFIRMED', 'SHORTLIST'], 8: ['APPROVED'], 9: ['APPROVED'], 10: ['APPROVED'],
};
export const STAGE_TONE: Record<Stage, string> = {
  KO: 'bg-critical-soft text-critical', POOL: 'bg-sunken text-ink-2', SHORTLIST: 'bg-accent-soft text-accent', OUT: 'bg-sunken text-ink-3',
  CONFIRMED: 'bg-warning-soft text-warning', APPROVED: 'bg-positive-soft text-positive', REJECTED: 'bg-critical-soft text-critical',
};

/**
 * Mã loại. step: 3 = app tự kiểm từ dữ liệu, 4 = Booker kiểm nội dung kênh (kho chưa có lời thoại / hình video),
 * 6 = theo KOC khai báo, 0 = quy tắc của app / brand. internal: không xuất ra list gửi brand (K15).
 */
export const KO = {
  K1: { label: 'Scandal', step: 4, rule: 'Có phốt chưa xử lý trong 12 tháng, hoặc tin phốt / lừa đảo / phát ngôn phản cảm trong cửa sổ brand đặt' },
  K2: { label: 'QC hàng nhạy cảm, hàng giả', step: 4, rule: 'Trong 6 tháng có QC cờ bạc, vay tiền, hàng fake, TPCN claim chữa bệnh; hoặc hàng giả / không rõ nguồn gốc trong top 5 SP bán 90 ngày' },
  K3: { label: 'Uy tín brand đã hợp tác', step: 4, rule: '< 50% brand hợp tác 90 ngày có gian Mall / Official (chỉ khi brand bật)' },
  K4: { label: 'Claim quá, từ cấm', step: 4, rule: '≥ 1 từ cấm trong 10 video gắn giỏ gần nhất, hoặc từng dính phốt nói quá' },
  K5: { label: 'Ngôn ngữ, hình ảnh nhạy cảm', step: 4, rule: '≥ 2/20 video hở hang phản cảm, từ tục, câu view gây tranh cãi (Mẹ & bé, sức khoẻ: ≥ 1)' },
  K6: { label: 'Trùng KOC trong brand', step: 3, rule: 'Số ngày từ lần book gần nhất cùng brand < cửa sổ chống trùng' },
  K7: { label: 'Trùng cùng tập đoàn / ngành con', step: 3, rule: 'Đang chạy cho brand cùng tập đoàn hoặc ngành con tại UpBase trong tháng air' },
  K8: { label: 'Đăng đối thủ', step: 4, rule: 'Có video SP đối thủ cùng công dụng, giá ±30% trong cửa sổ trước air; hoặc không cam kết sau air' },
  K9: { label: 'Ngưỡng kênh', step: 3, rule: 'Dưới ngưỡng follower / view trung vị (và các ngưỡng Must have) brand đặt cho KL; không áp Threads' },
  K10: { label: 'Tệp follower bắt buộc', step: 3, rule: '% nữ, % 18–34, % khu vực dưới ngưỡng của SKU' },
  K11: { label: 'Trường hợp loại riêng SKU', step: 4, rule: 'Rơi vào "Các TH loại" của SKU' },
  K12: { label: 'Chuyên môn', step: 6, rule: 'Nội dung có claim chuyên môn mà KOC không có chứng chỉ hành nghề' },
  K13: { label: 'Tài khoản bán hàng', step: 3, rule: 'Không có quyền gắn giỏ hoặc có cảnh báo vi phạm 90 ngày (chỉ khi mục tiêu Convert)' },
  K14: { label: 'Ads code / reup', step: 6, rule: 'Không đồng ý ads code / Spark Ads khi brand chạy GMV Max' },
  K15: { label: 'Tác phong (nội bộ)', step: 3, internal: true, rule: 'Huỷ job; trễ > 2 ngày từ 2 lần trong 3 job gần nhất; phản ánh thái độ trong 6 tháng' },
  POOL: { label: 'Ngoài bộ lọc pool', step: 2, rule: 'GMV ngành dưới ngưỡng (I-21) hoặc KL không nằm trong số KOC cần book (I-32)' },
  BL: { label: 'Blacklist', step: 0, rule: 'KOC đang trong blacklist của Danh bạ' },
  BR: { label: 'Đã đánh giá không phù hợp brand', step: 0, rule: 'Lượt đánh giá kênh mới nhất cho brand này là "Không phù hợp"' },
  I36: { label: 'Brand loại', step: 0, rule: 'Nằm trong danh sách KOC brand cấm (I-36)' },
  G0: { label: 'Không đạt yêu cầu bắt buộc của brand', step: 5, rule: 'Tiêu chí nhóm 0 gắn nhãn "Bắt buộc" dưới mức 3 điểm' },
  SCORE: { label: 'Điểm thấp', step: 5, rule: 'Booker loại vì nhóm điểm thấp' },
  OTHER: { label: 'Lý do khác', step: 0, rule: '' },
} as const satisfies Record<string, { label: string; step: number; rule: string; internal?: boolean }>;
export type KoCode = keyof typeof KO;
export const koLabel = (code: string) => (code in KO ? `${code} · ${KO[code as KoCode].label}` : code);
/** Mã Booker kiểm tay ở bước 4. K3 chỉ khi brand bật, K11 chỉ khi SKU có trường hợp loại. */
export const CONTENT_CHECKS = ['K1', 'K2', 'K3', 'K4', 'K5', 'K8', 'K11'] as const;
export type ContentCheck = (typeof CONTENT_CHECKS)[number];

export const CHANNELS = ['TikTok', 'Shopee', 'FB-IG', 'Threads'] as const;
export type Channel = (typeof CHANNELS)[number];
/** Kênh của đợt → nền tảng của KOC / creator. */
export const CHANNEL_PLATFORMS: Record<Channel, string[]> = { TikTok: ['TikTok'], Shopee: ['Shopee'], 'FB-IG': ['Facebook', 'Instagram'], Threads: ['Threads'] };
export const OBJECTIVES = ['Convert', 'Awareness'] as const;

export const GROUPS = ['G0', 'A', 'B', 'C', 'D', 'E'] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_LABEL: Record<Group, string> = {
  G0: '0. Yêu cầu riêng brand', A: 'A. Fit thương hiệu & tệp', B: 'B. Reach & tương tác', C: 'C. Chuyển đổi', D: 'D. Chất lượng nội dung', E: 'E. Hợp tác, chi phí & lịch sử',
};
/** Trọng số nhóm theo kênh (%), cộng 100. */
export const WEIGHTS: Record<Channel, Record<Group, number>> = {
  TikTok: { G0: 20, A: 15, B: 5, C: 35, D: 10, E: 15 },
  Shopee: { G0: 20, A: 15, B: 3, C: 37, D: 10, E: 15 },
  'FB-IG': { G0: 20, A: 15, B: 5, C: 35, D: 10, E: 15 },
  Threads: { G0: 20, A: 15, B: 5, C: 35, D: 10, E: 15 },
};

/** Bậc điểm: [cận trên (không gồm), điểm]; giá trị ≥ mọi cận thì lấy điểm của bậc cuối (cận Infinity). */
export type Bands = readonly (readonly [number, number])[];
export const band = (v: number, bands: Bands) => bands.find(([upTo]) => v < upTo)?.[1] ?? bands[bands.length - 1][1];

/**
 * Tiêu chí con. auto: app tự chấm khi có số liệu (cách tính ở engine.ts); không auto thì Booker chấm tay 1–5.
 * Booker luôn chấm tay đè được điểm tự động (ghi lý do). scale: mô tả 1 / 3 / 5 điểm theo doc.
 */
export type Criterion = { id: string; group: Group; label: string; measure: string; scale: [string, string, string]; auto?: boolean; channels?: Channel[]; notChannels?: Channel[] };
export const CRITERIA: Criterion[] = [
  { id: 'A1', group: 'A', label: 'Tệp follower khớp TA', measure: '% follower khớp giới tính, tuổi, vùng của SKU', scale: ['< 40%', '50–70%', '> 70%'], auto: true },
  { id: 'A2', group: 'A', label: 'Niche & ngành', measure: 'Tỷ trọng GMV ngành của brand (thay % video cùng ngành); khớp tệp kênh ưu tiên của SKU', scale: ['< 20%', '30–60%', '> 60%'], auto: true },
  { id: 'A3', group: 'A', label: 'Tone khớp brand', measure: 'So tone với top 10 brand đối thủ trực tiếp và gián tiếp', scale: ['Lệch tone', 'Trung tính', 'Có thể là gương mặt brand'] },
  { id: 'B1', group: 'B', label: 'View rate', measure: 'View trung vị ÷ follower', scale: ['< 5%', '10–20%', '> 30%'], auto: true, notChannels: ['Threads'] },
  { id: 'B2', group: 'B', label: 'Engagement rate', measure: '(like + comment + share) ÷ view', scale: ['< 2%', '4–6%', '> 8%'], auto: true, notChannels: ['Threads'] },
  { id: 'B3', group: 'B', label: 'Độ ổn định view', measure: 'Số video trong 10 video gần nhất đạt ≥ 50% view trung vị', scale: ['≤ 4/10', '6–7/10', '≥ 8/10'], notChannels: ['Threads'] },
  { id: 'TB1', group: 'B', label: 'View TB 10 bài gần nhất', measure: 'Threads: view trung bình 10 bài gần nhất', scale: ['< 200', '200–500', '> 1.000'], channels: ['Threads'] },
  { id: 'TB2', group: 'B', label: 'ER Threads', measure: 'Reply + repost trung bình mỗi bài', scale: ['Ít reply, không repost', 'Reply đều', 'Reply dài, tranh luận, repost'], channels: ['Threads'] },
  { id: 'TB3', group: 'B', label: 'View bài cao nhất 30 ngày', measure: 'Threads: view bài cao nhất trong 30 ngày', scale: ['Chưa có bài > 2K', 'Có bài 5K–10K', 'Có bài > 10K'], channels: ['Threads'] },
  { id: 'C1', group: 'C', label: 'GMV / video affiliate', measure: 'GMV 30 ngày ÷ số video gắn giỏ, so benchmark GMV/video theo KL', scale: ['< 50%', '80–120%', '> 150%'], auto: true },
  { id: 'C2', group: 'C', label: 'Historical data', measure: 'Video đã làm cho UpBase (data seller: view, GMV 30 ngày)', scale: ['Chưa từng', '1–3 video', '> 3 video, có đơn tốt'], auto: true },
  { id: 'D1', group: 'D', label: 'Hook & storytelling', measure: '3 giây đầu, pain point, lồng SP tự nhiên, CTA rõ (5 video gần nhất)', scale: ['Đọc QC khô', 'Có hook, lồng được SP', 'Hook mạnh, lồng tự nhiên, CTA rõ'], notChannels: ['Threads'] },
  { id: 'D2', group: 'D', label: 'Demo & USP', measure: 'Nói đúng USP / RTB, demo thật, không claim quá', scale: ['Chung chung / claim quá', 'Đúng USP', 'Demo thuyết phục'] },
  { id: 'D3', group: 'D', label: 'Kỹ thuật hình & tiếng', measure: 'Ánh sáng, khung hình, âm thanh, phụ đề', scale: ['Kém', 'Ổn', 'Chuyên nghiệp'], notChannels: ['Threads'] },
  { id: 'TD1', group: 'D', label: 'Hook & kỹ thuật viết', measure: 'Threads: kể chuyện, quan điểm, trải nghiệm thật', scale: ['Văn mẫu QC', 'Tự nhiên', 'Cá tính rõ, tạo tranh luận'], channels: ['Threads'] },
  { id: 'TD3', group: 'D', label: 'Kỹ thuật hình', measure: 'Threads: ảnh thật, screenshot, SP thật', scale: ['Ảnh AI / stock', 'Ảnh thật', 'Ảnh trải nghiệm đúng ngữ cảnh'], channels: ['Threads'] },
  { id: 'E1', group: 'E', label: 'Chi phí / hiệu quả (CPV)', measure: 'Giá ÷ view trung vị, so benchmark CPV theo KL', scale: ['> 1,5×', '≈ 1×', '< 0,7×'], auto: true, notChannels: ['Threads'] },
  { id: 'TE1', group: 'E', label: 'CPV Threads', measure: 'Giá ÷ view TB (mục tiêu ≤ 500 ₫; cast thị trường ~200K / bài)', scale: ['> 800 ₫', '300–500 ₫', '< 300 ₫'], auto: true, channels: ['Threads'] },
  { id: 'E2', group: 'E', label: 'Rating Booker', measure: 'TB sao 3 job gần nhất; KOC mới chưa có rating tính 3 điểm', scale: ['< 2,5', '3–3,9', '≥ 4,5'], auto: true },
  { id: 'E3', group: 'E', label: 'Lịch sử UpBase 6 tháng', measure: '% job đạt KPI view/GMV, % air đúng hạn', scale: ['Không đạt KPI hoặc trễ ≥ 2 lần', 'Chưa hợp tác / đạt KPI 1 lần', 'Đạt KPI ≥ 2 lần, 100% đúng hạn'], auto: true },
  { id: 'TE4', group: 'E', label: 'Sẵn sàng air theo wave', measure: 'Threads: có sample, đúng khung giờ, nộp demo đúng hạn', scale: ['Không sample, air tuỳ ý', 'Air theo lịch', 'Có sample, nhận wave, đã trong Group Core'], channels: ['Threads'] },
];

/** Thư viện tiêu chí nhóm 0: brand chọn 3–5, mỗi tiêu chí "Bắt buộc" (lọc) hoặc "Cộng điểm" (chấm 1/3/5). */
export const GROUP0: Criterion[] = [
  { id: 'G0_PORTRAIT', group: 'G0', label: 'Chân dung khớp brand', measure: 'Đối chiếu giới tính, tuổi, ngoại hình, visual bắt buộc của SKU trong video', scale: ['Không khớp', 'Khớp 1 phần', 'Khớp hoàn toàn, có minh chứng'] },
  { id: 'G0_REAL', group: 'G0', label: 'Trải nghiệm thật với vấn đề SP', measure: 'Số video nói về vấn đề của SP trong 90 ngày', scale: ['0', '1–2', '≥ 3, có before/after'] },
  { id: 'G0_PREMIUM', group: 'G0', label: 'Hình ảnh cao cấp', measure: '% trong 10 video đạt checklist (bối cảnh gọn, sáng, trang phục chỉn chu)', scale: ['< 30%', '50–70%', '> 80% và từng làm brand premium'] },
  { id: 'G0_LIFESTYLE', group: 'G0', label: 'Kênh lifestyle', measure: '% video lifestyle / vlog / aesthetic và % video gắn giỏ trong 30 ngày', scale: ['Lifestyle < 30% hoặc gắn giỏ > 70%', 'Lifestyle 40–60%', 'Lifestyle > 60%, gắn giỏ < 40%'], auto: true },
  { id: 'G0_VOICE', group: 'G0', label: 'Tone giọng tự nhiên', measure: 'Voice thật, chia sẻ trải nghiệm, nêu ưu–nhược (20 video)', scale: ['Đọc kịch bản công nghiệp', 'Tự nhiên một phần', 'Tự nhiên, có trải nghiệm riêng'] },
  { id: 'G0_VISUAL', group: 'G0', label: 'Visual thật, không filter', measure: '≥ 2/3 video quay da / tóc / tay thật; 0 video filter làm mịn da hoặc đổi màu bao bì', scale: ['Lạm dụng filter', 'Ít filter', 'Đạt chuẩn'] },
  { id: 'G0_REGION', group: 'G0', label: 'Tệp theo vùng miền', measure: '% follower tại khu vực SKU yêu cầu', scale: ['< 40%', '50–60%', '> 70%'], auto: true },
  { id: 'G0_AFFORD', group: 'G0', label: 'Khả năng chi trả', measure: 'GMV trung bình / người mua của KOC ÷ giá SKU', scale: ['< 50%', '50–80%', '≥ 80%'], auto: true },
  { id: 'G0_FEWBOOK', group: 'G0', label: 'Ít booking', measure: '% video tài trợ 30 ngày; số brand cùng ngành đã review', scale: ['> 70% hoặc ≥ 3 brand', '40–60%', '< 30% và ≤ 1 brand'] },
  { id: 'G0_FREQ', group: 'G0', label: 'Tần suất đăng', measure: 'Video / tuần trong 30 ngày', scale: ['< 1', '2–3', '≥ 4'], auto: true },
  { id: 'G0_FORMAT', group: 'G0', label: 'Đúng format', measure: '% trong 10 video đúng format brief', scale: ['< 50%', '50–80%', '> 80%'] },
  { id: 'G0_ADS', group: 'G0', label: 'Ads code / reup', measure: 'Số ngày ads code KOC đồng ý so yêu cầu; reup đa kênh (bước 6)', scale: ['Không đồng ý', 'Thiếu ngày', 'Đủ ngày + reup đa kênh'], auto: true },
  { id: 'G0_SCRIPT', group: 'G0', label: 'Nhận duyệt kịch bản, lịch air', measure: 'Số vòng sửa KOC nhận, air đúng khung giờ (bước 6)', scale: ['Không sửa, air tuỳ ý', '1 vòng', '2 vòng, đúng giờ'], auto: true },
];
export const ALL_CRITERIA = [...GROUP0, ...CRITERIA];
export const criterion = (id: string) => ALL_CRITERIA.find((c) => c.id === id);
export const criteriaFor = (group: Group, channel: Channel) =>
  CRITERIA.filter((c) => c.group === group && (!c.channels || c.channels.includes(channel)) && !c.notChannels?.includes(channel));

/** Bậc điểm của các tiêu chí tự động (giá trị tỷ lệ 0..1, trừ ghi chú khác). */
export const BANDS = {
  A1: [[0.4, 1], [0.5, 2], [0.7, 3], [Infinity, 5]],
  A2: [[0.2, 1], [0.3, 2], [0.6, 3], [Infinity, 5]],
  B1: [[0.05, 1], [0.1, 2], [0.2, 3], [0.3, 4], [Infinity, 5]],
  B2: [[0.02, 1], [0.04, 2], [0.06, 3], [0.08, 4], [Infinity, 5]],
  C1: [[0.5, 1], [0.8, 2], [1.2, 3], [1.5, 4], [Infinity, 5]], // so với benchmark
  E1: [[0.7, 5], [0.9, 4], [1.1, 3], [1.5, 2], [Infinity, 1]], // so với benchmark, thấp là tốt
  TE1: [[300, 5], [500, 3], [800, 2], [Infinity, 1]], // VND / view
  E2: [[2.5, 1], [3, 2], [4, 3], [4.5, 4], [Infinity, 5]], // sao TB
  G0_REGION: [[0.4, 1], [0.5, 2], [0.6, 3], [0.7, 4], [Infinity, 5]],
  G0_AFFORD: [[0.5, 1], [0.8, 3], [Infinity, 5]],
  G0_FREQ: [[1, 1], [2, 2], [3, 3], [4, 4], [Infinity, 5]], // video / tuần
} satisfies Record<string, Bands>;

/** Thang kết luận. KOC fail knock-out bị loại bất kể tổng điểm. */
export const TIERS = [
  { min: 80, label: 'Ưu tiên book / KOC core', action: 'Book theo kế hoạch, đề xuất ký HĐ nguyên tắc + SOW, ưu tiên book lại', recommend: 'Must Have', tone: 'bg-positive-soft text-positive' },
  { min: 65, label: 'Book test', action: 'Book thử 1–2 video, xét lại theo GMV/video và CPV trong Report phễu', recommend: 'Recommend', tone: 'bg-accent-soft text-accent' },
  { min: 50, label: 'Chỉ mời TAP / hoa hồng', action: 'Không trả fee; gửi mẫu + hoa hồng, theo dõi đơn', recommend: 'Optional', tone: 'bg-warning-soft text-warning' },
  { min: 0, label: 'Không hợp tác', action: 'Ghi lý do (mã K hoặc nhóm điểm thấp) vào lịch sử KOC', recommend: null, tone: 'bg-critical-soft text-critical' },
] as const;
export const NO_DATA_TIER = { label: 'Chưa đủ dữ liệu', action: 'Bổ sung số liệu hoặc Booker chấm tay các tiêu chí còn trống', recommend: null, tone: 'bg-sunken text-ink-3' };
/**
 * Kho chưa có nội dung video nên nhóm D và nhiều tiêu chí nhóm 0 chỉ có khi Booker chấm tay. Tổng điểm quy về 100 trên
 * phần trọng số có số liệu; độ phủ dưới mức này thì không xếp mức kết luận (tránh điểm cao nhờ có ít số liệu).
 */
export const MIN_COVERAGE = 0.5;
export const tierOf = (total: number) => TIERS.find((t) => total >= t.min)!;

/** Từ điển cấm chung (K4), cộng thêm claim cấm của brand (I-07) và từ cấm của SKU (I-16). */
export const COMMON_BANNED = ['đặc trị', 'chữa khỏi', '100%', 'vĩnh viễn', 'cam kết hiệu quả', 'sau 1 đêm'];

// ---------------------------------------------------------------- Khối 3: quy tắc của brand
export const KL_LEVELS = ['KL1', 'KL2', 'KL3', 'KL4', 'KL5', 'KL6', 'KL7'] as const;
/** Ngưỡng của một KL (I-19) và nhãn Must have (I-20): chỉ số Must mà dưới ngưỡng thì loại (K9), Nice to have thì chỉ cảnh báo. */
export type KlRule = { followersMin?: number; viewsMin?: number; unitsSoldMin?: number; cpvMax?: number; castMax?: number; must?: string[]; approver?: string };
export const KL_METRICS = [
  ['followersMin', 'Follower tối thiểu'], ['viewsMin', 'View trung vị tối thiểu'], ['unitsSoldMin', 'Lượt bán 30 ngày tối thiểu'],
  ['cpvMax', 'CPV tối đa (₫)'], ['castMax', 'Cast tối đa (₫)'],
] as const satisfies readonly (readonly [keyof KlRule, string])[];
export type BrandRules = {
  kl: Partial<Record<string, KlRule>>; // I-19, I-20
  industryGmvMin: number; // I-21 % GMV ngành tối thiểu
  industryContentMin: number; // I-21 % nội dung ngành (kho chưa có, chỉ ghi)
  cooldownDays: number; // I-22
  scandal: '12m+3m' | '3m' | '12m'; // I-23
  k3: boolean; // I-24
  priceBand: number; // I-09 khoảng giá đối thủ ± %
  adsCodeDays: number; // I-25
  reupChannels: string[]; // I-25
  exceptionApprover: string | null; // I-26 user id; trống = người có quyền duyệt list
  holdDays: number; // I-26
  competitorDays: number; // I-56
  group0: { id: string; mode: 'must' | 'score' }[]; // I-27
};
export const DEFAULT_RULES: BrandRules = {
  kl: {}, industryGmvMin: 30, industryContentMin: 20, cooldownDays: 90, scandal: '12m+3m', k3: false, priceBand: 30,
  adsCodeDays: 30, reupChannels: [], exceptionApprover: null, holdDays: 7, competitorDays: 15, group0: [],
};
export const SCANDAL_LABEL: Record<BrandRules['scandal'], string> = { '12m+3m': 'Phốt chưa xử lý 12 tháng + mọi tin phốt 3 tháng', '3m': 'Chỉ 3 tháng', '12m': 'Chỉ 12 tháng' };

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
/** Đọc Brand.rules (JSON) an toàn: thiếu / sai kiểu thì lấy mặc định. */
export function parseRules(raw: unknown): BrandRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<BrandRules>;
  const kl: BrandRules['kl'] = {};
  for (const lv of KL_LEVELS) {
    const x = r.kl?.[lv];
    if (!x || typeof x !== 'object') continue;
    const row: KlRule = {};
    for (const [k] of KL_METRICS) if (typeof x[k] === 'number' && Number.isFinite(x[k])) row[k] = x[k];
    if (Array.isArray(x.must)) row.must = x.must.filter((m) => KL_METRICS.some(([k]) => k === m));
    if (typeof x.approver === 'string' && x.approver) row.approver = x.approver;
    if (Object.keys(row).length) kl[lv] = row;
  }
  const g0 = Array.isArray(r.group0) ? r.group0.filter((g) => g && GROUP0.some((c) => c.id === g.id)).map((g) => ({ id: g.id, mode: g.mode === 'must' ? 'must' as const : 'score' as const })) : [];
  return {
    kl,
    industryGmvMin: num(r.industryGmvMin, DEFAULT_RULES.industryGmvMin),
    industryContentMin: num(r.industryContentMin, DEFAULT_RULES.industryContentMin),
    cooldownDays: num(r.cooldownDays, DEFAULT_RULES.cooldownDays),
    scandal: r.scandal === '3m' || r.scandal === '12m' ? r.scandal : '12m+3m',
    k3: r.k3 === true,
    priceBand: num(r.priceBand, DEFAULT_RULES.priceBand),
    adsCodeDays: num(r.adsCodeDays, DEFAULT_RULES.adsCodeDays),
    reupChannels: Array.isArray(r.reupChannels) ? r.reupChannels.filter((x): x is string => typeof x === 'string') : [],
    exceptionApprover: typeof r.exceptionApprover === 'string' && r.exceptionApprover ? r.exceptionApprover : null,
    holdDays: num(r.holdDays, DEFAULT_RULES.holdDays),
    competitorDays: num(r.competitorDays, DEFAULT_RULES.competitorDays),
    group0: [...new Map(g0.map((g) => [g.id, g])).values()].slice(0, 5),
  };
}

/** Nhu cầu số KOC theo vai trò × KL (I-32). */
export type Slot = { kl: string; role: string; count: number };
export function parseSlots(raw: unknown): Slot[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((s) => s && typeof s === 'object' && KL_LEVELS.includes(s.kl) && Number.isInteger(s.count) && s.count > 0)
    .map((s) => ({ kl: s.kl, role: typeof s.role === 'string' ? s.role : '', count: s.count }));
}

/** Khai báo của KOC ở bước 6 (I-39 – I-41, I-52) và các mục nhóm 0 / Threads lấy từ đó. */
export type Declare = {
  declared?: boolean; // Booker đã ghi khai báo của KOC (bước 6)
  quote?: number; // giá KOC báo (rate card), VND
  priceType?: string;
  adsCode?: boolean; // đồng ý ads code / Spark Ads
  adsDays?: number;
  reup?: string[]; // kênh reup đồng ý
  noCompetitor?: boolean; // cam kết không đăng đối thủ sau air
  certificate?: string; // chứng chỉ hành nghề
  revisions?: number; // số vòng sửa kịch bản / demo nhận
  sample?: boolean; // đã nhận sample (Threads: sẵn sàng wave)
  note?: string;
};
export type Check = { ok: boolean; note?: string; by?: string; at?: string };
export type Manual = Record<string, { score: number; note?: string; by?: string }>;
/** Bước 10. */
export type Outcome = {
  kpiMet?: boolean | null; onTime?: boolean | null; firstPass?: boolean | null; keptPublic?: boolean | null;
  contentError?: 'M1' | 'M2' | 'M3' | null; decision?: 'rebook' | 'core' | 'stop' | null; note?: string; by?: string; at?: string;
};
export const DECISIONS = { rebook: 'Book lại', core: 'Vào KOC core', stop: 'Dừng hợp tác' } as const;
export const CONTENT_ERRORS = {
  M1: 'M1: sửa trước air (tối đa 2 lỗi vẫn duyệt)', M2: 'M2: sửa và duyệt lại; đã air thì gỡ / sửa trong 24 giờ', M3: 'M3: không duyệt; đã air thì gỡ ngay (cờ K4 / K15)',
} as const;
