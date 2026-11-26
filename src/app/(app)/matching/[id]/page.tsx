import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Prisma, type MatchCandidate } from '@prisma/client';
import { Dialog } from '@/components/ui';
import { Pager, pageOf } from '@/components/Pager';
import { db } from '@/lib/db';
import { fmtDate, fmtNum, fmtShort, fmtVnd, fmtVndShort } from '@/lib/format';
import { FEE_DIVISOR } from '@/lib/koc/kocInsights';
import { loadBenchmarks } from '@/lib/matching/data';
import type { Finding, ScoreResult } from '@/lib/matching/engine';
import { checksDone, contentChecksFor } from '@/lib/matching/run';
import {
  CONTENT_CHECKS, DECISIONS, GROUP0, KL_LEVELS, KL_METRICS, KO, koLabel, parseRules, parseSlots, SCANDAL_LABEL, STAGE_ORDER, STAGES, STEP_PICKED, STEPS,
  type Check, type Declare, type Outcome, type Stage,
} from '@/lib/matching/spec';
import { warehouseStatus } from '@/lib/warehouse/creatorSync';
import { can, requireUser } from '@/lib/auth/session';
import { approve, deleteBrief, keepException, restoreCandidate, runNow, saveChecks, shortlist, toListing, unshortlist } from '../actions';
import { BriefForm } from '../BriefForm';
import { currentStep, Findings, GROUP_HEADS, GroupCells, KocCell, metricCells, StageChip, Stepper, TierChip, Total, type CandData } from '../parts';
import { CandidateDialog } from './CandidateDialog';

type Search = { step?: string; c?: string; page?: string; q?: string; src?: string; code?: string; stage?: string; msg?: string; err?: string; edit?: string };
const PER = 50;
/** Mọi bước dùng chung một thứ tự: trạng thái đi xa nhất lên đầu (STAGE_ORDER), cùng trạng thái thì điểm cao trước. */
const RANK = Prisma.raw(`case stage ${STAGE_ORDER.map((st, i) => `when '${st}' then ${i}`).join(' ')} else 99 end`);
const sd = (c: MatchCandidate) => ({ d: (c.data ?? {}) as CandData, s: (c.score ?? null) as ScoreResult | null, ko: (c.knockouts ?? []) as Finding[], flags: (c.flags ?? []) as Finding[] });

