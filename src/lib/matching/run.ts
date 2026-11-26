// Chạy Creator matching cho một đợt (bước 2–3, chấm sơ bộ bước 5) và chấm lại một ứng viên sau mỗi thao tác của Booker.
// Lượt chạy giữ nguyên mọi thứ Booker đã nhập (kiểm tra nội dung, khai báo, điểm tay, ngoại lệ) và giai đoạn từ Shortlist trở đi.
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { buildContext, loadBrief, loadSubjects, type BriefFull } from './data';
import { evaluate, type Evaluation, type Finding, type Subject } from './engine';
import { CONTENT_CHECKS, MIN_COVERAGE, parseNeeds, type Check, type Declare, type Manual, type Stage } from './spec';

/** Số liệu lưu kèm ứng viên để hiện mà không phải nạp lại. KOC bị loại tự động không giữ video nổi bật cho gọn. */
function snapshot(s: Subject, e: Evaluation, keepVideos: boolean) {
  const m = s.metrics;
  return {
    name: s.name, avatarUrl: s.avatarUrl, niche: s.niche, kl: e.kl, klSource: e.klSource, price: e.price, priceSource: e.priceSource,
    metrics: m && { ...m, categories: m.categories?.slice(0, 5) ?? null, locations: m.locations?.slice(0, 5) ?? null, brands: m.brands.slice(0, 10), topVideos: keepVideos ? m.topVideos : [] },
    bookings: s.history.bookings.length, ratings: s.history.ratings.length, kwHits: s.kwHits?.length ? s.kwHits : undefined,
  };
}

/** Mã loại tự động (bước 3) + nhóm 0 Bắt buộc không đạt. */
const autoKo = (e: Evaluation): Finding[] => [...e.ko, ...(e.score.mustFail.length ? [{ code: 'G0', detail: e.score.mustFail.join('; ') }] : [])];
/** Cột total dùng để xếp hạng: null khi độ phủ số liệu thấp hoặc trượt tiêu chí bắt buộc (xếp cuối). */
const rankTotal = (e: Evaluation) => (e.score.mustFail.length || e.score.coverage < MIN_COVERAGE ? null : e.score.total);

