'use server';
// Thao tác của Creator matching theo 10 bước. Mỗi thao tác trên một ứng viên chấm lại ứng viên đó (run.ts rescore)
// rồi chuyển giai đoạn theo quy tắc của doc: trượt mã loại → Đã loại (ghi mã K vào lịch sử KOC).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { optInt, str } from '@/lib/form';
import { audit } from '@/lib/booking/catalog';
import { airDateOf, loadBrief } from '@/lib/matching/data';
import { contentChecksFor, rescore, rescoreMany, runMatching, stageAfterRun } from '@/lib/matching/run';
import { aiOn, rankFit, readBrief, type FitInput } from '@/lib/matching/ai';
import {
  ALL_CRITERIA, CHANNELS, CONTENT_ERRORS, DECISIONS, KL_LEVELS, KO, OBJECTIVES, parseNeeds, parseRules,
  type Check, type Needs, type Declare, type Manual, type Outcome, type Slot,
} from '@/lib/matching/spec';
import { RATING_TAGS } from '@/lib/koc/kocDirectory';
import { can, requireUser, type Me } from '@/lib/auth/session';

const back = (briefId: string, step: number | string, extra = '') => `/matching/${briefId}?step=${step}${extra}`;
const handles = (s: string) => [...new Set(s.split(/[\s,;]+/).map((h) => h.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, '').split(/[/?]/)[0].toLowerCase()).filter(Boolean))];
const pctIn = (fd: FormData, k: string) => { const v = str(fd, k).replace(',', '.').replace('%', ''); if (!v) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : NaN; };

const list = (s: string) => [...new Set(s.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean))];

/** Yêu cầu nội dung trong form đợt (các ô needs_*). */
function needsOf(fd: FormData): Needs {
  const int = (k: string) => { const v = optInt(fd, k); return v && !Number.isNaN(v) ? v : undefined; };
  return parseNeeds({
    summary: str(fd, 'needs_summary'), targetGender: str(fd, 'needs_targetGender'), ageMin: int('needs_ageMin'), ageMax: int('needs_ageMax'),
    regions: list(str(fd, 'needs_regions')), tone: str(fd, 'needs_tone'), usp: str(fd, 'needs_usp'), competitors: list(str(fd, 'needs_competitors')),
    bannedWords: list(str(fd, 'needs_bannedWords')), exclusions: list(str(fd, 'needs_exclusions')), keywords: list(str(fd, 'needs_keywords')),
  });
}

// ---------------------------------------------------------------- Bước 1: đợt matching
export async function saveBrief(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const id = str(fd, 'id');
  const name = str(fd, 'name');
  if (!name) return 'Nhập tên đợt.';
  const brandRef = str(fd, 'brandId') ? await db.brand.findUnique({ where: { id: str(fd, 'brandId') } }) : null;
  const product = str(fd, 'productId') ? await db.product.findUnique({ where: { id: str(fd, 'productId') } }) : null;
  if (product && brandRef && product.brandId !== brandRef.id) return `SKU "${product.name}" không thuộc brand ${brandRef.name}.`;
  const airMonth = str(fd, 'airMonth');
  if (airMonth && !/^\d{4}-\d{2}$/.test(airMonth)) return 'Chọn tháng air.';
  const ints = { dealPrice: optInt(fd, 'dealPrice'), aov: optInt(fd, 'aov'), budget: optInt(fd, 'budget'), feeCap: optInt(fd, 'feeCap'), gmvTarget: optInt(fd, 'gmvTarget'), airWeek: optInt(fd, 'airWeek') };
  if (Object.values(ints).some(Number.isNaN)) return 'Giá, AOV, ngân sách, trần fee, mục tiêu GMV là số nguyên ≥ 0.';
  if (ints.airWeek != null && (ints.airWeek < 1 || ints.airWeek > 5)) return 'Tuần air từ 1 tới 5.';
  const crTarget = pctIn(fd, 'crTarget'), ctrTarget = pctIn(fd, 'ctrTarget');
  if (Number.isNaN(crTarget) || Number.isNaN(ctrTarget)) return 'CR, CTR mục tiêu là % từ 0 tới 100.';
  const slots: Slot[] = [];
  for (const kl of KL_LEVELS) {
    const n = optInt(fd, `slot|${kl}`);
    if (Number.isNaN(n)) return `Số KOC ${kl} phải là số nguyên.`;
    if (n) slots.push({ kl, role: str(fd, `role|${kl}`), count: n });
  }
  const channel = (CHANNELS as readonly string[]).includes(str(fd, 'channel')) ? str(fd, 'channel') : 'TikTok';
  const objective = (OBJECTIVES as readonly string[]).includes(str(fd, 'objective')) ? str(fd, 'objective') : 'Convert';
  const data = {
    name, brandId: brandRef?.id ?? null, brand: brandRef?.name ?? null, category: brandRef?.category ?? null, productId: product?.id ?? null,
    ...ints, objective, gmvMax: str(fd, 'gmvMax') === '1', channel, slots: slots as unknown as Prisma.InputJsonArray,
    airMonth: airMonth || null, format: str(fd, 'format') || null, includeHandles: handles(str(fd, 'includeHandles')), excludeHandles: handles(str(fd, 'excludeHandles')),
    crTarget, ctrTarget, expertClaim: str(fd, 'expertClaim') === '1', note: str(fd, 'note') || null,
    plan: str(fd, 'plan').slice(0, 30000) || null, needs: needsOf(fd) as Prisma.InputJsonObject,
  };
  const b = id ? await db.matchBrief.update({ where: { id }, data }) : await db.matchBrief.create({ data: { ...data, createdById: me.id } });
  await audit(me.id, 'MatchBrief', b.id, id ? 'Sửa đầu vào' : 'Tạo đợt matching');
  revalidatePath('/matching');
  redirect(back(b.id, 1));
}