export default async function BriefPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const b = await db.matchBrief.findUnique({
    where: { id },
    include: { brandRef: true, product: { include: { store: true } }, createdBy: { select: { name: true } }, planLine: { include: { plan: { select: { id: true, name: true } } } } },
  });
  if (!b || b.template) notFound();
  const grouped = await db.matchCandidate.groupBy({ by: ['stage'], where: { briefId: id }, _count: true });
  const n = Object.fromEntries(grouped.map((g) => [g.stage, g._count])) as Partial<Record<Stage, number>>;
  const step = Math.min(10, Math.max(1, Number(sp.step) || currentStep(b, n)));
  // Số trên từng bước = số KOC qua bước đó (được chọn); danh sách của bước vẫn hiện đủ mọi KOC.
  const stepCounts: Record<number, number | undefined> = b.ranAt
    ? Object.fromEntries(Object.entries(STEP_PICKED).map(([k, st]) => [k, st.reduce((x, y) => x + (n[y] ?? 0), 0)]))
    : {};
  const page = pageOf(sp.page);
  const filters = Object.entries({ q: sp.q, src: sp.src, code: sp.code, stage: sp.stage }).filter(([, v]) => v) as [string, string][];
  const base = `/matching/${id}?${new URLSearchParams([['step', String(step)], ...(sp.page ? [['page', sp.page]] : []), ...filters])}`;
  const open = (cid: string) => `${base}&c=${cid}`;
  const listParams = new URLSearchParams([['step', String(step)], ...filters]);
  const brands = sp.edit ? await db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, products: { select: { id: true, name: true, sku: true }, orderBy: { name: 'asc' } } } }) : [];
  const ctx = { b, me, n, step, page, base, open, listParams, sp };

  return (
    <>
      <Link href="/matching" className="text-xs text-ink-3 hover:text-ink">← Creator matching</Link>
      <div className="mt-2 mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{b.name}</h1>
          <p className="mt-0.5 text-xs text-ink-3">
            {[b.brand, b.product?.name, `${b.channel} · ${b.objective}${b.gmvMax ? ' · GMV Max' : ''}`, b.airMonth && `air ${b.airMonth.split('-').reverse().join('/')}${b.airWeek ? ` tuần ${b.airWeek}` : ''}`, `tạo bởi ${b.createdBy.name ?? '—'}`].filter(Boolean).join(' · ')}
            {b.planLine && <> · từ plan <Link href={`/plan/${b.planLine.plan.id}`} className="link">{b.planLine.plan.name}</Link></>}
          </p>
          {b.runNote && <p className="mt-0.5 text-xs text-ink-3">Lần chạy {fmtDate(b.ranAt)}: {b.runNote}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/matching/${id}?step=${step}&edit=1`} className="btn">Sửa đầu vào</Link>
          <form action={runNow}><input type="hidden" name="id" value={id} /><button className="btn btn-primary" title="Bước 2–3: tạo pool, loại bằng dữ liệu, chấm sơ bộ. Giữ nguyên mọi thao tác đã làm.">{b.ranAt ? 'Chạy lại matching' : 'Chạy matching'}</button></form>
        </div>
      </div>
      <Stepper briefId={id} step={step} counts={stepCounts} />
      {(sp.msg || sp.err) && <p role="status" className={`mb-3 rounded-md px-3 py-2 text-[13px] ${sp.err || sp.msg?.startsWith('Lỗi') ? 'bg-critical-soft text-critical' : 'bg-positive-soft text-positive'}`}>{sp.err ?? sp.msg}</p>}
      <p className="mb-3 text-[13px] text-ink-2"><b>Bước {step}. {STEPS[step - 1].title}</b> · {STEPS[step - 1].hint}</p>

      {step === 1 && <Inputs {...ctx} />}
      {step === 2 && <Pool {...ctx} />}
      {step === 3 && <DataKo {...ctx} />}
      {step === 4 && <ContentKo {...ctx} />}
      {step === 5 && <Shortlist {...ctx} />}
      {step === 6 && <Quotes {...ctx} />}
      {step === 7 && <FullScore {...ctx} />}
      {step === 8 && <Approve {...ctx} />}
      {step === 9 && <Export {...ctx} />}
      {step === 10 && <AfterAir {...ctx} />}

      {sp.c && <CandidateDialog cid={sp.c} brief={b} me={me} step={step} page={sp.page} close={base} err={sp.err} />}
      {sp.edit && (
        <Dialog title="Sửa đầu vào của đợt (Khối 4)" closeHref={`/matching/${id}?step=${step}`} wide>
          <BriefForm brief={b} brands={brands} cancel={`/matching/${id}?step=${step}`} />
          {(can(me, 'brief.deleteAny') || b.createdById === me.id) && (
            <form action={deleteBrief} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="id" value={b.id} />
              <button className="btn btn-danger">Xoá đợt này</button>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}

type Brief = NonNullable<Awaited<ReturnType<typeof db.matchBrief.findUnique<{ where: { id: string }; include: { brandRef: true; product: { include: { store: true } }; createdBy: { select: { name: true } }; planLine: { include: { plan: { select: { id: true; name: true } } } } } }>>>>;
type Ctx = { b: Brief; me: Awaited<ReturnType<typeof requireUser>>; n: Partial<Record<Stage, number>>; step: number; page: number; base: string; open: (cid: string) => string; listParams: URLSearchParams; sp: Search };

const Panel = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <section className="mb-4 rounded-lg border border-line bg-surface px-5 py-4">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">{title}</h2>{action}</div>
    {children}
  </section>
);
const Row = ({ k, v, need }: { k: string; v: React.ReactNode; need?: boolean }) => (
  <div className="flex gap-3 border-b border-line py-1.5 text-[13px] last:border-0">
    <dt className="w-64 shrink-0 text-ink-3">{k}{need && <span className="ml-1 text-[10px] font-semibold text-critical">BẮT BUỘC</span>}</dt>
    <dd className="min-w-0 flex-1 whitespace-pre-line">{v || v === 0 ? v : <span className={need ? 'text-critical' : 'text-warning'}>Chưa có</span>}</dd>
  </div>
);
const NotRun = ({ b }: { b: Brief }) => (b.ranAt ? null : <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-10 text-center text-ink-3">Chưa chạy matching. Kiểm tra đầu vào ở bước 1 rồi bấm "Chạy matching".</p>);

// ---------------------------------------------------------------- Bước 1
async function Inputs({ b }: Ctx) {
  const brand = b.brandRef;
  const p = b.product;
  const rules = parseRules(brand?.rules);
  const slots = parseSlots(b.slots);
  const [users, wh, bench] = await Promise.all([db.user.findMany({ select: { id: true, name: true } }), warehouseStatus(), loadBenchmarks()]);
  const name = (uid: string | null | undefined) => (uid ? users.find((u) => u.id === uid)?.name ?? '—' : null);
  const brandLink = brand ? `/catalog/${brand.id}` : '/catalog';
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Khối 1. Brand Profile" action={<Link href={brand ? `${brandLink}?edit=1` : '/catalog'} className="btn h-8 px-3 text-xs">Sửa ở Danh mục</Link>}>
        <dl>
          <Row k="I-01 Brand / Store" need v={brand ? `${brand.name}${p?.store ? ` · ${p.store.name}` : ''}` : null} />
          <Row k="I-02 Ngành hàng · ngành con" need v={[brand?.category, brand?.subCategory].filter(Boolean).join(' › ')} />
          <Row k="I-03 Nhóm brand / tập đoàn" need v={brand?.group} />
          <Row k="I-04 TA chính" need v={brand?.audience} />
          <Row k="I-05 Mood & tone" need v={brand?.tone} />
          <Row k="I-06 P-USP" need v={p?.usp ?? brand?.usp} />
          <Row k="I-07 RTB, claim được phép / bị cấm" need v={[brand?.rtb, brand?.bannedClaims.length && `Cấm: ${brand.bannedClaims.join(', ')}`].filter(Boolean).join('\n')} />
          <Row k="I-08 Đối thủ cùng công dụng" need v={brand?.competitors.join(', ')} />
          <Row k="I-09 Khoảng giá đối thủ" v={`±${rules.priceBand}%`} />
        </dl>
      </Panel>
      <Panel title="Khối 2. SKU Config" action={brand && p ? <Link href={`${brandLink}?product=${p.id}`} className="btn h-8 px-3 text-xs">Sửa SKU</Link> : undefined}>
        {!p ? <p className="text-[13px] text-critical">Đợt chưa chọn SKU (I-28). Sửa đầu vào để chọn; K10, K11, nhóm A cần cấu hình SKU.</p> : (
          <dl>
            <Row k="I-10 Mã SP, dòng SP, gian hàng" need v={[p.sku, p.line, p.store?.name].filter(Boolean).join(' · ')} />
            <Row k="I-11 Giá niêm yết" need v={p.price ? fmtVnd(p.price) : null} />
            <Row k="I-12 Độ tuổi / giới tính mục tiêu" need v={[p.targetGender, (p.ageMin != null || p.ageMax != null) && `${p.ageMin ?? '?'}–${p.ageMax ?? '?'} tuổi`].filter(Boolean).join(' · ')} />
            <Row k="I-13 Chân dung, visual bắt buộc" v={p.kocVisual} />
            <Row k="I-14 Trường hợp loại (K11)" v={p.exclusions.join('\n')} />
            <Row k="I-15 Tệp kênh ưu tiên" v={p.channelTypes.join(', ')} />
            <Row k="I-16 Từ cấm riêng (K4)" v={p.bannedWords.join(', ')} />
            <Row k="I-17 Ngưỡng tệp follower (K10)" v={[p.femaleMin != null && `nữ ≥ ${p.femaleMin}%`, p.age18_34Min != null && `18–34 ≥ ${p.age18_34Min}%`, p.regionMin != null && `${p.regions.join(', ')} ≥ ${p.regionMin}%`].filter(Boolean).join(' · ')} />
            <Row k="I-18 PIC duyệt" need v={name(p.reviewerId)} />
          </dl>
        )}
      </Panel>
      <Panel title="Khối 3. Ngưỡng và quy tắc lọc KOC" action={brand ? <Link href={`${brandLink}?rules=1`} className="btn h-8 px-3 text-xs">Sửa quy tắc</Link> : undefined}>
        <dl>
          <Row k="I-19 Ngưỡng theo KL" need v={KL_LEVELS.filter((lv) => rules.kl[lv]).map((lv) => `${lv}: ${KL_METRICS.filter(([k]) => rules.kl[lv]![k] != null).map(([k, l]) => `${l.toLowerCase()} ${fmtNum(rules.kl[lv]![k] as number)}${(rules.kl[lv]!.must ?? ['followersMin', 'viewsMin']).includes(k) ? '' : ' (nice)'}`).join(', ')}`).join('\n')} />
          <Row k="I-21 Ngưỡng ngành" v={`GMV ngành ≥ ${rules.industryGmvMin}% (nội dung ngành ≥ ${rules.industryContentMin}%: kho chưa có)`} />
          <Row k="I-22 Cửa sổ chống trùng" v={`${rules.cooldownDays} ngày`} />
          <Row k="I-23 Cửa sổ scandal" v={SCANDAL_LABEL[rules.scandal]} />
          <Row k="I-24 Uy tín brand đã hợp tác (K3)" v={rules.k3 ? 'Bật' : 'Tắt'} />
          <Row k="I-25 Ads code, reup mặc định" v={`${rules.adsCodeDays} ngày${rules.reupChannels.length ? ` · ${rules.reupChannels.join(', ')}` : ''}`} />
          <Row k="I-26 Duyệt ngoại lệ, giữ chỗ" v={`${name(rules.exceptionApprover) ?? 'Người có quyền duyệt list'} · ${rules.holdDays} ngày`} />
          <Row k="I-27 Nhóm 0" v={rules.group0.length ? rules.group0.map((g) => `${GROUP0.find((c) => c.id === g.id)?.label} (${g.mode === 'must' ? 'Bắt buộc' : 'Cộng điểm'})`).join('\n') : 'Chưa chọn: lấy điểm trung bình nhóm A'} />
          <Row k="I-56 Cửa sổ chống đối thủ" v={`${rules.competitorDays} ngày trước air`} />
        </dl>
      </Panel>
      <Panel title="Khối 4. Kế hoạch và brief đợt" action={<Link href={`/matching/${b.id}?step=1&edit=1`} className="btn h-8 px-3 text-xs">Sửa</Link>}>
        <dl>
          <Row k="I-28 SKU cần book" need v={p?.name} />
          <Row k="I-29 Giá deal · AOV" need v={[b.dealPrice && `Giá deal ${fmtVnd(b.dealPrice)}`, b.aov && `AOV ${fmtVnd(b.aov)}`].filter(Boolean).join(' · ')} />
          <Row k="I-30 Mục tiêu campaign" need v={`${b.objective}${b.gmvMax ? ' · chạy GMV Max (K14)' : ''}`} />
          <Row k="I-31 Kênh" need v={b.channel} />
          <Row k="I-32 Số KOC theo KL, vai trò" need v={slots.map((s) => `${s.count} ${s.kl}${s.role ? ` (${s.role})` : ''}`).join(', ')} />
          <Row k="I-33 Ngân sách · trần fee / KOC" need v={[b.budget && `Ngân sách ${fmtVndShort(b.budget)}`, b.feeCap && `trần ${fmtVndShort(b.feeCap)} / KOC`].filter(Boolean).join(' · ')} />
          <Row k="I-34 Tháng / tuần air" need v={b.airMonth && `${b.airMonth.split('-').reverse().join('/')}${b.airWeek ? `, tuần ${b.airWeek}` : ''}`} />
          <Row k="I-35 Format, thời lượng" v={b.format} />
          <Row k="I-36 KOC chỉ định / cấm" v={[b.includeHandles.length && `Chỉ định: ${b.includeHandles.map((h) => `@${h}`).join(', ')}`, b.excludeHandles.length && `Cấm: ${b.excludeHandles.map((h) => `@${h}`).join(', ')}`].filter(Boolean).join('\n')} />
          <Row k="I-37 Mục tiêu GMV, CR, CTR" v={[b.gmvTarget && `GMV ${fmtVndShort(b.gmvTarget)}`, b.crTarget != null && `CR ${(b.crTarget * 100).toFixed(1)}%`, b.ctrTarget != null && `CTR ${(b.ctrTarget * 100).toFixed(1)}%`].filter(Boolean).join(' · ')} />
          <Row k="Claim chuyên môn (K12)" v={b.expertClaim ? 'Có' : 'Không'} />
          {[b.guideline, b.strategy, b.plan, b.note].some(Boolean) && <Row k="Ghi chú" v={[b.guideline, b.strategy, b.plan, b.note].filter(Boolean).join('\n')} />}
        </dl>
      </Panel>
      <Panel title="Khối 5. KOC khai báo">
        <p className="text-[13px] text-ink-2">Ghi ở bước 6 sau khi Booking liên hệ: giá báo (I-52), đồng ý ads code và số ngày (I-39), cam kết không đăng đối thủ sau air (I-40), chứng chỉ hành nghề khi có claim chuyên môn (I-41).</p>
      </Panel>
      <Panel title="Khối 6. Dữ liệu KOC (hệ thống tự lấy)">
        <dl>
          <Row k="I-42 – I-48 Số liệu kênh" v={wh ? `Kho dữ liệu: ${fmtNum(wh.count)} creator${wh.at ? `, đồng bộ ${fmtDate(wh.at)}` : ''}. KOC Danh bạ không có trong kho dùng số TikTok Shop đã lưu.` : 'Chưa nối kho dữ liệu: dùng số TikTok Shop đã lưu ở Danh bạ (chỉ KOC trong Danh bạ).'} />
          <Row k="I-49, I-50 Tin tiêu cực, nội dung video" v="Kho chưa có: Booker kiểm tra ở bước 4 (K1, K2, K4, K5, K8, K11)." />
          <Row k="I-51 Lịch sử hợp tác" v="Booking đồng bộ từ Lark + job trong app." />
          <Row k="I-38 Benchmark theo KL" v={Object.entries(bench).filter(([, x]) => x.n).map(([kl, x]) => `${kl === '*' ? 'Chung' : kl}: GMV/video ${fmtVndShort(x.gmvPerVideo)}, view ${fmtShort(x.views)}, CPV ${x.cpv ? fmtVnd(x.cpv) : '—'} (${x.n} booking)`).join('\n') || 'Chưa có booking đã air có số view / GMV 30 ngày'} />
          <Row k="I-53 Rating Booker" v="Chấm sao ở bước 10 (và các lượt chấm có sẵn ở Danh bạ)." />
          <Row k="I-54 Kết quả sau air" v="Bước 10: GMV/video, CPV, ROI từ booking Lark và job." />
        </dl>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------- Danh sách chung của bước 2–10
/** Một trang danh sách đầy đủ của đợt (không bỏ KOC nào), xếp theo trạng thái rồi điểm; lọc theo ID kênh, nguồn, trạng thái, mã loại. */
async function listPage(b: Brief, sp: Search, page: number) {
  const conds: Prisma.Sql[] = [Prisma.sql`"briefId" = ${b.id}`];
  const q = sp.q?.trim().replace(/^@/, '').toLowerCase();
  if (q) conds.push(Prisma.sql`handle like ${`%${q}%`}`);
  if (sp.src === 'kho') conds.push(Prisma.sql`"kocId" is null`);
  else if (sp.src === 'danhba') conds.push(Prisma.sql`"kocId" is not null`);
  if (sp.stage && sp.stage in STAGES) conds.push(Prisma.sql`stage = ${sp.stage}`);
  if (sp.code) {
    const code = JSON.stringify([{ code: sp.code }]);
    conds.push(Prisma.sql`(knockouts @> ${code}::jsonb or (stage = 'OUT' and flags @> ${code}::jsonb) or "rejectCode" = ${sp.code})`);
  }
  const where = Prisma.join(conds, ' and ');
  const [ids, count] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`
      select id from "MatchCandidate" where ${where}
      order by ${RANK}, total desc nulls last, (score->>'total')::float desc nulls last, handle limit ${PER} offset ${(page - 1) * PER}`,
    db.$queryRaw<{ n: number }[]>`select count(*)::int n from "MatchCandidate" where ${where}`,
  ]);
  const pos = new Map(ids.map((x, i) => [x.id, i]));
  const rows = (await db.matchCandidate.findMany({ where: { id: { in: ids.map((x) => x.id) } } })).sort((x, y) => pos.get(x.id)! - pos.get(y.id)!);
  return { rows, total: count[0]?.n ?? 0 };
}

const picked = (step: number, stage: string) => STEP_PICKED[step]?.includes(stage as Stage) ?? false;
const pickedCount = (step: number, n: Partial<Record<Stage, number>>) => STEP_PICKED[step].reduce((x, st) => x + (n[st] ?? 0), 0);
const allCount = (n: Partial<Record<Stage, number>>) => Object.values(n).reduce((x, y) => x + (y ?? 0), 0);

/** Dòng của bảng: KOC chưa qua bước này mờ đi và nằm dưới vạch "còn lại". */
function rowsWithDivider(rows: MatchCandidate[], step: number, cols: number, render: (c: MatchCandidate, dim: string) => React.ReactNode) {
  const out: React.ReactNode[] = [];
  let divided = false;
  for (const c of rows) {
    const on = picked(step, c.stage);
    if (!on && !divided) {
      divided = true;
      out.push(<tr key="divider"><td colSpan={cols} className="bg-sunken py-1.5 text-center text-xs text-ink-3">KOC chưa qua bước này (vẫn giữ trong danh sách, xếp theo trạng thái rồi điểm)</td></tr>);
    }
    out.push(render(c, on ? '' : 'opacity-60'));
  }
  return out;
}

/** Lý do một KOC không qua: mã loại tự động, mã loại tay, hoặc lý do ngoài pool. */
function Why({ c }: { c: MatchCandidate }) {
  const { ko, flags } = sd(c);
  if (c.stage === 'REJECTED') return <span className="text-xs text-critical">{c.rejectCode ? koLabel(c.rejectCode) : 'Đã loại'}{c.reason ? `: ${c.reason}` : ''}</span>;
  if (c.stage === 'OUT') return <Findings list={flags.filter((f) => f.code === 'POOL')} />;
  if (c.stage === 'KO') return <Findings list={ko} />;
  return null;
}

function Summary({ step, n, label }: { step: number; n: Partial<Record<Stage, number>>; label: string }) {
  return (
    <p className="mb-2 text-[13px]">
      <b>{fmtNum(pickedCount(step, n))}</b> / {fmtNum(allCount(n))} KOC {label}
      <span className="ml-2 text-xs text-ink-3">{STAGE_ORDER.filter((st) => n[st]).map((st) => `${STAGES[st]} ${fmtNum(n[st])}`).join(' · ')}</span>
    </p>
  );
}

function Filters({ sp, step, codes }: { sp: Search; step: number; codes?: { code: string; n: number }[] }) {
  return (
    <form className="flex flex-wrap gap-2">
      <input type="hidden" name="step" value={step} />
      <input name="q" defaultValue={sp.q ?? ''} placeholder="Tìm ID kênh" aria-label="Tìm ID kênh" className="input h-8 w-40 text-[13px]" />
      <select name="stage" defaultValue={sp.stage ?? ''} aria-label="Trạng thái" className="input h-8 w-40 text-[13px]">
        <option value="">Mọi trạng thái</option>
        {STAGE_ORDER.map((st) => <option key={st} value={st}>{STAGES[st]}</option>)}
      </select>
      <select name="src" defaultValue={sp.src ?? ''} aria-label="Nguồn" className="input h-8 w-36 text-[13px]">
        <option value="">Mọi nguồn</option><option value="danhba">Danh bạ</option><option value="kho">Chỉ có trong kho</option>
      </select>
      {codes && (
        <select name="code" defaultValue={sp.code ?? ''} aria-label="Mã loại" className="input h-8 w-52 text-[13px]">
          <option value="">Mọi mã loại</option>
          {codes.map((c) => <option key={c.code} value={c.code}>{koLabel(c.code)} · {c.n}</option>)}
        </select>
      )}
      <button className="btn h-8 px-3 text-xs">Lọc</button>
    </form>
  );
}

const hiddenCtx = (c: MatchCandidate, step: number, sp: Search) => (
  <><input type="hidden" name="cid" value={c.id} /><input type="hidden" name="step" value={step} /><input type="hidden" name="page" value={sp.page ?? ''} /></>
);

// ---------------------------------------------------------------- Bước 2
async function Pool({ b, n, page, open, listParams, sp }: Ctx) {
  if (!b.ranAt) return <NotRun b={b} />;
  const { rows, total } = await listPage(b, sp, page);
  return (
    <Panel title={`Pool ứng viên · ${fmtNum(total)}`} action={<Filters sp={sp} step={2} />}>
      <Summary step={2} n={n} label="trong pool (chưa tính KOC ngoài bộ lọc ngành / KL)" />
      <p className="mb-2 text-xs text-ink-3">Danh bạ KOC trên kênh {b.channel} + creator từ kho. KOC không khớp ngành / KL cần book vẫn được giữ ở trạng thái "Ngoài pool". Số liệu: kho dữ liệu nếu có, không thì số TikTok Shop ở Danh bạ.</p>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>KOC</th><th>Trạng thái</th><th>Nguồn số liệu</th><th className="text-right">Follower</th><th className="text-right">View trung vị</th><th className="text-right">ER</th><th className="text-right">GMV 30 ngày</th><th>Điểm sơ bộ</th><th>Lý do</th></tr></thead>
          <tbody>
            {rowsWithDivider(rows, 2, 9, (c, dim) => {
              const { d, s } = sd(c);
              return (
                <tr key={c.id} className={`align-top ${dim}`}>
                  <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                  <td><StageChip stage={c.stage} /></td>
                  <td className="text-xs">{d.metrics?.source ?? <span className="text-ink-3">Chưa có số liệu</span>}{d.metrics?.at && <div className="text-ink-3">{fmtDate(new Date(d.metrics.at))}</div>}</td>
                  {metricCells(d.metrics).map((v, i) => <td key={i} className="text-right tabular-nums">{v}</td>)}
                  <td><Total score={s} /></td>
                  <td className="max-w-72"><Why c={c} /></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={9} className="py-10 text-center text-ink-3">Không có ứng viên.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager params={listParams} page={page} perPage={PER} total={total} />
    </Panel>
  );
}

// ---------------------------------------------------------------- Bước 3
async function DataKo({ b, me, n, page, open, listParams, sp }: Ctx) {
  if (!b.ranAt) return <NotRun b={b} />;
  const [{ rows, total }, byCode] = await Promise.all([
    listPage(b, sp, page),
    db.$queryRaw<{ code: string; n: number }[]>`
      select code, count(*)::int n from (
        select k->>'code' code from "MatchCandidate" c, jsonb_array_elements(c.knockouts) k where c."briefId" = ${b.id} and c.stage = 'KO'
        union all select 'POOL' from "MatchCandidate" where "briefId" = ${b.id} and stage = 'OUT'
        union all select "rejectCode" from "MatchCandidate" where "briefId" = ${b.id} and stage = 'REJECTED' and "rejectCode" is not null
      ) x group by 1 order by 2 desc`,
  ]);
  const rules = parseRules(b.brandRef?.rules);
  const canKeep = can(me, 'match.approve') || rules.exceptionApprover === me.id;
  return (
    <Panel title={`Loại bằng dữ liệu · ${fmtNum(total)} KOC`} action={<Filters sp={sp} step={3} codes={byCode} />}>
      <Summary step={3} n={n} label="qua bước loại bằng dữ liệu" />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {byCode.map((c) => <Link key={c.code} href={`?step=3&code=${c.code}`} className={`pill ${sp.code === c.code ? 'bg-accent text-surface' : 'bg-critical-soft text-critical'}`} title={KO[c.code as keyof typeof KO]?.rule}>{koLabel(c.code)} · {c.n}</Link>)}
        {sp.code && <Link href="?step=3" className="pill bg-sunken text-ink-2">Bỏ lọc mã</Link>}
      </div>
      <p className="mb-2 text-xs text-ink-3">
        KOC bị loại vẫn nằm trong danh sách (dưới vạch), kèm mã và lý do. K2, K3 cần dữ liệu QC nhạy cảm / gian Mall–Official mà kho chưa có: Booker kiểm ở bước 4.
        K13 chỉ suy quyền gắn giỏ từ video gắn giỏ / lượt bán; cảnh báo vi phạm 90 ngày kho chưa có, Booker hỏi khi liên hệ. Số liệu thiếu thì không loại (chỉ cảnh báo).
        {canKeep ? ' Bạn duyệt được ngoại lệ: ghi lý do rồi "Giữ lại".' : ''}
      </p>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>KOC</th><th>Trạng thái</th><th>Mã loại, lý do / cảnh báo</th><th className="text-right">Follower</th><th className="text-right">View</th><th>Thao tác</th></tr></thead>
          <tbody>
            {rowsWithDivider(rows, 3, 6, (c, dim) => {
              const { d, flags } = sd(c);
              return (
                <tr key={c.id} className={`align-top ${dim}`}>
                  <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                  <td><StageChip stage={c.stage} />{c.exception && <div className="mt-0.5 text-xs text-warning">Ngoại lệ</div>}</td>
                  <td className="max-w-xl"><Why c={c} />{picked(3, c.stage) && <Findings list={flags.filter((f) => f.code !== 'POOL')} />}</td>
                  <td className="text-right tabular-nums">{fmtShort(d.metrics?.followers)}</td>
                  <td className="text-right tabular-nums">{fmtShort(d.metrics?.medianViews)}</td>
                  <td>
                    {(c.stage === 'KO' || c.stage === 'OUT') && canKeep && (
                      <form action={keepException} className="flex gap-1.5">{hiddenCtx(c, 3, sp)}
                        <input name="reason" required placeholder="Lý do giữ" aria-label={`Lý do giữ @${c.handle}`} className="input h-7 w-32 px-1.5 text-xs" />
                        <button className="btn h-7 px-2 text-xs">Giữ lại</button>
                      </form>
                    )}
                    {c.stage === 'REJECTED' && <form action={restoreCandidate}>{hiddenCtx(c, 3, sp)}<button className="link text-xs">Khôi phục</button></form>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="py-10 text-center text-ink-3">Không có.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager params={listParams} page={page} perPage={PER} total={total} />
    </Panel>
  );
}

// ---------------------------------------------------------------- Bước 4
async function ContentKo({ b, n, page, open, listParams, sp }: Ctx) {
  if (!b.ranAt) return <NotRun b={b} />;
  const codes = contentChecksFor(b);
  const { rows, total } = await listPage(b, sp, page);
  const rules = parseRules(b.brandRef?.rules);
  return (
    <Panel title={`Kiểm tra nội dung kênh · ${fmtNum(total)} KOC`} action={<Filters sp={sp} step={4} />}>
      <Summary step={4} n={n} label="đang được xét (chưa bị loại)" />
      <div className="mb-3 rounded-md bg-sunken px-3 py-2 text-xs text-ink-2">
        Kho chưa có lời thoại / hình của 20–30 video gần nhất nên AI chưa quét được: Booker xem kênh và đánh dấu từng mã; một mã "Không đạt" là KOC chuyển "Đã loại" (vẫn trong danh sách). Kiểm từ trên xuống theo điểm.
        <ul className="mt-1 list-disc pl-4">
          {codes.map((k) => <li key={k}><b>{koLabel(k)}</b>: {KO[k].rule}</li>)}
        </ul>
        Cửa sổ scandal: {SCANDAL_LABEL[rules.scandal]} · chống đối thủ {rules.competitorDays} ngày trước air, giá ±{rules.priceBand}%
        {b.brandRef?.competitors.length ? ` · đối thủ: ${b.brandRef.competitors.join(', ')}` : ''}{b.product?.exclusions.length ? ` · TH loại SKU: ${b.product.exclusions.join('; ')}` : ''}
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>KOC</th><th>Trạng thái</th><th>Video nổi bật</th><th>Gợi ý từ dữ liệu</th>{codes.map((k) => <th key={k} className="text-center" title={KO[k].label}>{k}</th>)}<th>Điểm</th><th /></tr></thead>
          <tbody>
            {rowsWithDivider(rows, 4, codes.length + 6, (c, dim) => {
              const { d, s, flags } = sd(c);
              const checks = (c.checks ?? {}) as Record<string, Check>;
              const hints = flags.filter((f) => (CONTENT_CHECKS as readonly string[]).includes(f.code));
              return (
                <tr key={c.id} className={`align-top ${dim}`}>
                  <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                  <td><StageChip stage={c.stage} /></td>
                  <td className="max-w-64 text-xs">
                    {(d.metrics?.topVideos ?? []).slice(0, 2).map((v, i) => <div key={i} className="truncate">{v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="link">{v.title || 'Video'}</a> : v.title}</div>)}
                    {!d.metrics?.topVideos?.length && <span className="text-ink-3">—</span>}
                  </td>
                  <td className="max-w-64">{picked(4, c.stage) ? <Findings list={hints} empty="—" /> : <Why c={c} />}</td>
                  {codes.map((k) => <td key={k} className="text-center">{checks[k] ? (checks[k].ok ? <span className="text-positive" title={checks[k].note}>✓</span> : <span className="text-critical" title={checks[k].note}>✕</span>) : <span className="text-ink-3">·</span>}</td>)}
                  <td><Total score={s} /></td>
                  <td className="whitespace-nowrap text-right">
                    {picked(4, c.stage) && checksDone(checks, codes) < codes.length && (
                      <form action={saveChecks} className="inline">{hiddenCtx(c, 4, sp)}<input type="hidden" name="all" value="1" />
                        <button className="btn h-7 px-2 text-xs" title="Đã xem kênh, không vi phạm mã nào">Đạt hết</button>
                      </form>
                    )}
                    <Link href={open(c.id)} scroll={false} className="btn ml-1 h-7 px-2 text-xs">Chi tiết</Link>
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={codes.length + 6} className="py-10 text-center text-ink-3">Không có ứng viên.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager params={listParams} page={page} perPage={PER} total={total} />
    </Panel>
  );
}

// ---------------------------------------------------------------- Bước 5
async function slotFill(b: Brief, stages: Stage[]) {
  const rows = await db.matchCandidate.groupBy({ by: ['kl'], where: { briefId: b.id, stage: { in: stages } }, _count: true });
  const has = new Map(rows.map((r) => [r.kl ?? '?', r._count]));
  return { slots: parseSlots(b.slots), has };
}
function Slots({ fill, label }: { fill: Awaited<ReturnType<typeof slotFill>>; label: string }) {
  if (!fill.slots.length) return <p className="text-xs text-ink-3">Đợt chưa khai số KOC theo KL (I-32).</p>;
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {fill.slots.map((s) => {
        const got = fill.has.get(s.kl) ?? 0;
        return <span key={s.kl} className={`pill ${got >= s.count ? 'bg-positive-soft text-positive' : 'bg-sunken text-ink-2'}`}>{s.kl}{s.role ? ` ${s.role}` : ''}: {label} {got}/{s.count}</span>;
      })}
    </div>
  );
}

async function Shortlist({ b, n, page, open, listParams, sp }: Ctx) {
  if (!b.ranAt) return <NotRun b={b} />;
  const codes = contentChecksFor(b);
  const [{ rows, total }, fill] = await Promise.all([listPage(b, sp, page), slotFill(b, ['SHORTLIST', 'CONFIRMED', 'APPROVED'])]);
  const need = fill.slots.reduce((s, x) => s + x.count, 0);
  return (
    <Panel title={`Chấm sơ bộ & shortlist · ${fmtNum(total)} KOC`} action={<Filters sp={sp} step={5} />}>
      <Summary step={5} n={n} label="đã vào shortlist" />
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <Slots fill={fill} label="đã shortlist" />
        <form action={shortlist} className="flex items-end gap-2">
          <input type="hidden" name="briefId" value={b.id} />
          <label><span className="label">Lấy top N theo điểm (trong pool)</span><input name="top" inputMode="numeric" defaultValue={need ? need * 2 : 20} className="input h-8 w-24" /></label>
          <button className="btn h-8 px-3 text-xs">Đưa top N vào shortlist</button>
        </form>
      </div>
      <p className="mb-2 text-xs text-ink-3">KOC đã shortlist lên đầu, KOC còn lại xếp dưới theo điểm. Điểm 1–5 từng nhóm, tổng quy về 100 trên phần có số liệu (số nhỏ = độ phủ trọng số); "·" = chưa có số liệu, chấm tay ở chi tiết KOC.</p>
      <form action={shortlist}>
        <input type="hidden" name="briefId" value={b.id} />
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th className="w-8" /><th>KOC</th><th>Trạng thái</th>{GROUP_HEADS}<th>Tổng</th><th>Mức</th><th>Kiểm nội dung</th><th className="text-right">Giá tham chiếu</th></tr></thead>
            <tbody>
              {rowsWithDivider(rows, 5, 13, (c, dim) => {
                const { d, s } = sd(c);
                const done = checksDone((c.checks ?? {}) as Record<string, Check>, codes);
                return (
                  <tr key={c.id} className={dim}>
                    <td>{c.stage === 'POOL' && <input type="checkbox" name="cid" value={c.id} aria-label={`Chọn @${c.handle}`} />}</td>
                    <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                    <td><StageChip stage={c.stage} /></td>
                    <GroupCells score={s} />
                    <td><Total score={s} /></td>
                    <td><TierChip score={s} /></td>
                    <td className={`text-xs ${done === codes.length ? 'text-positive' : 'text-warning'}`}>{done}/{codes.length}</td>
                    <td className="text-right text-xs tabular-nums">{fmtShort(d.price)}{d.priceSource && <div className="text-ink-3">{d.priceSource}</div>}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={13} className="py-10 text-center text-ink-3">Không có ứng viên.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-end"><button className="btn btn-primary">Đưa KOC đã tick vào shortlist</button></div>
      </form>
      <Pager params={listParams} page={page} perPage={PER} total={total} />
    </Panel>
  );
}

// ---------------------------------------------------------------- Bước 6
async function Quotes({ b, n, page, open, listParams, sp }: Ctx) {
  const { rows, total } = await listPage(b, sp, page);
  const yn = (v: boolean | undefined) => (v === undefined ? '—' : v ? 'Có' : 'Không');
  return (
    <Panel title={`KOC báo giá & xác nhận · ${fmtNum(total)} KOC`} action={<Filters sp={sp} step={6} />}>
      <Summary step={6} n={n} label="đã báo giá" />
      <p className="mb-2 text-xs text-ink-3">KOC đã báo giá lên đầu, rồi shortlist đang chờ liên hệ, rồi phần còn lại. Không cam kết đối thủ (K8), thiếu chứng chỉ khi có claim chuyên môn (K12), không đồng ý ads code khi chạy GMV Max (K14) là loại.</p>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>KOC</th><th>Trạng thái</th><th className="text-right">Giá tham chiếu</th><th className="text-right">Giá KOC báo</th><th>Ads code</th><th>Cam kết đối thủ</th>{b.expertClaim && <th>Chứng chỉ</th>}<th /></tr></thead>
          <tbody>
            {rowsWithDivider(rows, 6, 8, (c, dim) => {
              const { d } = sd(c);
              const dc = (c.declare ?? {}) as Declare;
              const active = c.stage === 'SHORTLIST' || c.stage === 'CONFIRMED';
              return (
                <tr key={c.id} className={dim}>
                  <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                  <td><StageChip stage={c.stage} />{c.stage === 'SHORTLIST' && <div className="text-xs text-ink-3">{dc.declared ? 'Đang trao đổi' : 'Chưa liên hệ'}</div>}</td>
                  <td className="text-right text-xs tabular-nums">{d.priceSource === 'Giá KOC báo' ? '—' : fmtShort(d.price)}</td>
                  <td className="text-right tabular-nums">{dc.quote ? fmtVnd(dc.quote) : '—'}{b.feeCap && dc.quote && dc.quote > b.feeCap ? <div className="text-xs text-critical">Vượt trần fee</div> : null}</td>
                  <td className="text-xs">{yn(dc.adsCode)}{dc.adsDays ? ` · ${dc.adsDays} ngày` : ''}</td>
                  <td className="text-xs">{yn(dc.noCompetitor)}</td>
                  {b.expertClaim && <td className="text-xs">{dc.certificate ?? '—'}</td>}
                  <td className="whitespace-nowrap text-right">
                    {active && c.kocId && <Link href={`/contacts/${c.kocId}`} className="btn h-7 px-2 text-xs">Liên hệ</Link>}
                    <Link href={open(c.id)} scroll={false} className="btn ml-1 h-7 px-2 text-xs">{active ? 'Ghi khai báo' : 'Chi tiết'}</Link>
                    {c.stage === 'SHORTLIST' && (
                      <form action={unshortlist} className="inline">{hiddenCtx(c, 6, sp)}<button className="link ml-2 text-xs">Bỏ shortlist</button></form>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="py-10 text-center text-ink-3">Không có ứng viên.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager params={listParams} page={page} perPage={PER} total={total} />
    </Panel>
  );
}

// ---------------------------------------------------------------- Bước 7
async function FullScore({ b, n, page, open, listParams, sp }: Ctx) {
  const { rows, total } = await listPage(b, sp, page);
  return (
    <Panel title={`Chấm hoàn chỉnh · ${fmtNum(total)} KOC`} action={<Filters sp={sp} step={7} />}>
      <Summary step={7} n={n} label="đang chấm hoàn chỉnh (shortlist trở đi)" />
      <p className="mb-2 text-xs text-ink-3">CPV tính theo giá KOC báo. Nhóm D, tone, độ ổn định view và tiêu chí nhóm 0 kho chưa có số: Booker chấm tay 1–5 ở chi tiết KOC (đè được điểm tự động, ghi lý do).</p>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>KOC</th><th>Trạng thái</th>{GROUP_HEADS}<th>Tổng</th><th>Mức kết luận</th><th>Chưa chấm</th><th /></tr></thead>
          <tbody>
            {rowsWithDivider(rows, 7, 12, (c, dim) => {
              const { d, s } = sd(c);
              const missing = (s?.groups ?? []).flatMap((g) => g.parts).filter((p) => p.score == null).length;
              return (
                <tr key={c.id} className={dim}>
                  <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                  <td><StageChip stage={c.stage} /></td>
                  <GroupCells score={s} />
                  <td><Total score={s} /></td>
                  <td><TierChip score={s} /></td>
                  <td className="text-xs">{missing ? `${missing} tiêu chí` : <span className="text-positive">Đủ</span>}</td>
                  <td className="text-right"><Link href={`${open(c.id)}#manual`} scroll={false} className="btn h-7 px-2 text-xs">Chấm tay</Link></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={12} className="py-10 text-center text-ink-3">Không có ứng viên.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager params={listParams} page={page} perPage={PER} total={total} />
    </Panel>
  );
}