export async function runMatching(briefId: string): Promise<string> {
  const brief = await loadBrief(briefId);
  if (!brief) throw new Error('Không có đợt này');
  const ctx = await buildContext(brief);
  const [subjects, existing] = await Promise.all([
    loadSubjects(ctx),
    db.matchCandidate.findMany({ where: { briefId }, select: { id: true, platform: true, handle: true, stage: true, kocId: true, checks: true, declare: true, manual: true, exception: true } }),
  ]);
  const ex = new Map(existing.map((c) => [`${c.platform}|${c.handle}`, c]));
  const seen = new Set<string>();
  const create: Prisma.MatchCandidateCreateManyInput[] = [];
  const update: Record<string, unknown>[] = [];
  let ko = 0, pool = 0, out = 0, fromWarehouse = 0;
  for (const s of subjects) {
    const key = `${s.platform}|${s.handle}`;
    const c = ex.get(key);
    const e = evaluate(s, ctx, (c?.declare ?? {}) as Declare, (c?.manual ?? {}) as Manual);
    seen.add(key);
    if (!s.kocId) fromWarehouse++;
    const kos = autoKo(e);
    const flags = e.outOfPool ? [{ code: 'POOL', detail: e.outOfPool }, ...e.flags] : e.flags;
    const stage = stageAfterRun(c, e, kos.length > 0, ctx.include.has(s.handle));
    if (stage === 'KO') ko++; else if (stage === 'POOL') pool++; else if (stage === 'OUT') out++;
    const row = {
      stage, kl: e.kl, data: snapshot(s, e, stage !== 'KO' && stage !== 'OUT') as Prisma.InputJsonObject, knockouts: kos as unknown as Prisma.InputJsonArray,
      flags: flags as unknown as Prisma.InputJsonArray, score: e.score as unknown as Prisma.InputJsonObject, total: rankTotal(e), tier: e.score.tier,
    };
    if (c) update.push({ id: c.id, kocId: s.kocId, ...row });
    else create.push({ briefId, platform: s.platform, handle: s.handle, kocId: s.kocId, ...row });
  }
  // Ứng viên cũ không còn trong dữ liệu lần này (creator rời kho / rời top theo GMV): không xoá, chuyển Ngoài pool nếu chưa qua bước 5.
  const stale = existing.filter((c) => !seen.has(`${c.platform}|${c.handle}`) && ['KO', 'POOL', 'OUT'].includes(c.stage)).map((c) => c.id);
  for (let i = 0; i < create.length; i += 1000) await db.matchCandidate.createMany({ data: create.slice(i, i + 1000), skipDuplicates: true });
  for (let i = 0; i < update.length; i += 500) await bulkUpdate(update.slice(i, i + 500));
  if (stale.length) {
    await db.matchCandidate.updateMany({ where: { id: { in: stale } }, data: { stage: 'OUT', flags: [{ code: 'POOL', detail: 'Không còn trong dữ liệu lần chạy này (rời kho hoặc ngoài top GMV của kho)' }] } });
    out += stale.length;
  }
  if (!brief.ranAt) await migrateDecisions(briefId);
  const fmt = (x: number) => x.toLocaleString('vi-VN');
  const note = `Tìm được ${fmt(pool + ko + out)} KOC (${fmt(fromWarehouse)} ngoài Danh bạ): ${fmt(pool)} đang xét, ${fmt(ko)} hệ thống loại, ${fmt(out)} không khớp ngành / cấp KOC`;
  await db.matchBrief.update({ where: { id: briefId }, data: { ranAt: new Date(), runNote: note } });
  return note;
}

/**
 * Trạng thái sau lượt chạy: ứng viên đã qua bước 5 (shortlist trở đi) hoặc bị loại tay giữ nguyên;
 * còn lại: ngoài bộ lọc pool → OUT, trượt mã loại (không ngoại lệ, không được brand chỉ định) → KO, không thì POOL.
 */
export function stageAfterRun(c: { stage: string; exception: string | null } | undefined, e: Pick<Evaluation, 'outOfPool'>, hasKo: boolean, included: boolean): Stage {
  if (c && !['KO', 'POOL', 'OUT'].includes(c.stage)) return c.stage as Stage;
  if (c?.exception || included) return 'POOL';
  if (e.outOfPool) return 'OUT';
  return hasKo ? 'KO' : 'POOL';
}

async function bulkUpdate(rows: Record<string, unknown>[]) {
  await db.$executeRaw`
    update "MatchCandidate" c set stage = x.stage, kl = x.kl, data = x.data, knockouts = x.knockouts, flags = x.flags, score = x.score,
      total = x.total, tier = x.tier, "kocId" = coalesce(x."kocId", c."kocId"), "updatedAt" = now()
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(id text, stage text, kl text, data jsonb, knockouts jsonb, flags jsonb, score jsonb, total float8, tier text, "kocId" text)
    where c.id = x.id`;
}

/** Quyết định chọn / loại của bản matching cũ (MatchDecision) chuyển thành Shortlist / Đã loại ở lượt chạy đầu. */
async function migrateDecisions(briefId: string) {
  const decisions = await db.matchDecision.findMany({ where: { briefId } });
  if (!decisions.length) return;
  const kocs = await db.koc.findMany({ where: { id: { in: decisions.map((d) => d.kocId) } }, select: { id: true, handle: true, platform: true } });
  for (const d of decisions) {
    const k = kocs.find((x) => x.id === d.kocId);
    if (!k) continue;
    const data = d.decision === 'pick' ? { stage: 'SHORTLIST' } : { stage: 'REJECTED', rejectCode: 'OTHER', reason: d.reason };
    await db.matchCandidate.updateMany({ where: { briefId, platform: k.platform, handle: k.handle }, data: { ...data, kocId: k.id, updatedById: d.byId } });
  }
}