export async function deleteBrief(fd: FormData) {
  const me = await requireUser();
  const b = await db.matchBrief.findUniqueOrThrow({ where: { id: str(fd, 'id') } });
  if (!can(me, 'brief.deleteAny') && b.createdById !== me.id) throw new Error('Chỉ người tạo hoặc người có quyền xoá đợt của người khác được xoá.');
  await db.matchBrief.delete({ where: { id: b.id } });
  await audit(me.id, 'MatchBrief', b.id, 'Xoá đợt matching', { name: b.name });
  revalidatePath('/matching');
  redirect('/matching');
}

// ---------------------------------------------------------------- Bước 2–3: chạy matching
export async function runNow(fd: FormData) {
  const me = await requireUser();
  const id = str(fd, 'id');
  let msg: string;
  try {
    msg = await runMatching(id);
  } catch (e) {
    msg = `Lỗi: ${e instanceof Error ? e.message : String(e)}`;
  }
  await audit(me.id, 'MatchBrief', id, 'Chạy matching', { msg });
  revalidatePath(`/matching/${id}`);
  redirect(back(id, msg.startsWith('Lỗi') ? 1 : 2, `&msg=${encodeURIComponent(msg)}`));
}

// ---------------------------------------------------------------- AI
/** Dán brief của brand → AI điền yêu cầu đợt. Đợt mới thì tạo luôn rồi mở form để Booker xem lại; đợt có sẵn thì chỉ điền ô trống. */
export async function aiFillBrief(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  if (!(await aiOn())) return 'Chưa gắn key Claude (Phân quyền → Tích hợp → API AI).';
  const text = str(fd, 'brief').slice(0, 30000);
  if (text.length < 30) return 'Dán nội dung brief (ít nhất vài câu).';
  const brands = await db.brand.findMany({ select: { id: true, name: true, category: true, products: { select: { id: true, name: true } } }, orderBy: { name: 'asc' } });
  let d;
  try {
    d = await readBrief(text, brands.map((b) => ({ name: b.name, products: b.products.map((p) => p.name) })));
  } catch (e) {
    return `AI chưa đọc được brief: ${e instanceof Error ? e.message : String(e)}`;
  }
  const norm = (x: string) => x.trim().toLowerCase();
  const brand = brands.find((b) => norm(b.name) === norm(d.brand)) ?? null;
  const product = brand?.products.find((p) => norm(p.name) === norm(d.product)) ?? null;
  const slots: Slot[] = d.slots.filter((x) => (KL_LEVELS as readonly string[]).includes(x.kl) && x.count > 0).map((x) => ({ kl: x.kl, role: x.role, count: x.count }));
  const needs = parseNeeds(d);
  const id = str(fd, 'id');
  const old = id ? await db.matchBrief.findUnique({ where: { id } }) : null;
  const pos = (n: number) => (n > 0 ? n : null);
  const fill = {
    brandId: old?.brandId ?? brand?.id ?? null, brand: old?.brand ?? brand?.name ?? null, category: old?.category ?? null, productId: old?.productId ?? product?.id ?? null,
    channel: old?.channel && old.channel !== 'TikTok' ? old.channel : (CHANNELS as readonly string[]).includes(d.channel) ? d.channel : 'TikTok',
    objective: (OBJECTIVES as readonly string[]).includes(d.objective) ? d.objective : 'Convert',
    airMonth: old?.airMonth ?? (/^\d{4}-\d{2}$/.test(d.airMonth) ? d.airMonth : null), airWeek: old?.airWeek ?? (d.airWeek >= 1 && d.airWeek <= 5 ? d.airWeek : null),
    budget: old?.budget ?? pos(d.budget), feeCap: old?.feeCap ?? pos(d.feeCap), gmvTarget: old?.gmvTarget ?? pos(d.gmvTarget), dealPrice: old?.dealPrice ?? pos(d.dealPrice),
    format: old?.format ?? (d.format || null), plan: text,
    needs: { ...parseNeeds(old?.needs), ...Object.fromEntries(Object.entries(needs).filter(([, v]) => (Array.isArray(v) ? v.length : v))) } as Prisma.InputJsonObject,
    ...(slots.length && !(Array.isArray(old?.slots) && old.slots.length) ? { slots: slots as unknown as Prisma.InputJsonArray } : {}),
  };
  if (brand?.category && !old?.category) fill.category = brand.category;
  const b = old
    ? await db.matchBrief.update({ where: { id: old.id }, data: fill })
    : await db.matchBrief.create({ data: { ...fill, name: d.name || 'Đợt mới', createdById: me.id } });
  await audit(me.id, 'MatchBrief', b.id, 'AI đọc brief');
  revalidatePath('/matching');
  const miss = [!b.brandId && 'brand', !b.productId && 'sản phẩm', !b.airMonth && 'tháng air'].filter(Boolean);
  redirect(back(b.id, 1, `&edit=1&msg=${encodeURIComponent(`AI đã điền yêu cầu từ brief. Kiểm tra lại rồi bấm Lưu${miss.length ? `; còn thiếu: ${miss.join(', ')}` : ''}.`)}`));
}

