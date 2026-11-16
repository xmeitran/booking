// Content Copilot nghiệm thu, phần kiểm tra tự động link KOC nộp: link còn sống, đúng kênh, từ khoá / hashtag bắt buộc trong caption.
// Dữ liệu lấy từ oEmbed công khai của TikTok (tác giả + caption). Giỏ hàng, transcript, giây xuất hiện sản phẩm chưa có nguồn
// dữ liệu nên không kiểm tra; các mục đó người nghiệm thu chấm tay theo checklist.
export type Check = { check: string; status: 'PASS' | 'WARN' | 'FAIL'; detail: string };
export type VideoInfo = { live: boolean; finalUrl: string; author: string | null; caption: string | null };

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase();
export const keywordsOf = (raw?: string | null) => (raw ?? '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
/** "…/video/7412345678901234567" → id video; link rút gọn chưa mở thì null. */
export const videoIdOf = (url: string) => url.match(/\/video\/(\d{10,25})/)?.[1] ?? null;

/** Luật chấm (theo linkAirCheck của b2c): sai kênh / link chết → FAIL; thiếu hashtag → FAIL; thiếu từ khoá → WARN. */
export function evaluate(v: VideoInfo, expect: { handle: string; keywords: string[] }): Check[] {
  if (!v.live) return [{ check: 'Link video', status: 'FAIL', detail: 'Không mở được video (đã xoá, riêng tư hoặc link sai).' }];
  // TikTok trả 200 nhưng không kèm tác giả / caption (video giới hạn vùng, vừa đăng): không kết luận được, để người nghiệm thu xem.
  const out: Check[] = [v.author || v.caption != null ? { check: 'Link video', status: 'PASS', detail: v.finalUrl } : { check: 'Link video', status: 'WARN', detail: `TikTok không trả thông tin video, mở link kiểm tra tay: ${v.finalUrl}` }];
  const author = v.author?.replace(/^@/, '').toLowerCase() ?? null;
  out.push(!author ? { check: 'Đúng kênh', status: 'WARN', detail: 'Không đọc được tên kênh từ TikTok, kiểm tra tay.' }
    : author === expect.handle.toLowerCase() ? { check: 'Đúng kênh', status: 'PASS', detail: `@${author}` }
    : { check: 'Đúng kênh', status: 'FAIL', detail: `Video của @${author}, job của @${expect.handle}.` });
  const cap = norm(v.caption ?? '');
  for (const k of expect.keywords) {
    const tag = k.startsWith('#');
    const hit = cap.includes(norm(k));
    out.push({ check: tag ? `Hashtag ${k}` : `Từ khoá "${k}"`, status: hit ? 'PASS' : tag && v.caption != null ? 'FAIL' : 'WARN', detail: hit ? 'Có trong caption.' : v.caption == null ? 'Không đọc được caption.' : 'Không thấy trong caption.' });
  }
  return out;
}

export const verdict = (checks: Check[]) => (checks.some((c) => c.status === 'FAIL') ? 'FAIL' : checks.some((c) => c.status === 'WARN') ? 'WARN' : 'PASS');
export const VERDICT_LABEL = { PASS: 'Đạt', WARN: 'Cần xem lại', FAIL: 'Không đạt' } as const;

/** Mở link (theo chuyển hướng của link rút gọn vt.tiktok.com) rồi hỏi oEmbed. Lỗi mạng coi như không mở được. */
export async function inspect(url: string): Promise<VideoInfo> {
  const dead = { live: false, finalUrl: url, author: null, caption: null };
  if (!/^https:\/\/([\w-]+\.)?tiktok\.com\//i.test(url)) return dead; // chỉ gọi ra tiktok.com: link do KOC nộp, không cho app gọi địa chỉ tuỳ ý
  try {
    const page = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'Mozilla/5.0' } });
    const finalUrl = page.url.split('?')[0];
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(finalUrl)}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ...dead, finalUrl };
    const j = await res.json();
    // Tên kênh: oEmbed, không có thì lấy từ link đầy đủ (…/@kenh/video/…).
    return { live: true, finalUrl, author: j.author_unique_id ?? j.author_url?.match(/@([\w.]+)/)?.[1] ?? finalUrl.match(/\/@([\w.]+)\/video\//)?.[1] ?? null, caption: j.title ?? null };
  } catch { return dead; }
}