/** Chấm lại một ứng viên với khai báo / điểm tay mới. Trả đánh giá để action quyết định chuyển giai đoạn. */
export async function rescore(candidateId: string, patch: { declare?: Declare; manual?: Manual } = {}) {
  const c = await db.matchCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  const brief = (await loadBrief(c.briefId)) as BriefFull;
  const ctx = await buildContext(brief);
  const [s] = (await loadSubjects(ctx, [c.handle])).filter((x) => x.platform === c.platform);
  const declare = patch.declare ?? ((c.declare ?? {}) as Declare);
  const manual = patch.manual ?? ((c.manual ?? {}) as Manual);
  if (!s) return { c, e: null, ctx };
  const e = evaluate(s, ctx, declare, manual);
  await db.matchCandidate.update({
    where: { id: c.id },
    data: {
      declare: declare as Prisma.InputJsonObject, manual: manual as Prisma.InputJsonObject, kl: e.kl, kocId: c.kocId ?? s.kocId,
      data: snapshot(s, e, c.stage !== 'KO' && c.stage !== 'OUT') as Prisma.InputJsonObject, knockouts: autoKo(e) as unknown as Prisma.InputJsonArray,
      flags: e.flags as unknown as Prisma.InputJsonArray, score: e.score as unknown as Prisma.InputJsonObject, total: rankTotal(e), tier: e.score.tier,
    },
  });
  return { c, e, ctx };
}

/**
 * Ghi điểm tay của nhiều ứng viên một lượt (AI chấm "Hợp nội dung brand") rồi chấm lại: nạp đợt, ngữ cảnh và số liệu một lần.
 * Không đổi trạng thái; KOC trượt tiêu chí bắt buộc vẫn do Booker loại tay như chấm tay thường.
 */
export async function rescoreMany(briefId: string, patches: Map<string, Manual>) {
  const brief = (await loadBrief(briefId)) as BriefFull;
  const ctx = await buildContext(brief);
  const cands = await db.matchCandidate.findMany({ where: { briefId, id: { in: [...patches.keys()] } } });
  const subjects = await loadSubjects(ctx, [...new Set(cands.map((c) => c.handle))]);
  let n = 0;
  for (const c of cands) {
    const s = subjects.find((x) => x.platform === c.platform && x.handle === c.handle);
    if (!s) continue;
    const manual = { ...((c.manual ?? {}) as Manual), ...patches.get(c.id) };
    const e = evaluate(s, ctx, (c.declare ?? {}) as Declare, manual);
    await db.matchCandidate.update({
      where: { id: c.id },
      data: {
        manual: manual as Prisma.InputJsonObject, kl: e.kl, data: snapshot(s, e, c.stage !== 'KO' && c.stage !== 'OUT') as Prisma.InputJsonObject,
        knockouts: autoKo(e) as unknown as Prisma.InputJsonArray, flags: e.flags as unknown as Prisma.InputJsonArray,
        score: e.score as unknown as Prisma.InputJsonObject, total: rankTotal(e), tier: e.score.tier,
      },
    });
    n++;
  }
  return n;
}

/** Mã kiểm tra nội dung áp cho đợt: K3 khi brand bật, K11 khi SKU có trường hợp loại. */
export const contentChecksFor = (b: BriefFull) =>
  CONTENT_CHECKS.filter((k) => (k !== 'K3' || (b.brandRef?.rules as { k3?: boolean } | null)?.k3 === true)
    && (k !== 'K11' || (b.product?.exclusions.length ?? 0) > 0 || (parseNeeds(b.needs).exclusions?.length ?? 0) > 0));
export const checksDone = (checks: Record<string, Check>, codes: readonly string[]) => codes.filter((k) => checks[k]).length;
