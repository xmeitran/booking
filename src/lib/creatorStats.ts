// Chỉ số 30 ngày của KOL (follower, lượt xem TB, số món bán, GMV) từ TikTok Shop Creator Marketplace.
// Gọi qua Trạm dữ liệu TikTok (Data-tiktok, POST /api/console) bằng token shop nó đang giữ: Booking Hub
// KHÔNG giữ token TikTok, vì làm mới token ở 2 nơi sẽ làm token bên kia mất hiệu lực.
import { db } from './db';

const SEARCH = '/affiliate_seller/202608/marketplace_creators/search';
const PERF = (openId: string) => `/affiliate_seller/202508/marketplace_creators/${encodeURIComponent(openId)}`;
const RATE_LIMITED = 36009002; // hạn mức tần suất tính chung cả nhóm app, Trạm dữ liệu cũng dùng
const NO_ECOMMERCE = 16901008; // creator không còn quyền thương mại điện tử / đã khoá
const GAP_MS = 25_000; // đo 04/11/2026: cách 15s là bị chặn, ~30s thì qua
const RETRY_MS = 60_000; // bị chặn tần suất: chờ rồi thử lại, tối đa 3 lần
const RUN_MS = 9 * 60_000; // mỗi lượt (mỗi giờ) tối đa 9 phút: ~20 lượt gọi, ~480/ngày, xa hạn mức 10.000/ngày
const LIMITED = 'TikTok chặn tần suất, lượt sau làm tiếp';
const TIKTOK_USERNAME = /^[a-z0-9._]{2,24}$/;

async function station(path: string, init?: RequestInit) {
  const auth = Buffer.from(`${process.env.DATA_TIKTOK_USER}:${process.env.DATA_TIKTOK_PASSWORD}`).toString('base64');
  const res = await fetch(`${process.env.DATA_TIKTOK_URL}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', 'x-requested-with': 'tiktok-data' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Trạm dữ liệu ${path}: HTTP ${res.status}`);
  return res.json();
}

/** Shop VN đang hoạt động, có quyền Creator Marketplace: dùng token của nó để tra. */
async function pickShop() {
  const accounts: { id: string; kind: string; status: string; shop_names?: string[]; scopes?: string[] }[] = await station('/api/accounts');
  const { rows: shops } = await station('/api/records?source=shops&limit=100');
  for (const s of shops as { name: string; region: string; cipher: string; gone_at: string | null }[]) {
    if (s.gone_at || s.region !== 'VN' || !s.cipher) continue;
    const a = accounts.find((x) => x.kind === 'seller' && x.status === 'active' && x.shop_names?.includes(s.name)
      && x.scopes?.some((sc) => sc.includes('creator_marketplace')));
    if (a) return { accountId: a.id, shopCipher: s.cipher };
  }
  throw new Error('Trạm dữ liệu chưa có shop VN nào được cấp quyền seller.creator_marketplace.read');
}

const int = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? undefined : Math.round(Number(v)));

type Money = { amount?: string; currency?: string; formatted_range?: string };

/** Hồ sơ creator → cột của KOC. Trường TikTok không trả thì để undefined (giữ giá trị cũ). */
export function toStats(c: Record<string, unknown>) {
  const gmv = c.gmv as Money | undefined, gmvRange = c.gmv_range as Money | undefined, gpm = c.gpm as Money | undefined;
  return {
    nickname: (c.nickname as string) || undefined,
    followers: int(c.follower_count),
    avgViews: int(c.avg_ec_video_play_count),
    avgLiveViews: int(c.avg_ec_live_view_count),
    unitsSold: int(c.units_sold),
    // Creator cho phép chia sẻ số chính xác thì có gmv.amount (đo được: USD), không thì chỉ có khoảng, vd "1M₫+".
    gmvRange: gmv?.amount && Number.isFinite(Number(gmv.amount))
      ? `${Math.round(Number(gmv.amount)).toLocaleString('vi-VN')} ${gmv.currency ?? ''}`.trim()
      : gmvRange?.formatted_range,
    gpmUsd: gpm?.currency === 'USD' && Number.isFinite(Number(gpm.amount)) ? Number(gpm.amount) : undefined,
    creatorLevel: int(c.creator_level),
  };
}