/** AI chấm "Hợp nội dung brand" (1–5, kèm lý do) cho top N KOC đang xét / đang liên hệ chưa được AI chấm. */
export async function aiScoreFit(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  if (!(await aiOn())) return 'Chưa gắn key Claude (Phân quyền → Tích hợp → API AI).';
  const briefId = str(fd, 'briefId');
  const top = Math.min(Math.max(optInt(fd, 'top') || 100, 1), 200);
  const b = await loadBrief(briefId);
  if (!b) return 'Không có đợt này.';
  const nd = parseNeeds(b.needs);
  const requirement = [
    `Brand: ${b.brandRef?.name ?? b.brand ?? '—'}${b.product ? ` · sản phẩm: ${b.product.name}` : ''}${b.brandRef?.category ? ` · ngành: ${b.brandRef.category}` : ''}`,
    nd.summary && `Yêu cầu: ${nd.summary}`, nd.usp && `Thông điệp: ${nd.usp}`, nd.tone && `Tone: ${nd.tone}`,
    (nd.targetGender || nd.ageMin || nd.ageMax) && `Khách mục tiêu: ${[nd.targetGender, nd.ageMin || nd.ageMax ? `${nd.ageMin ?? '?'}–${nd.ageMax ?? '?'} tuổi` : ''].filter(Boolean).join(', ')}`,
    nd.competitors?.length && `Đối thủ: ${nd.competitors.join(', ')}`, nd.exclusions?.length && `Không muốn: ${nd.exclusions.join('; ')}`,
    !nd.summary && b.plan && `Brief: ${b.plan.slice(0, 3000)}`,
  ].filter(Boolean).join('\n');
  const cands = await db.$queryRaw<{ id: string }[]>`
    select id from "MatchCandidate" where "briefId" = ${briefId} and stage in ('POOL', 'SHORTLIST', 'CONFIRMED')
      and coalesce(manual->'A3'->>'by', '') <> 'AI'
    order by total desc nulls last, (score->>'total')::float desc nulls last limit ${top}`;
  if (!cands.length) return 'Không còn KOC nào cần AI chấm (KOC đang xét đều đã được chấm).';
  const rows = await db.matchCandidate.findMany({ where: { id: { in: cands.map((c) => c.id) } } });
  const items: FitInput[] = rows.map((c) => {
    const d = (c.data ?? {}) as { name?: string; kwHits?: string[]; metrics?: { followers?: number | null; gmv?: number | null; female?: number | null; categories?: { name: string; share: number }[] | null; brands?: string[]; topVideos?: { title: string; products?: string | null }[] } | null };
    const m = d.metrics;
    return {
      handle: c.handle, name: d.name ?? c.handle, followers: m?.followers ?? null, gmv30: m?.gmv ? Math.round(m.gmv) : null,
      categories: (m?.categories ?? []).slice(0, 3).map((x) => `${x.name} ${Math.round(x.share * 100)}%`),
      videos: (m?.topVideos ?? []).slice(0, 5).map((v) => `${v.title.slice(0, 100)}${v.products ? ` [SP: ${v.products.slice(0, 80)}]` : ''}`),
      brands: (m?.brands ?? []).slice(0, 10), audience: m?.female != null ? `${Math.round(m.female * 100)}% nữ` : null, keywordHits: d.kwHits ?? [],
    };
  });
  let fits;
  try {
    fits = await rankFit(requirement, items);
  } catch (e) {
    return `AI chưa chấm được: ${e instanceof Error ? e.message : String(e)}`;
  }
  const byHandle = new Map(rows.map((c) => [c.handle, c.id]));
  const patches = new Map<string, Manual>();
  for (const f of fits) {
    const id = byHandle.get(f.handle);
    if (id) patches.set(id, { A3: { score: f.score, note: f.reason.slice(0, 300), by: 'AI' } });
  }
  const n = await rescoreMany(briefId, patches);
  await audit(me.id, 'MatchBrief', briefId, 'AI chấm độ hợp nội dung', { n });
  revalidatePath(`/matching/${briefId}`);
  redirect(back(briefId, 5, `&msg=${encodeURIComponent(`AI đã chấm độ hợp nội dung ${n} KOC. Điểm tổng đã tính lại.`)}`));
}