// ---------------------------------------------------------------- Bước 8
async function Approve({ b, me, n, page, open, listParams, sp }: Ctx) {
  const [{ rows, total }, fill, quoted] = await Promise.all([
    listPage(b, sp, page), slotFill(b, ['APPROVED']),
    db.matchCandidate.findMany({ where: { briefId: b.id, stage: { in: ['CONFIRMED', 'APPROVED'] } }, select: { stage: true, declare: true, data: true } }),
  ]);
  const approved = quoted.filter((c) => c.stage === 'APPROVED');
  const sum = (list: typeof quoted) => list.reduce((s, c) => s + (((c.declare ?? {}) as Declare).quote ?? 0), 0);
  const gmv = (list: typeof quoted) => list.reduce((s, c) => { const m = ((c.data ?? {}) as CandData).metrics; return s + (m?.medianViews && m.gpm ? (m.medianViews * m.gpm) / 1000 : 0); }, 0);
  const allowed = can(me, 'match.approve');
  return (
    <>
      <Panel title="Kiểm tra khả thi">
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-ink-3">Số KOC theo KL (I-32)</dt><dd><Slots fill={fill} label="đã duyệt" /></dd></div>
          <div><dt className="text-xs text-ink-3">Giá net đã duyệt / ngân sách (I-33)</dt><dd>{fmtVndShort(sum(approved))} / {b.budget ? fmtVndShort(b.budget) : '—'}<div className="text-xs text-ink-3">Phí kèm thuế TNCN ~{fmtVndShort(sum(approved) / FEE_DIVISOR)} · chờ duyệt {fmtVndShort(sum(quoted) - sum(approved))}</div></dd></div>
          <div><dt className="text-xs text-ink-3">GMV dự báo / mục tiêu (I-37)</dt><dd>{fmtVndShort(gmv(approved))} / {b.gmvTarget ? fmtVndShort(b.gmvTarget) : '—'}<div className="text-xs text-ink-3">View trung vị × GPM ÷ 1.000 mỗi KOC</div></dd></div>
          <div><dt className="text-xs text-ink-3">Vượt trần fee mỗi KOC</dt><dd>{b.feeCap ? quoted.filter((c) => (((c.declare ?? {}) as Declare).quote ?? 0) > b.feeCap!).length : '—'}</dd></div>
        </dl>
      </Panel>
      <Panel title={`B2C duyệt · ${fmtNum(total)} KOC`} action={<Filters sp={sp} step={8} />}>
        <Summary step={8} n={n} label="B2C đã duyệt" />
        {!allowed && <p className="mb-2 text-xs text-warning">Bạn chỉ xem: duyệt cần quyền "Duyệt list KOC" (Phân quyền).</p>}
        <form action={approve}>
          <input type="hidden" name="briefId" value={b.id} />
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th className="w-8" /><th>KOC</th><th>Trạng thái</th>{GROUP_HEADS}<th>Tổng</th><th>Mức kết luận · hành động</th><th className="text-right">Giá báo</th></tr></thead>
              <tbody>
                {rowsWithDivider(rows, 8, 13, (c, dim) => {
                  const { d, s } = sd(c);
                  return (
                    <tr key={c.id} className={`align-top ${dim}`}>
                      <td>{allowed && (c.stage === 'CONFIRMED' || c.stage === 'APPROVED') && <input type="checkbox" name="cid" value={c.id} aria-label={`Chọn @${c.handle}`} />}</td>
                      <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                      <td><StageChip stage={c.stage} /></td>
                      <GroupCells score={s} />
                      <td><Total score={s} /></td>
                      <td className="max-w-72"><TierChip score={s} /><div className="mt-0.5 text-xs text-ink-3">{s?.action}</div></td>
                      <td className="text-right tabular-nums">{fmtVnd(((c.declare ?? {}) as Declare).quote)}</td>
                    </tr>
                  );
                })}
                {!rows.length && <tr><td colSpan={13} className="py-10 text-center text-ink-3">Không có ứng viên.</td></tr>}
              </tbody>
            </table>
          </div>
          {allowed && (
            <div className="mt-3 flex flex-wrap items-end justify-end gap-2">
              <label><span className="label">Lý do (trả lại / loại)</span><input name="reason" className="input h-8 w-64" /></label>
              <select name="code" defaultValue="SCORE" aria-label="Mã loại" className="input h-8 w-48 text-[13px]">
                {Object.entries(KO).map(([k, v]) => <option key={k} value={k}>{k} · {v.label}</option>)}
              </select>
              <button name="action" value="reject" className="btn h-8 px-3 text-xs">Loại</button>
              <button name="action" value="return" className="btn h-8 px-3 text-xs">Trả về báo giá</button>
              <button name="action" value="approve" className="btn btn-primary h-8 px-3 text-xs">Duyệt KOC đã tick</button>
            </div>
          )}
        </form>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 9
async function Export({ b, me, n, page, open, listParams, sp }: Ctx) {
  const [{ rows, total }, batches] = await Promise.all([
    listPage(b, sp, page),
    db.listingBatch.findMany({ where: { OR: [{ briefId: b.id }, ...(b.brand ? [{ brand: b.brand, briefId: null, NOT: { id: { startsWith: 'lark-' } } }] : [])] }, orderBy: { updatedAt: 'desc' }, take: 20, select: { id: true, name: true, month: true, briefId: true, _count: { select: { items: true } } } }),
  ]);
  const linked = batches.filter((x) => x.briefId === b.id);
  const approvedN = n.APPROVED ?? 0;
  return (
    <>
      <Panel title={`Xuất list · ${fmtNum(total)} KOC`} action={<div className="flex flex-wrap gap-2"><Filters sp={sp} step={9} />{can(me, 'data.export') && <><a href={`/matching/${b.id}/export`} className="btn h-8 px-3 text-xs">Excel list đã duyệt</a><a href={`/matching/${b.id}/export?all=1`} className="btn h-8 px-3 text-xs">Excel tất cả KOC</a></>}</div>}>
        <Summary step={9} n={n} label="trong list gửi brand" />
        <p className="mb-2 text-xs text-ink-3">List gửi brand = KOC B2C đã duyệt (trên vạch), kèm điểm 6 nhóm, mức kết luận, lý do chính; không có mã K15. "Excel tất cả KOC" gồm cả KOC xếp dưới (trạng thái, lý do), dùng nội bộ.</p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>KOC</th><th>Trạng thái</th>{GROUP_HEADS}<th>Tổng</th><th>Mức kết luận</th><th>Lý do chính</th><th className="text-right">Giá báo</th></tr></thead>
            <tbody>
              {rowsWithDivider(rows, 9, 13, (c, dim) => {
                const { d, s } = sd(c);
                return (
                  <tr key={c.id} className={`align-top ${dim}`}>
                    <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                    <td><StageChip stage={c.stage} /></td>
                    <GroupCells score={s} />
                    <td><Total score={s} /></td>
                    <td><TierChip score={s} /></td>
                    <td className="max-w-80 text-xs">{picked(9, c.stage) ? <>{s?.strengths.length ? `Mạnh: ${s.strengths.join(', ')}` : ''}{s?.weaknesses.length ? <div className="text-ink-3">Yếu: {s.weaknesses.join(', ')}</div> : null}</> : <Why c={c} />}</td>
                    <td className="text-right tabular-nums">{fmtVnd(((c.declare ?? {}) as Declare).quote)}</td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={13} className="py-10 text-center text-ink-3">Không có ứng viên.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
      <Panel title="Đưa sang Listing cho brand duyệt">
        {linked.length > 0 && <p className="mb-2 text-[13px]">Đợt listing của matching này: {linked.map((x, i) => <span key={x.id}>{i > 0 && ', '}<Link href={`/listing/${x.id}`} className="link">{x.name}</Link> ({x._count.items} KOC)</span>)}</p>}
        {approvedN > 0 ? (
          <form action={toListing} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="briefId" value={b.id} />
            <label className="min-w-56 flex-1">
              <span className="label">Đợt listing</span>
              <select name="batchId" defaultValue={linked[0]?.id ?? 'new'} className="input">
                <option value="new">+ Tạo đợt mới</option>
                {batches.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.month}</option>)}
              </select>
            </label>
            <label className="min-w-56 flex-1"><span className="label">Tên đợt mới</span><input name="name" defaultValue={b.name} className="input" /></label>
            <button className="btn btn-primary">Đưa {approvedN} KOC đã duyệt sang Listing</button>
          </form>
        ) : <p className="text-xs text-ink-3">Duyệt KOC ở bước 8 trước.</p>}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 10
async function AfterAir({ b, n, page, open, listParams, sp }: Ctx) {
  const { rows, total } = await listPage(b, sp, page);
  const live = rows.filter((c) => c.stage === 'APPROVED');
  const kocIds = live.map((c) => c.kocId).filter((x): x is string => !!x);
  const handles = live.map((c) => c.handle);
  const since = b.airMonth ? `${b.airMonth.slice(0, 4)}/${b.airMonth.slice(5)}` : null;
  const [jobs, bookings] = await Promise.all([
    kocIds.length ? db.job.findMany({ where: { kocId: { in: kocIds }, listingItem: { batch: { briefId: b.id } } }, select: { kocId: true, number: true, stage: true, reviewResult: true } }) : [],
    b.brand && handles.length ? db.$queryRaw<{ h: string; code: string; airDate: Date | null; cost: number | null; extra: Record<string, unknown> }[]>`
      select lower(channel) h, code, "airDate", cost, extra from "Booking"
      where lower(channel) = any(${handles}) and lower(regexp_replace(coalesce(brand, ''), '[^[:alnum:]]+', '', 'g')) = ${b.brand.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')}
        and (${since}::text is null or "planMonth" >= ${since})` : [],
  ]);
  const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return (
    <Panel title={`Đánh giá sau air · ${fmtNum(total)} KOC`} action={<Filters sp={sp} step={10} />}>
      <Summary step={10} n={n} label="đã book (B2C duyệt)" />
      <p className="mb-2 text-xs text-ink-3">GMV / view 30 ngày từ booking Lark cùng brand (từ tháng air), job tạo từ listing của đợt này. Ghi kết quả + chấm sao: nuôi K15, nhóm C và E cho lần matching sau; "Vào KOC core" gắn nhãn ở Danh bạ, "Dừng" ghi đánh giá Không phù hợp với brand.</p>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>KOC</th><th>Trạng thái</th><th>Job / booking</th><th className="text-right">View 30 ngày</th><th className="text-right">GMV / video</th><th className="text-right">CPV</th><th className="text-right">ROI</th><th>Kết quả</th><th /></tr></thead>
          <tbody>
            {rowsWithDivider(rows, 10, 9, (c, dim) => {
              const { d } = sd(c);
              const on = c.stage === 'APPROVED';
              const js = jobs.filter((j) => j.kocId === c.kocId);
              const bs = bookings.filter((x) => x.h === c.handle);
              const views = bs.reduce((s, x) => s + (num(x.extra?.views30) ?? 0), 0);
              const gmv = bs.reduce((s, x) => s + (num(x.extra?.gmv30) ?? 0), 0);
              const cost = bs.reduce((s, x) => s + (x.cost ?? 0), 0);
              const o = c.outcome as Outcome | null;
              return (
                <tr key={c.id} className={`align-top ${dim}`}>
                  <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                  <td><StageChip stage={c.stage} /></td>
                  <td className="text-xs">
                    {js.map((j) => <div key={j.number}><Link href={`/jobs?q=${j.number}`} className="link">Job #{j.number}</Link> · {j.stage}{j.reviewResult ? ` · ${j.reviewResult}` : ''}</div>)}
                    {bs.map((x) => <div key={x.code}>{x.code} · air {fmtDate(x.airDate)}</div>)}
                    {on && !js.length && !bs.length && <span className="text-ink-3">Chưa có</span>}
                    {!on && <Why c={c} />}
                  </td>
                  <td className="text-right tabular-nums">{views ? fmtShort(views) : '—'}</td>
                  <td className="text-right tabular-nums">{bs.length && gmv ? fmtVndShort(gmv / bs.length) : '—'}</td>
                  <td className="text-right tabular-nums">{views && cost ? fmtVnd(cost / views) : '—'}</td>
                  <td className="text-right tabular-nums">{cost && gmv ? `${(gmv / cost).toFixed(2).replace('.', ',')}×` : '—'}</td>
                  <td className="text-xs">{o ? <>{o.decision ? <b>{DECISIONS[o.decision]}</b> : 'Đã ghi'}{o.kpiMet != null && ` · KPI ${o.kpiMet ? 'đạt' : 'không đạt'}`}{o.contentError && ` · lỗi ${o.contentError}`}</> : on ? <span className="text-ink-3">Chưa ghi</span> : null}</td>
                  <td className="text-right">{on && <Link href={`${open(c.id)}#outcome`} scroll={false} className="btn h-7 px-2 text-xs">Ghi kết quả</Link>}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={9} className="py-10 text-center text-ink-3">Không có ứng viên.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager params={listParams} page={page} perPage={PER} total={total} />
    </Panel>
  );
}