/** Một lượt: tra creator_open_id cho KOL mới, cập nhật chỉ số KOL cũ quá 7 ngày. Dừng ngay khi TikTok chặn tần suất. */
export async function refreshCreatorStats() {
  const shop = await pickShop();
  // KOL chưa tra trước, rồi KOL có booking gần đây. Không có trên Marketplace thì 30 ngày tra lại.
  const due = await db.$queryRaw<{ id: string; handle: string; ttsOpenId: string | null }[]>`
    with recent as (select lower(channel) h, max("larkUpdatedAt") last from "Booking" where channel is not null group by 1)
    select k.id, k.handle, k."ttsOpenId" from "Koc" k left join recent r on r.h = k.handle
    where k.platform = 'TikTok' and (
      k."ttsCheckedAt" is null
      or (k."ttsOpenId" is null and k."ttsCheckedAt" < now() - interval '30 days')
      or (k."ttsOpenId" is not null and (k."statsAt" is null or k."statsAt" < now() - interval '7 days')))
    order by (k."ttsCheckedAt" is null) desc, r.last desc nulls last
    limit 40`;

  let calls = 0, updated = 0, missing = 0, failed = 0;
  let stop: string | null = null;
  const deadline = Date.now() + RUN_MS;
  const timeLeft = () => Date.now() < deadline;
  const call = async (method: 'GET' | 'POST', path: string, body?: object) => {
    for (let tries = 0; ; tries++) {
      if (calls++) await new Promise((r) => setTimeout(r, tries ? RETRY_MS : GAP_MS));
      const r = await station('/api/console', {
        method: 'POST',
        body: JSON.stringify({ mode: 'raw', ...shop, method, path, query: method === 'POST' ? { page_size: 12 } : {}, ...(body && { body }) }),
      });
      if (r.code !== RATE_LIMITED || tries === 2 || !timeLeft()) return { ok: Boolean(r.ok), code: r.code as number | null, data: r.response?.data };
    }
  };

  for (const k of due) {
    if (!timeLeft()) break;
    let openId = k.ttsOpenId;
    if (!openId && !TIKTOK_USERNAME.test(k.handle)) {
      // ID kênh nhập sai bên Lark (có dấu cách, " - FB"...): không tốn lượt gọi tìm kiếm.
      await db.koc.update({ where: { id: k.id }, data: { ttsCheckedAt: new Date() } });
      missing++;
      continue;
    }
    if (!openId) {
      const r = await call('POST', SEARCH, { keyword: k.handle });
      if (r.code === RATE_LIMITED) { stop = LIMITED; break; }
      if (!r.ok) { failed++; continue; }
      // keyword khớp cả username lẫn nickname: chỉ nhận đúng username.
      const hit = (r.data?.creators ?? []).find((c: { username?: string }) => String(c.username).toLowerCase() === k.handle);
      if (!hit) {
        await db.koc.update({ where: { id: k.id }, data: { ttsCheckedAt: new Date() } });
        missing++;
        continue;
      }
      openId = hit.creator_open_id as string;
      await db.koc.update({ where: { id: k.id }, data: { ttsOpenId: openId, ttsCheckedAt: new Date() } });
    }
    if (!timeLeft()) break;
    const p = await call('GET', PERF(openId));
    if (p.code === RATE_LIMITED) { stop = LIMITED; break; }
    if (p.code === NO_ECOMMERCE) {
      await db.koc.update({ where: { id: k.id }, data: { ttsOpenId: null, ttsCheckedAt: new Date() } });
      missing++;
    } else if (p.ok && p.data?.creator) {
      await db.koc.update({ where: { id: k.id }, data: { ...toStats(p.data.creator), statsAt: new Date(), ttsCheckedAt: new Date() } });
      updated++;
    } else failed++;
  }
  return { calls, updated, missing, failed, stop };
}