// ---------------------------------------------------------------- Thao tác trên ứng viên
async function candidate(fd: FormData) {
  const me = await requireUser();
  const c = await db.matchCandidate.findUniqueOrThrow({ where: { id: str(fd, 'cid') } });
  return { me, c, ret: back(c.briefId, str(fd, 'step') || 4, `&c=${c.id}${str(fd, 'page') ? `&page=${str(fd, 'page')}` : ''}`) };
}
const reject = (id: string, me: Me, code: string, reason: string) =>
  db.matchCandidate.update({ where: { id }, data: { stage: 'REJECTED', rejectCode: code, reason: reason.slice(0, 500), updatedById: me.id } });
/** Ngoại lệ (I-26): người có quyền duyệt list, hoặc người duyệt ngoại lệ ghi ở quy tắc brand. */
async function canException(me: Me, briefId: string) {
  if (can(me, 'match.approve')) return true;
  const b = await loadBrief(briefId);
  return parseRules(b?.brandRef?.rules).exceptionApprover === me.id;
}

/** Bước 4: Booker kiểm tra nội dung kênh theo K1, K2, K3, K4, K5, K8, K11. Một mã "Không đạt" là loại. */
export async function saveChecks(fd: FormData) {
  const { me, c, ret } = await candidate(fd);
  const b = (await loadBrief(c.briefId))!;
  const codes = contentChecksFor(b);
  const checks = { ...((c.checks ?? {}) as Record<string, Check>) };
  const all = str(fd, 'all') === '1';
  for (const k of codes) {
    const v = all ? 'ok' : str(fd, `check|${k}`);
    const note = str(fd, `note|${k}`).slice(0, 500);
    if (v === 'ok' || v === 'fail') checks[k] = { ok: v === 'ok', note: note || (all ? 'Xem kênh, không thấy vi phạm' : undefined), by: me.name ?? me.id, at: new Date().toISOString() };
    else if (v === 'clear') delete checks[k];
  }
  await db.matchCandidate.update({ where: { id: c.id }, data: { checks: checks as Prisma.InputJsonObject, updatedById: me.id } });
  const fail = codes.find((k) => checks[k]?.ok === false);
  if (fail && c.stage !== 'REJECTED') await reject(c.id, me, fail, checks[fail].note ?? KO[fail].label);
  revalidatePath(`/matching/${c.briefId}`);
  redirect(all ? back(c.briefId, str(fd, 'step') || 4, str(fd, 'page') ? `&page=${str(fd, 'page')}` : '') : ret);
}

/** KOC trong kho chưa có ở Danh bạ: tạo hồ sơ khi vào shortlist để liên hệ, listing, job dùng được. */
async function ensureKoc(c: { id: string; platform: string; handle: string; kocId: string | null; data: Prisma.JsonValue }) {
  if (c.kocId) return c.kocId;
  const w = await db.warehouseCreator.findUnique({ where: { platform_handle: { platform: c.platform, handle: c.handle } } });
  const d = (c.data ?? {}) as { name?: string };
  const k = await db.koc.upsert({
    where: { platform_handle: { platform: c.platform, handle: c.handle } },
    create: {
      platform: c.platform, handle: c.handle, name: w?.nickname ?? d.name ?? c.handle, nickname: w?.nickname, avatarUrl: w?.avatarUrl, followers: w?.followers,
      channelUrl: w?.url, rateCard: w?.castFee, note: 'Thêm từ kho dữ liệu khi vào shortlist Creator matching',
    },
    update: {},
  });
  await db.matchCandidate.update({ where: { id: c.id }, data: { kocId: k.id } });
  return k.id;
}

/** Bước 5: đưa ứng viên đã tick (hoặc top N theo điểm) vào shortlist để liên hệ. */
export async function shortlist(fd: FormData) {
  const me = await requireUser();
  const briefId = str(fd, 'briefId');
  const top = optInt(fd, 'top');
  const ids = fd.getAll('cid').map(String);
  const list = top
    ? await db.matchCandidate.findMany({ where: { briefId, stage: 'POOL' }, orderBy: [{ total: { sort: 'desc', nulls: 'last' } }], take: top })
    : await db.matchCandidate.findMany({ where: { briefId, stage: 'POOL', id: { in: ids } } });
  if (!list.length) redirect(back(briefId, 5, `&msg=${encodeURIComponent('Chưa tick KOC nào (chỉ chọn được KOC đang xét).')}`));
  for (const c of list) {
    await ensureKoc(c);
    await db.matchCandidate.update({ where: { id: c.id }, data: { stage: 'SHORTLIST', updatedById: me.id } });
  }
  await audit(me.id, 'MatchBrief', briefId, 'Shortlist', { n: list.length });
  revalidatePath(`/matching/${briefId}`);
  redirect(back(briefId, 6, `&msg=${encodeURIComponent(`Đã chọn ${list.length} KOC để liên hệ. Giờ hỏi giá từng KOC.`)}`));
}

export async function unshortlist(fd: FormData) {
  const { me, c, ret } = await candidate(fd);
  if (c.stage === 'SHORTLIST') await db.matchCandidate.update({ where: { id: c.id }, data: { stage: 'POOL', updatedById: me.id } });
  revalidatePath(`/matching/${c.briefId}`);
  redirect(ret);
}

/** Bước 6: KOC báo giá và xác nhận (rate card, ads code, cam kết không đăng đối thủ, chứng chỉ). confirm = chuyển Đã báo giá. */
export async function saveDeclare(fd: FormData) {
  const { me, c, ret } = await candidate(fd);
  const yesNo = (k: string) => (str(fd, k) === 'yes' ? true : str(fd, k) === 'no' ? false : undefined);
  const quote = optInt(fd, 'quote'), adsDays = optInt(fd, 'adsDays'), revisions = optInt(fd, 'revisions');
  if ([quote, adsDays, revisions].some(Number.isNaN)) redirect(`${ret}&err=${encodeURIComponent('Giá, số ngày ads code, số vòng sửa là số nguyên ≥ 0.')}`);
  const declare: Declare = {
    declared: true, quote: quote ?? undefined, priceType: str(fd, 'priceType') || 'Video', adsCode: yesNo('adsCode'), adsDays: adsDays ?? undefined,
    reup: fd.getAll('reup').map(String), noCompetitor: yesNo('noCompetitor'), certificate: str(fd, 'certificate') || undefined,
    revisions: revisions ?? undefined, sample: yesNo('sample'), note: str(fd, 'note') || undefined,
  };
  const { e } = await rescore(c.id, { declare });
  const ko = e?.declKo[0];
  if (ko) await reject(c.id, me, ko.code, ko.detail);
  else if (str(fd, 'confirm') === '1') {
    if (!declare.quote) redirect(`${ret}&err=${encodeURIComponent('Nhập giá KOC báo trước khi xác nhận.')}`);
    if (declare.noCompetitor === undefined) redirect(`${ret}&err=${encodeURIComponent('Ghi rõ KOC có cam kết không đăng sản phẩm đối thủ sau air không.')}`);
    await db.matchCandidate.update({ where: { id: c.id }, data: { stage: 'CONFIRMED', updatedById: me.id } });
  }
  await db.matchCandidate.update({ where: { id: c.id }, data: { updatedById: me.id } });
  revalidatePath(`/matching/${c.briefId}`);
  redirect(ret);
}

/** Bước 7: Booker chấm tay các tiêu chí kho chưa có số (nhóm D, phần lớn nhóm 0, tone...) hoặc đè điểm tự động. */
export async function saveManual(fd: FormData) {
  const { me, c, ret } = await candidate(fd);
  const manual: Manual = {};
  for (const cr of ALL_CRITERIA) {
    const v = Number(str(fd, `score|${cr.id}`));
    if (Number.isInteger(v) && v >= 1 && v <= 5) manual[cr.id] = { score: v, note: str(fd, `snote|${cr.id}`).slice(0, 300) || undefined, by: me.name ?? me.id };
  }
  const { e } = await rescore(c.id, { manual });
  if (e?.score.mustFail.length && ['POOL', 'SHORTLIST', 'CONFIRMED'].includes(c.stage)) await reject(c.id, me, 'G0', e.score.mustFail.join('; '));
  await db.matchCandidate.update({ where: { id: c.id }, data: { updatedById: me.id } });
  revalidatePath(`/matching/${c.briefId}`);
  redirect(ret);
}

/** Loại tay ở bất kỳ bước nào: bắt buộc mã (K hoặc nhóm điểm thấp) và lý do. */
export async function rejectCandidate(fd: FormData) {
  const { me, c, ret } = await candidate(fd);
  const code = str(fd, 'code') in KO ? str(fd, 'code') : 'OTHER';
  const reason = str(fd, 'reason');
  if (!reason) redirect(`${ret}&err=${encodeURIComponent('Ghi lý do loại.')}`);
  await reject(c.id, me, code, reason);
  await audit(me.id, 'MatchBrief', c.briefId, 'Loại KOC', { handle: c.handle, code, reason });
  revalidatePath(`/matching/${c.briefId}`);
  redirect(ret);
}

/** Khôi phục KOC đã loại về pool (lượt chấm lại quyết định Trong pool hay Bị loại tự động). */
export async function restoreCandidate(fd: FormData) {
  const { me, c, ret } = await candidate(fd);
  const checks = Object.fromEntries(Object.entries((c.checks ?? {}) as Record<string, Check>).filter(([, v]) => v.ok));
  const { e, ctx } = await rescore(c.id);
  const stage = e ? stageAfterRun({ stage: 'POOL', exception: c.exception }, e, e.ko.length > 0 || e.score.mustFail.length > 0, ctx.include.has(c.handle)) : 'POOL';
  await db.matchCandidate.update({ where: { id: c.id }, data: { stage, rejectCode: null, reason: null, checks, updatedById: me.id } });
  await audit(me.id, 'MatchBrief', c.briefId, 'Khôi phục KOC', { handle: c.handle });
  revalidatePath(`/matching/${c.briefId}`);
  redirect(ret);
}

/** Giữ lại KOC bị loại tự động (ngoại lệ, I-26). */
export async function keepException(fd: FormData) {
  const { me, c, ret } = await candidate(fd);
  if (!(await canException(me, c.briefId))) redirect(`${ret}&err=${encodeURIComponent('Chỉ trưởng nhóm hoặc người duyệt của brand được giữ lại KOC bị loại.')}`);
  const reason = str(fd, 'reason');
  if (!reason) redirect(`${ret}&err=${encodeURIComponent('Ghi lý do giữ ngoại lệ.')}`);
  await db.matchCandidate.update({ where: { id: c.id }, data: { stage: 'POOL', exception: `${reason} · ${me.name ?? me.id} ${new Date().toLocaleDateString('vi-VN')}`, updatedById: me.id } });
  await audit(me.id, 'MatchBrief', c.briefId, 'Giữ ngoại lệ', { handle: c.handle, reason });
  revalidatePath(`/matching/${c.briefId}`);
  redirect(ret);
}

// ---------------------------------------------------------------- Bước 8: B2C duyệt
export async function approve(fd: FormData) {
  const me = await requireUser();
  const briefId = str(fd, 'briefId');
  if (!can(me, 'match.approve')) redirect(back(briefId, 8, `&msg=${encodeURIComponent('Cần quyền "Duyệt list KOC" (Phân quyền).')}`));
  const ids = fd.getAll('cid').map(String);
  const action = str(fd, 'action');
  const reason = str(fd, 'reason');
  if (!ids.length) redirect(back(briefId, 8, `&msg=${encodeURIComponent('Tick chọn KOC trước.')}`));
  if (action === 'approve') {
    await db.matchCandidate.updateMany({ where: { briefId, id: { in: ids }, stage: 'CONFIRMED' }, data: { stage: 'APPROVED', approvedById: me.id, approvedAt: new Date(), updatedById: me.id } });
  } else if (action === 'return') {
    await db.matchCandidate.updateMany({ where: { briefId, id: { in: ids }, stage: { in: ['CONFIRMED', 'APPROVED'] } }, data: { stage: 'SHORTLIST', approvedById: null, approvedAt: null, reason: reason || null, updatedById: me.id } });
  } else if (action === 'reject') {
    if (!reason) redirect(back(briefId, 8, `&msg=${encodeURIComponent('Ghi lý do loại.')}`));
    await db.matchCandidate.updateMany({ where: { briefId, id: { in: ids } }, data: { stage: 'REJECTED', rejectCode: str(fd, 'code') in KO ? str(fd, 'code') : 'SCORE', reason, updatedById: me.id } });
  }
  await audit(me.id, 'MatchBrief', briefId, `B2C ${action}`, { n: ids.length, reason });
  revalidatePath(`/matching/${briefId}`);
  redirect(back(briefId, action === 'approve' ? 9 : 8));
}

// ---------------------------------------------------------------- Bước 9: xuất list → đợt listing để brand duyệt
export async function toListing(fd: FormData) {
  const me = await requireUser();
  const briefId = str(fd, 'briefId');
  const b = await db.matchBrief.findUniqueOrThrow({ where: { id: briefId }, include: { product: { include: { store: true } } } });
  const approved = await db.matchCandidate.findMany({ where: { briefId, stage: 'APPROVED' } });
  if (!approved.length) redirect(back(briefId, 9, `&msg=${encodeURIComponent('Chưa có KOC nào được B2C duyệt.')}`));
  let batchId = str(fd, 'batchId');
  if (!batchId || batchId === 'new') {
    const month = b.airMonth ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);
    batchId = (await db.listingBatch.create({
      data: {
        name: str(fd, 'name') || b.name, month, brand: b.brand, product: b.product?.name ?? null, store: b.product?.store?.name ?? null,
        cr: b.product?.store?.cr ?? null, aov: b.aov ?? b.product?.store?.aov ?? null, planLineId: b.planLineId, briefId, createdById: me.id,
      },
    })).id;
  } else await db.listingBatch.updateMany({ where: { id: batchId, briefId: null }, data: { briefId } });
  const air = b.airMonth ? airDateOf(b.airMonth, b.airWeek) : null;
  for (const c of approved) {
    const kocId = await ensureKoc(c);
    const d = (c.declare ?? {}) as Declare;
    const s = (c.score ?? {}) as { recommend?: string | null; strengths?: string[] };
    await db.listingItem.upsert({
      where: { batchId_kocId: { batchId, kocId } },
      create: {
        batchId, kocId, createdById: me.id, priceType: d.priceType ?? 'Video', price: d.quote ?? null, recommendation: s.recommend ?? null,
        contentNote: s.strengths?.length ? `Điểm mạnh: ${s.strengths.join(', ')}` : null, planAirDate: air, status: 'Đang liên hệ',
      },
      update: { price: d.quote ?? undefined, recommendation: s.recommend ?? undefined },
    });
  }
  await audit(me.id, 'MatchBrief', briefId, 'Xuất list sang Listing', { batchId, n: approved.length });
  revalidatePath(`/listing/${batchId}`);
  redirect(`/listing/${batchId}`);
}

// ---------------------------------------------------------------- Bước 10: đánh giá sau air
export async function saveOutcome(fd: FormData) {
  const { me, c, ret } = await candidate(fd);
  const yn = (k: string) => (str(fd, k) === 'yes' ? true : str(fd, k) === 'no' ? false : null);
  const err = str(fd, 'contentError');
  const decision = str(fd, 'decision');
  const outcome: Outcome = {
    kpiMet: yn('kpiMet'), onTime: yn('onTime'), firstPass: yn('firstPass'), keptPublic: yn('keptPublic'),
    contentError: err in CONTENT_ERRORS ? (err as Outcome['contentError']) : null, decision: decision in DECISIONS ? (decision as Outcome['decision']) : null,
    note: str(fd, 'note').slice(0, 1000) || undefined, by: me.name ?? me.id, at: new Date().toISOString(),
  };
  await db.matchCandidate.update({ where: { id: c.id }, data: { outcome: outcome as Prisma.InputJsonObject, updatedById: me.id } });
  const kocId = c.kocId;
  const brief = await db.matchBrief.findUniqueOrThrow({ where: { id: c.briefId }, select: { brand: true, name: true } });
  // Rating Booker (I-53, nhóm E): một lượt cho mỗi KOC mỗi đợt.
  const stars = Number(str(fd, 'stars'));
  if (kocId && Number.isInteger(stars) && stars >= 1 && stars <= 5) {
    const tags = fd.getAll('tags').map(String).filter((t) => RATING_TAGS.some((x) => x.code === t));
    const data = { kocId, brand: brief.brand, stars, tags, note: outcome.note ?? null, evaluatorId: me.id, evaluatedAt: new Date() };
    await db.kocRating.upsert({ where: { dealId: `MC-${c.id}` }, create: { dealId: `MC-${c.id}`, ...data }, update: data });
  }
  if (kocId && outcome.decision === 'core') {
    const k = await db.koc.findUniqueOrThrow({ where: { id: kocId }, select: { tags: true } });
    if (!k.tags.includes('KOC core')) await db.koc.update({ where: { id: kocId }, data: { tags: [...k.tags, 'KOC core'] } });
  }
  if (kocId && outcome.decision === 'stop' && brief.brand) {
    await db.kocReview.create({
      data: { kocId, verdict: 'NOT_SUITABLE', brand: brief.brand, reasons: ['Khác (Ghi rõ ở phần ý kiến)'], note: `Đánh giá sau air (${brief.name}): dừng hợp tác. ${outcome.note ?? ''}`.trim(), source: 'Creator matching', reviewerId: me.id },
    });
  }
  await audit(me.id, 'MatchBrief', c.briefId, 'Đánh giá sau air', { handle: c.handle, decision: outcome.decision });
  revalidatePath(`/matching/${c.briefId}`);
  redirect(ret);
}
