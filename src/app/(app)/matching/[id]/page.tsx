import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Prisma, type MatchCandidate } from '@prisma/client';
import { ActionForm, Dialog } from '@/components/ui';
import { Pager, pageOf } from '@/components/Pager';
import { db } from '@/lib/db';
import { fmtDate, fmtNum, fmtShort, fmtVnd, fmtVndShort } from '@/lib/format';
import { FEE_DIVISOR } from '@/lib/koc/kocInsights';
import { aiOn } from '@/lib/matching/ai';
import type { Finding, ScoreResult } from '@/lib/matching/engine';
import { contentChecksFor } from '@/lib/matching/run';
import {
  criterion, DECISIONS, hasRequired, KL_LEVELS, KO, koLabel, OBJECTIVE_LABEL, parseNeeds, parseRules, parseSlots, STAGE_ORDER, STAGES, STEP_PICKED, STEP_WORKING, STEPS,
  type Declare, type Outcome, type Stage,
} from '@/lib/matching/spec';
import { warehouseStatus } from '@/lib/warehouse/creatorSync';
import { can, requireUser } from '@/lib/auth/session';
import { aiScoreFit, approve, deleteBrief, pick, restoreCandidate, runNow, toListing, unshortlist } from '../actions';
import { AiBriefBox, BriefForm } from '../BriefForm';
import { channelUrl, currentStep, Findings, FitCell, KocCell, StageChip, Stepper, TierChip, Todo, Total, type CandData } from '../parts';
import { CandidateDialog, type Mode } from './CandidateDialog';

type Search = { step?: string; c?: string; m?: string; page?: string; q?: string; src?: string; code?: string; stage?: string; sort?: string; msg?: string; err?: string; edit?: string };
const PER = 50;
/** Link cũ theo 10 bước (bookmark, listing) → bước mới. */
const OLD_STEP: Record<number, number> = { 8: 6, 9: 6, 10: 7 };
/** Mọi bước dùng chung một thứ tự: KOC đi xa nhất lên đầu (STAGE_ORDER), cùng trạng thái thì điểm cao trước. */
const RANK = Prisma.raw(`case stage ${STAGE_ORDER.map((st, i) => `when '${st}' then ${i}`).join(' ')} else 99 end`);
const sd = (c: MatchCandidate) => ({ d: (c.data ?? {}) as CandData, s: (c.score ?? null) as ScoreResult | null, ko: (c.knockouts ?? []) as Finding[], flags: (c.flags ?? []) as Finding[] });
const air = (m: string | null, w: number | null) => (m ? `${m.split('-').reverse().join('/')}${w ? ` tuần ${w}` : ''}` : null);

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
  const asked = Number(sp.step) || 0;
  const step = Math.min(STEPS.length, Math.max(1, OLD_STEP[asked] ?? (asked || currentStep(b, n))));
  // Số trên từng bước = số KOC qua bước đó; danh sách của bước vẫn hiện đủ mọi KOC.
  const stepCounts: Record<number, number | undefined> = b.ranAt
    ? Object.fromEntries(Object.entries(STEP_PICKED).map(([k, st]) => [k, st.reduce((x, y) => x + (n[y] ?? 0), 0)]))
    : {};
  const page = pageOf(sp.page);
  const filters = Object.entries({ q: sp.q, src: sp.src, code: sp.code, stage: sp.stage, sort: sp.sort }).filter(([, v]) => v) as [string, string][];
  const base = `/matching/${id}?${new URLSearchParams([['step', String(step)], ...(sp.page ? [['page', sp.page]] : []), ...filters])}`;
  const pop = (cid: string, m: Mode) => `${base}&c=${cid}&m=${m}`;
  const listParams = new URLSearchParams([['step', String(step)], ...filters]);
  const [brands, ai] = await Promise.all([
    sp.edit ? db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, products: { select: { id: true, name: true, sku: true }, orderBy: { name: 'asc' } } } }) : [],
    aiOn(),
  ]);
  const ctx = { b, me, n, step, page, base, pop, listParams, sp, ai };

  return (
    <>
      <Link href="/matching" className="text-xs text-ink-3 hover:text-ink">← Danh sách đợt</Link>
      <div className="mt-2 mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{b.name}</h1>
          <p className="mt-0.5 text-[13px] text-ink-2">
            {[b.brand ?? 'Chưa chọn brand', b.product?.name, b.channel, OBJECTIVE_LABEL[b.objective] ?? b.objective, air(b.airMonth, b.airWeek) && `air ${air(b.airMonth, b.airWeek)}`].filter(Boolean).join(' · ')}
            <span className="text-ink-3"> · tạo bởi {b.createdBy.name ?? '—'}</span>
            {b.planLine && <> · từ plan <Link href={`/plan/${b.planLine.plan.id}`} className="link">{b.planLine.plan.name}</Link></>}
          </p>
          {b.runNote && <p className="mt-0.5 text-xs text-ink-3">Lần tìm gần nhất {fmtDate(b.ranAt)}: {b.runNote}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/matching/${id}?step=${step}&edit=1`} className="btn">Sửa yêu cầu</Link>
          <form action={runNow}><input type="hidden" name="id" value={id} /><button className="btn btn-primary" title="Tìm và lọc KOC theo yêu cầu. Những gì bạn đã làm (đã chọn, đã nhập giá…) được giữ nguyên.">{b.ranAt ? 'Tìm lại KOC' : 'Tìm KOC'}</button></form>
        </div>
      </div>
      <Stepper briefId={id} step={step} counts={stepCounts} />
      {(sp.msg || sp.err) && !sp.c && <p role="status" className={`mb-3 rounded-md px-3 py-2 text-[13px] ${sp.err || sp.msg?.startsWith('Lỗi') ? 'bg-critical-soft text-critical' : 'bg-positive-soft text-positive'}`}>{sp.err ?? sp.msg}</p>}

      {step === 1 && <Inputs {...ctx} />}
      {step === 2 && <FindFilter {...ctx} />}
      {step === 3 && <ContentCheck {...ctx} />}
      {step === 4 && <Quote {...ctx} />}
      {step === 5 && <Scoring {...ctx} />}
      {step === 6 && <Approve {...ctx} />}
      {step === 7 && <AfterAir {...ctx} />}

      {sp.c && <CandidateDialog cid={sp.c} mode={(sp.m as Mode) || 'detail'} brief={b} me={me} step={step} page={sp.page} base={base} err={sp.err} />}
      {sp.edit && (
        <Dialog title="Sửa yêu cầu của đợt" closeHref={`/matching/${id}?step=${step}`} wide>
          {ai && <div className="mb-4"><AiBriefBox briefId={b.id} plan={b.plan} /></div>}
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
type Ctx = { b: Brief; me: Awaited<ReturnType<typeof requireUser>>; n: Partial<Record<Stage, number>>; step: number; page: number; base: string; pop: (cid: string, m: Mode) => string; listParams: URLSearchParams; sp: Search; ai: boolean };

const Panel = ({ title, action, children }: { title: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) => (
  <section className="mb-4 rounded-lg border border-line bg-surface px-5 py-4">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-semibold">{title}</h2>{action}</div>
    {children}
  </section>
);
/** Một dòng thông tin; thiếu thì ghi "Chưa có" và (nếu có) hậu quả khi thiếu. */
const Row = ({ k, v, miss }: { k: string; v: React.ReactNode; miss?: string }) => (
  <div className="flex gap-3 border-b border-line py-1.5 text-[13px] last:border-0">
    <dt className="w-44 shrink-0 text-ink-3">{k}</dt>
    <dd className="min-w-0 flex-1 whitespace-pre-line">{v || v === 0 ? v : <span className={miss ? 'text-warning' : 'text-ink-3'}>Chưa có{miss ? `: ${miss}` : ''}</span>}</dd>
  </div>
);
const NotRun = () => <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-10 text-center text-ink-3">Chưa tìm KOC. Kiểm tra yêu cầu ở bước 1 rồi bấm "Tìm KOC" (góc trên bên phải).</p>;
/** Thanh nút nhỏ trên dòng. */
const Act = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap items-center justify-end gap-1.5 whitespace-nowrap">{children}</div>;
const sm = 'btn h-7 px-2.5 text-xs';

// ---------------------------------------------------------------- Bước 1. Yêu cầu
async function Inputs({ b, ai }: Ctx) {
  const brand = b.brandRef;
  const p = b.product;
  const rules = parseRules(brand?.rules);
  const slots = parseSlots(b.slots);
  const nd = parseNeeds(b.needs);
  const wh = await warehouseStatus();
  const brandLink = brand ? `/catalog/${brand.id}` : '/catalog';
  const gender = nd.targetGender || p?.targetGender;
  const ageMin = nd.ageMin ?? p?.ageMin, ageMax = nd.ageMax ?? p?.ageMax;
  const competitors = [...new Set([...(brand?.competitors ?? []), ...(nd.competitors ?? [])])];
  const banned = [...new Set([...(brand?.bannedClaims ?? []), ...(p?.bannedWords ?? []), ...(nd.bannedWords ?? [])])];
  const kls = KL_LEVELS.filter((lv) => rules.kl[lv]?.followersMin != null);
  return (
    <>
      <Todo briefId={b.id} step={1}>
        <Link href={`/matching/${b.id}?step=1&edit=1`} className="btn h-8 px-3 text-xs">Sửa yêu cầu{ai ? ' / dán brief cho AI' : ''}</Link>
        <form action={runNow}><input type="hidden" name="id" value={b.id} /><button className="btn btn-primary h-8 px-3 text-xs">{b.ranAt ? 'Tìm lại KOC' : 'Tìm KOC'}</button></form>
      </Todo>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Yêu cầu của đợt" action={<Link href={`/matching/${b.id}?step=1&edit=1`} className="btn h-8 px-3 text-xs">Sửa</Link>}>
          <dl>
            <Row k="Brand" v={brand?.name} miss="không lọc được theo ngành, không kiểm được trùng booking" />
            <Row k="Sản phẩm" v={p ? `${p.name}${p.price ? ` · ${fmtVnd(p.price)}` : ''}` : null} />
            <Row k="Kênh · mục tiêu" v={`${b.channel} · ${OBJECTIVE_LABEL[b.objective] ?? b.objective}${b.gmvMax ? ' · chạy GMV Max' : ''}`} />
            <Row k="Air" v={air(b.airMonth, b.airWeek)} miss="không kiểm được KOC vừa book gần ngày air" />
            <Row k="Cần bao nhiêu KOC" v={slots.map((s) => `${s.count} KOC ${s.kl}${s.role ? ` (${s.role})` : ''}`).join(', ')} miss="hệ thống tìm mọi cấp KOC" />
            <Row k="Ngân sách" v={[b.budget && `Tổng ${fmtVndShort(b.budget)}`, b.feeCap && `tối đa ${fmtVndShort(b.feeCap)} / KOC`, b.gmvTarget && `mục tiêu GMV ${fmtVndShort(b.gmvTarget)}`].filter(Boolean).join(' · ')} />
          </dl>
        </Panel>
        <Panel title="Yêu cầu nội dung" action={<Link href={`/matching/${b.id}?step=1&edit=1`} className="btn h-8 px-3 text-xs">Sửa</Link>}>
          <dl>
            <Row k="Tóm tắt" v={nd.summary} />
            <Row k="Khách hàng" v={[gender, (ageMin || ageMax) && `${ageMin ?? '?'}–${ageMax ?? '?'} tuổi`].filter(Boolean).join(', ')} />
            <Row k="Tone · thông điệp" v={[nd.tone, nd.usp ?? p?.usp ?? brand?.usp].filter(Boolean).join(' · ')} />
            <Row k="Đối thủ" v={competitors.join(', ')} miss="không cảnh báo được KOC đăng sản phẩm đối thủ" />
            <Row k="Từ bị cấm" v={banned.join(', ')} />
            <Row k="KOC không muốn" v={[...(p?.exclusions ?? []), ...(nd.exclusions ?? [])].join('\n')} />
            <Row k="Từ khoá tìm thêm KOC" v={nd.keywords?.length ? <span className="flex flex-wrap gap-1">{nd.keywords.map((k) => <span key={k} className="pill bg-accent-soft text-accent">{k}</span>)}</span> : null} miss="chỉ tìm KOC theo ngành của brand" />
          </dl>
        </Panel>
        <Panel title="Quy tắc lọc của brand" action={brand ? <Link href={`${brandLink}?rules=1`} className="btn h-8 px-3 text-xs">Sửa ở Danh mục</Link> : undefined}>
          <dl>
            <Row k="Ngành của brand" v={brand?.category ?? b.category} miss="không lọc theo ngành" />
            <Row k="Follower tối thiểu" v={kls.map((lv) => `${lv}: ${fmtNum(rules.kl[lv]!.followersMin)}`).join(' · ')} miss="không lọc theo follower, không suy được cấp KOC" />
            <Row k="Không book lại trong" v={`${rules.cooldownDays} ngày kể từ lần book trước cho brand này`} />
            <Row k="Bán hàng ngành tối thiểu" v={`${rules.industryGmvMin}% GMV của kênh`} />
          </dl>
        </Panel>
        <Panel title="Số liệu lấy từ đâu">
          <p className="text-[13px] text-ink-2">
            Follower, view, GMV, chân dung follower, video nổi bật: kho dữ liệu UpBase{wh ? ` (${fmtNum(wh.count)} creator, cập nhật ${fmtDate(wh.at)})` : ''}. Lịch sử book, giá đã book: booking trên Lark.
            Nội dung video (phốt, nói quá, đối thủ) kho chưa có: bạn xem kênh ở bước 3 (Kiểm tra nội dung). Giá và cam kết của KOC: bạn ghi ở bước 4 (Hỏi giá KOC).
          </p>
        </Panel>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Danh sách chung của bước 2–5
/** Một trang danh sách đầy đủ của đợt (không bỏ KOC nào), xếp theo trạng thái rồi điểm; lọc theo ID kênh, nguồn, trạng thái, lý do loại. */
async function listPage(b: Brief, sp: Search, page: number, exclude: Stage[] = []) {
  const conds: Prisma.Sql[] = [Prisma.sql`"briefId" = ${b.id}`];
  if (exclude.length && !sp.stage) conds.push(Prisma.sql`stage <> all(${exclude})`);
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
      order by ${RANK}, ${sp.sort === 'fit' ? Prisma.sql`(manual->'A3'->>'score')::int desc nulls last,` : Prisma.empty} total desc nulls last, (score->>'total')::float desc nulls last, handle
      limit ${PER} offset ${(page - 1) * PER}`,
    db.$queryRaw<{ n: number }[]>`select count(*)::int n from "MatchCandidate" where ${where}`,
  ]);
  const pos = new Map(ids.map((x, i) => [x.id, i]));
  const rows = (await db.matchCandidate.findMany({ where: { id: { in: ids.map((x) => x.id) } } })).sort((x, y) => pos.get(x.id)! - pos.get(y.id)!);
  return { rows, total: count[0]?.n ?? 0 };
}

const picked = (step: number, stage: string) => STEP_PICKED[step]?.includes(stage as Stage) ?? false;
/** KOC qua bước hoặc đang chờ thao tác ở bước: không làm mờ, nằm trên vạch. */
const active = (step: number, stage: string) => picked(step, stage) || (STEP_WORKING[step]?.includes(stage as Stage) ?? false);
const pickedCount = (step: number, n: Partial<Record<Stage, number>>) => STEP_PICKED[step].reduce((x, st) => x + (n[st] ?? 0), 0);
const allCount = (n: Partial<Record<Stage, number>>) => Object.values(n).reduce((x, y) => x + (y ?? 0), 0);

/** Dòng của bảng: KOC chưa qua bước này mờ đi và nằm dưới vạch. */
function rowsWithDivider(rows: MatchCandidate[], step: number, cols: number, render: (c: MatchCandidate, dim: string) => React.ReactNode) {
  const out: React.ReactNode[] = [];
  let divided = false;
  for (const c of rows) {
    const on = active(step, c.stage);
    if (!on && !divided) {
      divided = true;
      out.push(<tr key="divider"><td colSpan={cols} className="bg-sunken py-1.5 text-center text-xs text-ink-3">KOC dưới đây chưa tới bước này hoặc đã bị loại (vẫn giữ để xem lại, không bị xoá)</td></tr>);
    }
    out.push(render(c, on ? '' : 'opacity-60'));
  }
  return out;
}

/** Vì sao KOC không qua. */
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
      <b>{fmtNum(pickedCount(step, n))}</b> {label} <span className="text-ink-3">(trên tổng {fmtNum(allCount(n))} KOC của đợt)</span>
      <span className="ml-2 text-xs text-ink-3">{STAGE_ORDER.filter((st) => n[st]).map((st) => `${STAGES[st]} ${fmtNum(n[st])}`).join(' · ')}</span>
    </p>
  );
}

function Filters({ sp, step, codes }: { sp: Search; step: number; codes?: { code: string; n: number }[] }) {
  const sortable = step === 3 || step === 4 || step === 6;
  return (
    <form className="flex flex-wrap gap-2">
      <input type="hidden" name="step" value={step} />
      <input name="q" defaultValue={sp.q ?? ''} placeholder="Tìm @ID kênh" aria-label="Tìm ID kênh" className="input h-8 w-36 text-[13px]" />
      <select name="stage" defaultValue={sp.stage ?? ''} aria-label="Trạng thái" className="input h-8 w-40 text-[13px]">
        <option value="">Mọi trạng thái</option>
        {STAGE_ORDER.map((st) => <option key={st} value={st}>{STAGES[st]}</option>)}
      </select>
      <select name="src" defaultValue={sp.src ?? ''} aria-label="Nguồn" className="input h-8 w-52 text-[13px]">
        <option value="">Mọi nguồn</option><option value="danhba">Trong Danh bạ (Lark Base)</option><option value="kho">Ngoài Danh bạ (DWH Tech)</option>
      </select>
      {codes && codes.length > 0 && (
        <select name="code" defaultValue={sp.code ?? ''} aria-label="Lý do loại" className="input h-8 w-56 text-[13px]">
          <option value="">Mọi lý do loại</option>
          {codes.map((c) => <option key={c.code} value={c.code}>{koLabel(c.code)} ({c.n})</option>)}
        </select>
      )}
      {sortable && (
        <select name="sort" defaultValue={sp.sort ?? ''} aria-label="Sắp xếp" className="input h-8 w-60 text-[13px]">
          <option value="">Xếp theo điểm</option><option value="fit">Xếp theo Tone khớp brand</option>
        </select>
      )}
      <button className="btn h-8 px-3 text-xs">Lọc</button>
    </form>
  );
}

const Empty = ({ cols }: { cols: number }) => <tr><td colSpan={cols} className="py-10 text-center text-ink-3">Không có KOC nào.</td></tr>;
const ListCtx = ({ b, step, sp }: { b: Brief; step: number; sp: Search }) => (
  <><input type="hidden" name="briefId" value={b.id} /><input type="hidden" name="step" value={step} /><input type="hidden" name="page" value={sp.page ?? ''} /></>
);
/** Ô số liệu gọn: follower · view · GMV 30 ngày. */
function Nums({ d }: { d: CandData }) {
  const m = d.metrics;
  if (!m) return <span className="text-xs text-ink-3">Kho chưa có số liệu</span>;
  return (
    <div className="text-xs tabular-nums">
      <div>{fmtShort(m.followers)} follower · {fmtShort(m.medianViews)} view</div>
      <div className="text-ink-3">GMV {fmtShort(m.gmv)}{d.price ? ` · giá ~${fmtShort(d.price)}` : ''}</div>
    </div>
  );
}
const ChannelLink = ({ c }: { c: MatchCandidate }) => {
  const url = channelUrl(c.platform, c.handle);
  return url ? <a href={url} target="_blank" rel="noreferrer" className="link text-xs">Mở kênh ↗</a> : null;
};

async function slotFill(b: Brief, stages: Stage[]) {
  const rows = await db.matchCandidate.groupBy({ by: ['kl'], where: { briefId: b.id, stage: { in: stages } }, _count: true });
  const has = new Map(rows.map((r) => [r.kl ?? '?', r._count]));
  return { slots: parseSlots(b.slots), has };
}
function Slots({ fill, label }: { fill: Awaited<ReturnType<typeof slotFill>>; label: string }) {
  if (!fill.slots.length) return <p className="text-xs text-ink-3">Đợt chưa ghi cần bao nhiêu KOC mỗi cấp.</p>;
  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {fill.slots.map((s) => {
        const got = fill.has.get(s.kl) ?? 0;
        return <span key={s.kl} className={`pill ${got >= s.count ? 'bg-positive-soft text-positive' : 'bg-sunken text-ink-2'}`}>{s.kl}{s.role ? ` ${s.role}` : ''}: {label} {got}/{s.count}</span>;
      })}
    </div>
  );
}

/** Đếm KOC theo lý do loại (hệ thống loại, không khớp yêu cầu, B2C loại). */
const reasons = (briefId: string) => db.$queryRaw<{ code: string; n: number }[]>`
  select code, count(*)::int n from (
    select k->>'code' code from "MatchCandidate" c, jsonb_array_elements(c.knockouts) k where c."briefId" = ${briefId} and c.stage = 'KO'
    union all select 'POOL' from "MatchCandidate" where "briefId" = ${briefId} and stage = 'OUT'
    union all select "rejectCode" from "MatchCandidate" where "briefId" = ${briefId} and stage = 'REJECTED' and "rejectCode" is not null
  ) x group by 1 order by 2 desc`;
const canKeepFor = (b: Brief, me: Ctx['me']) => can(me, 'match.approve') || parseRules(b.brandRef?.rules).exceptionApprover === me.id;
/** Nguồn KOC: Danh bạ (lấy từ Lark Base) hay ngoài Danh bạ (DWH của Tech). */
const Source = ({ c }: { c: MatchCandidate }) => c.kocId
  ? <span className="pill bg-accent-soft text-accent" title="KOC trong Danh bạ, lấy từ Lark Base">Danh bạ · Lark Base</span>
  : <span className="pill bg-sunken text-ink-2" title="KOC ngoài Danh bạ, lấy từ DWH của Tech">Ngoài Danh bạ · DWH Tech</span>;

// ---------------------------------------------------------------- Bước 2. Tìm & Lọc KOC
async function FindFilter({ b, me, n, page, pop, listParams, sp }: Ctx) {
  if (!b.ranAt) return <><Todo briefId={b.id} step={2} /><NotRun /></>;
  const [{ rows, total }, byCode, src] = await Promise.all([
    listPage(b, sp, page), reasons(b.id),
    db.$queryRaw<{ ours: number; dwh: number }[]>`select count(*) filter (where "kocId" is not null)::int ours, count(*) filter (where "kocId" is null)::int dwh from "MatchCandidate" where "briefId" = ${b.id}`,
  ]);
  const canKeep = canKeepFor(b, me);
  return (
    <>
      <Todo briefId={b.id} step={2} />
      <Panel title="KOC hệ thống tìm và lọc" action={<Filters sp={sp} step={2} codes={byCode} />}>
        <Summary step={2} n={n} label="KOC còn lại sau khi lọc" />
        <p className="mb-2 text-xs text-ink-3">
          Nguồn KOC: <b>Trong Danh bạ</b> là KOC lấy từ Lark Base ({fmtNum(src[0]?.ours ?? 0)}); <b>Ngoài Danh bạ</b> là KOC lấy từ DWH của Tech ({fmtNum(src[0]?.dwh ?? 0)}).
          Thiếu số liệu thì hệ thống không loại, chỉ ghi chú. {canKeep ? 'KOC bị loại sai: bấm "Giữ lại".' : 'KOC bị loại sai: nhờ Lead bấm "Giữ lại".'}
        </p>
        {byCode.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {byCode.map((c) => <Link key={c.code} href={`?step=2&code=${c.code}`} className={`pill ${sp.code === c.code ? 'bg-accent text-surface' : 'bg-critical-soft text-critical'}`} title={KO[c.code as keyof typeof KO]?.rule}>{koLabel(c.code)}: {fmtNum(c.n)}</Link>)}
            {sp.code && <Link href="?step=2" className="pill bg-sunken text-ink-2">Bỏ lọc</Link>}
          </div>
        )}
        <form action={restoreCandidate}>
          <input type="hidden" name="step" value={2} /><input type="hidden" name="page" value={sp.page ?? ''} />
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>KOC</th><th>Nguồn</th><th>Số liệu 30 ngày</th><th className="text-center">Điểm</th><th>Trạng thái · lý do</th><th /></tr></thead>
              <tbody>
                {rowsWithDivider(rows, 2, 6, (c, dim) => {
                  const { d, s, flags } = sd(c);
                  const st = c.stage as Stage;
                  return (
                    <tr key={c.id} className={`align-top ${dim}`}>
                      <td><KocCell href={pop(c.id, 'detail')} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                      <td><Source c={c} /></td>
                      <td><Nums d={d} /></td>
                      <td className="text-center"><Total score={s} /></td>
                      <td className="max-w-80"><StageChip stage={st} />{c.exception && <div className="text-xs text-warning">Được giữ lại: {c.exception}</div>}<div className="mt-0.5">{['KO', 'OUT', 'REJECTED'].includes(st) ? <Why c={c} /> : <Findings list={flags.filter((f) => f.code !== 'POOL').slice(0, 2)} hideInternal />}</div></td>
                      <td>
                        <Act>
                          {(st === 'KO' || st === 'OUT') && canKeep && <Link href={pop(c.id, 'keep')} scroll={false} className={sm}>Giữ lại</Link>}
                          {st === 'REJECTED' && <button name="one" value={c.id} className={sm}>Khôi phục</button>}
                          <Link href={pop(c.id, 'detail')} scroll={false} className="link text-xs">Xem chi tiết</Link>
                        </Act>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && <Empty cols={6} />}
              </tbody>
            </table>
          </div>
        </form>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 3. Kiểm tra nội dung: Chọn / Loại / Xem chi tiết
async function ContentCheck({ b, n, page, pop, listParams, sp, ai }: Ctx) {
  if (!b.ranAt) return <><Todo briefId={b.id} step={3} /><NotRun /></>;
  const codes = contentChecksFor(b);
  // KOC đã chọn gom thành khung gọn trên cùng; bảng chính bắt đầu ngay bằng KOC đang xét cần kiểm (không bỏ KOC nào).
  const chosen: Stage[] = ['APPROVED', 'CONFIRMED', 'SHORTLIST'];
  const [{ rows, total }, fill, aiDone, picked] = await Promise.all([
    listPage(b, sp, page, chosen), slotFill(b, chosen),
    db.$queryRaw<{ n: number }[]>`select count(*)::int n from "MatchCandidate" where "briefId" = ${b.id} and manual->'A3'->>'by' = 'AI'`,
    sp.stage ? [] : db.matchCandidate.findMany({ where: { briefId: b.id, stage: { in: chosen } }, orderBy: [{ total: { sort: 'desc', nulls: 'last' } }], take: 300 }),
  ]);
  const need = fill.slots.reduce((s, x) => s + x.count, 0);
  const pool = n.POOL ?? 0;
  return (
    <>
      <Todo briefId={b.id} step={3}>
        {ai && (
          <ActionForm action={aiScoreFit} pendingText="AI đang xem video và sản phẩm của từng KOC, khoảng 30–60 giây…" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="briefId" value={b.id} />
            <label><span className="label">AI gợi ý Tone khớp brand cho top</span><input name="top" inputMode="numeric" defaultValue={100} className="input h-8 w-20" /></label>
            <button className="btn h-8 px-3 text-xs">AI gợi ý Tone</button>
            <span className="text-xs text-ink-3">{aiDone[0]?.n ? `Đã gợi ý ${fmtNum(aiDone[0].n)} KOC.` : ''}</span>
          </ActionForm>
        )}
        <form action={pick} className="flex items-end gap-2">
          <ListCtx b={b} step={3} sp={sp} />
          <label><span className="label">Chọn nhanh top theo điểm</span><input name="top" inputMode="numeric" defaultValue={need ? need * 2 : 20} className="input h-8 w-20" /></label>
          <button className="btn h-8 px-3 text-xs">Chọn top này</button>
        </form>
      </Todo>
      <Panel title="Kiểm tra nội dung kênh" action={<Filters sp={sp} step={3} />}>
        <Summary step={3} n={n} label="KOC đã chọn" />
        <div className="mb-2"><Slots fill={fill} label="đã chọn" /></div>
        <p className="mb-3 text-xs text-ink-3">
          {fmtNum(pool)} KOC đang xét, xếp theo điểm. Mở kênh, xem video gần đây và để ý: {codes.map((k) => KO[k].label.toLowerCase()).join(', ')}.
          {' '}Không có vấn đề: <b>Chọn</b>. Có vấn đề: <b>Loại</b> (bắt buộc nhập lý do).
        </p>
        <form action={pick}>
          <ListCtx b={b} step={3} sp={sp} />
          {picked.length > 0 && (
            <details open={picked.length <= 8} className="mb-3 rounded-md border border-positive/40 bg-positive-soft/30 px-3 py-2">
              <summary className="cursor-pointer text-[13px] font-medium">Đã chọn {picked.length} KOC (sang bước Hỏi giá) · bấm để {picked.length <= 8 ? 'thu gọn' : 'xem'}</summary>
              <ul className="mt-2 divide-y divide-line text-[13px]">
                {picked.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span className="flex items-center gap-2"><Link href={pop(c.id, 'detail')} scroll={false} className="font-medium hover:underline">{(c.data as CandData | null)?.name ?? c.handle}</Link><span className="text-xs text-ink-3">@{c.handle}</span><StageChip stage={c.stage} /></span>
                    <span className="flex items-center gap-3"><Total score={sd(c).s} />{c.stage === 'SHORTLIST' && <button formAction={unshortlist} name="one" value={c.id} className="link text-xs">Bỏ chọn</button>}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {pool > 0 && <div className="mb-2 flex flex-wrap items-center justify-end gap-2"><span className="text-xs text-ink-3">Tick nhiều KOC rồi chọn một lần:</span><button className="btn btn-primary h-8 px-3 text-xs">Chọn KOC đã tick</button></div>}
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th className="w-8" /><th>KOC</th><th>Video nổi bật</th><th className="text-center">Điểm</th><th>Tone (AI gợi ý)</th><th>Hệ thống gợi ý</th><th /></tr></thead>
              <tbody>
                {rowsWithDivider(rows, 3, 7, (c, dim) => {
                  const { d, s, flags } = sd(c);
                  const st = c.stage as Stage;
                  const hints = flags.filter((f) => (codes as readonly string[]).includes(f.code));
                  return (
                    <tr key={c.id} className={`align-top ${dim}`}>
                      <td>{st === 'POOL' && <input type="checkbox" name="cid" value={c.id} aria-label={`Tick @${c.handle}`} />}</td>
                      <td><KocCell href={pop(c.id, 'detail')} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /><ChannelLink c={c} /></td>
                      <td className="max-w-64 text-xs">
                        {(d.metrics?.topVideos ?? []).slice(0, 2).map((v, i) => <div key={i} className="truncate">{v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="link">{v.title || 'Video'}</a> : v.title}</div>)}
                        {!d.metrics?.topVideos?.length && <span className="text-ink-3">—</span>}
                      </td>
                      <td className="text-center"><Total score={s} /><div className="mt-0.5"><TierChip score={s} /></div></td>
                      <td><FitCell manual={c.manual} /></td>
                      <td className="max-w-64">{['KO', 'OUT', 'REJECTED'].includes(st) ? <Why c={c} /> : <Findings list={hints} empty="Không thấy gì bất thường" />}</td>
                      <td>
                        <Act>
                          {st === 'POOL' && <>
                            <button name="one" value={c.id} className={`${sm} btn-primary`}>Chọn</button>
                            <Link href={pop(c.id, 'reject')} scroll={false} className={sm}>Loại</Link>
                          </>}
                          {st === 'SHORTLIST' && <><StageChip stage={st} /><button formAction={unshortlist} name="one" value={c.id} className="link text-xs">Bỏ chọn</button></>}
                          {(st === 'CONFIRMED' || st === 'APPROVED') && <StageChip stage={st} />}
                          {st === 'REJECTED' && <button formAction={restoreCandidate} name="one" value={c.id} className={sm}>Khôi phục</button>}
                          <Link href={pop(c.id, 'detail')} scroll={false} className="link text-xs">Xem chi tiết</Link>
                        </Act>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && <Empty cols={7} />}
              </tbody>
            </table>
          </div>
        </form>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 4. Hỏi giá KOC
async function Quote({ b, n, page, pop, listParams, sp }: Ctx) {
  if (!b.ranAt) return <><Todo briefId={b.id} step={4} /><NotRun /></>;
  const { rows, total } = await listPage(b, sp, page);
  const yn = (v: boolean | undefined) => (v === undefined ? <span className="text-ink-3">chưa hỏi</span> : v ? 'Có' : <span className="text-critical">Không</span>);
  return (
    <>
      <Todo briefId={b.id} step={4} />
      <Panel title="Hỏi giá KOC" action={<Filters sp={sp} step={4} />}>
        <Summary step={4} n={n} label="KOC đã báo giá" />
        <p className="mb-3 text-xs text-ink-3">Bấm <b>Nhập giá</b> để ghi giá KOC báo và cam kết. Có giá và cam kết không đăng đối thủ{b.gmvMax ? ', cho chạy ads' : ''} thì KOC tự chuyển "Đã báo giá".</p>
        <form action={unshortlist}>
          <input type="hidden" name="step" value={4} /><input type="hidden" name="page" value={sp.page ?? ''} />
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>KOC</th><th className="text-right">Giá tham khảo</th><th className="text-right">Giá KOC báo</th><th>Cam kết</th><th className="text-center">Điểm</th><th /></tr></thead>
              <tbody>
                {rowsWithDivider(rows, 4, 6, (c, dim) => {
                  const { d, s } = sd(c);
                  const dc = (c.declare ?? {}) as Declare;
                  const st = c.stage as Stage;
                  const on = st === 'SHORTLIST' || st === 'CONFIRMED';
                  return (
                    <tr key={c.id} className={`align-top ${dim}`}>
                      <td><KocCell href={pop(c.id, 'detail')} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /><div className="mt-0.5"><StageChip stage={st} /></div></td>
                      <td className="text-right text-xs tabular-nums">{d.priceSource === 'Giá KOC báo' ? '—' : fmtShort(d.price)}{d.priceSource && d.priceSource !== 'Giá KOC báo' && <div className="text-ink-3">{d.priceSource}</div>}</td>
                      <td className="text-right tabular-nums">{dc.quote ? fmtVnd(dc.quote) : <span className="text-ink-3">—</span>}{b.feeCap && dc.quote && dc.quote > b.feeCap ? <div className="text-xs text-critical">Vượt phí tối đa</div> : null}</td>
                      <td className="text-xs">{on || st === 'APPROVED' ? <><div>Không đăng đối thủ: {yn(dc.noCompetitor)}</div><div>Cho chạy ads: {yn(dc.adsCode)}</div></> : null}</td>
                      <td className="text-center"><Total score={s} /></td>
                      <td>
                        <Act>
                          {on && c.kocId && <Link href={`/contacts/${c.kocId}`} target="_blank" className="link text-xs">Liên hệ ↗</Link>}
                          {on && <Link href={pop(c.id, 'price')} scroll={false} className={`${sm} ${dc.quote ? '' : 'btn-primary'}`}>{dc.quote ? 'Sửa giá' : 'Nhập giá'}</Link>}
                          {st === 'SHORTLIST' && <button name="one" value={c.id} className="link text-xs">Bỏ chọn</button>}
                          {!on && <Link href={pop(c.id, 'detail')} scroll={false} className="link text-xs">Xem chi tiết</Link>}
                        </Act>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && <Empty cols={6} />}
              </tbody>
            </table>
          </div>
        </form>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 5. Chấm điểm: KOC đủ dữ liệu / chưa đủ dữ liệu
/** Tiêu chí công thức thiếu số liệu (điểm lưu trước khi có cờ gap thì suy từ tiêu chí auto chưa có điểm). */
const gapsOf = (s: ScoreResult | null) => (s?.groups ?? []).flatMap((g) => g.parts).filter((p) => (p.gap ?? (criterion(p.id)?.auto && p.score == null)) && !p.manual);
function ToneCell({ manual }: { manual: unknown }) {
  const a3 = ((manual ?? {}) as Record<string, { score: number; by?: string }>).A3;
  if (hasRequired(manual)) return <b className="tabular-nums">{a3!.score}/5</b>;
  return <span className="text-xs font-medium text-critical">Chưa chấm{a3?.by === 'AI' ? ` · AI gợi ý ${a3.score}/5` : ''}</span>;
}
async function Scoring({ b, pop }: Ctx) {
  if (!b.ranAt) return <><Todo briefId={b.id} step={5} /><NotRun /></>;
  const rows = await db.matchCandidate.findMany({ where: { briefId: b.id, stage: { in: ['SHORTLIST', 'CONFIRMED', 'APPROVED'] } }, orderBy: [{ total: { sort: 'desc', nulls: 'last' } }], take: 500 });
  const full = rows.filter((c) => !gapsOf(sd(c).s).length);
  const partial = rows.filter((c) => gapsOf(sd(c).s).length);
  const head = <tr><th>KOC</th><th className="text-center">Điểm</th><th>Đánh giá</th><th>Tone khớp brand</th><th>{'Ô cần điền'}</th><th /></tr>;
  const row = (c: MatchCandidate, gaps: boolean) => {
    const { d, s } = sd(c);
    const miss = gapsOf(s);
    const tone = hasRequired(c.manual);
    return (
      <tr key={c.id} className="align-top">
        <td><KocCell href={pop(c.id, 'detail')} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /><div className="mt-0.5"><StageChip stage={c.stage} /></div></td>
        <td className="text-center"><Total score={s} /></td>
        <td><TierChip score={s} /></td>
        <td><ToneCell manual={c.manual} /></td>
        <td className="max-w-72 text-xs">{gaps ? <span className="text-critical">{miss.map((p) => p.label).join(', ')}</span> : <span className="text-ink-3">Hệ thống tự tính đủ</span>}</td>
        <td><Act><Link href={pop(c.id, 'score')} scroll={false} className={`${sm} ${gaps || !tone ? 'btn-primary' : ''}`}>{gaps ? 'Điền bổ sung' : tone ? 'Xem điểm' : 'Chấm Tone'}</Link></Act></td>
      </tr>
    );
  };
  return (
    <>
      <Todo briefId={b.id} step={5} />
      {!rows.length && <p className="rounded-lg border border-dashed border-line bg-surface px-5 py-10 text-center text-ink-3">Chưa có KOC nào được chọn. Chọn KOC ở bước 3 trước.</p>}
      {rows.length > 0 && <>
        <Panel title={<>KOC đủ dữ liệu <span className="text-[13px] font-normal text-ink-3">· hệ thống tự tính điểm · {full.length} KOC</span></>}>
          <p className="mb-2 text-xs text-ink-3">B2C chỉ cần chấm <b className="text-critical">Tone khớp brand</b> (bắt buộc). Các mục cảm nhận khác bỏ trống thì tính 3 điểm.</p>
          <div className="overflow-x-auto"><table className="tbl"><thead>{head}</thead><tbody>{full.map((c) => row(c, false))}{!full.length && <Empty cols={6} />}</tbody></table></div>
        </Panel>
        <Panel title={<>KOC chưa đủ dữ liệu <span className="text-[13px] font-normal text-ink-3">· B2C điền bổ sung theo cảm nhận · {partial.length} KOC</span></>}>
          <p className="mb-2 text-xs text-ink-3">Ô màu đỏ là mục kho chưa có số liệu: bấm <b>Điền bổ sung</b> và chấm 1–5 theo cảm nhận. Điền đủ thì hệ thống tính điểm theo điểm B2C; ô bỏ trống tính 3 điểm, riêng Tone khớp brand bắt buộc.</p>
          <div className="overflow-x-auto"><table className="tbl"><thead>{head}</thead><tbody>{partial.map((c) => row(c, true))}{!partial.length && <Empty cols={6} />}</tbody></table></div>
        </Panel>
      </>}
    </>
  );
}

// ---------------------------------------------------------------- Bước 6. Lead B2C duyệt + đẩy sang Listing
async function Approve({ b, me, n, page, pop, listParams, sp }: Ctx) {
  const [{ rows, total }, fill, quoted, batches] = await Promise.all([
    listPage(b, sp, page), slotFill(b, ['APPROVED']),
    db.matchCandidate.findMany({ where: { briefId: b.id, stage: { in: ['CONFIRMED', 'APPROVED'] } }, select: { stage: true, declare: true, data: true, manual: true } }),
    db.listingBatch.findMany({ where: { OR: [{ briefId: b.id }, ...(b.brand ? [{ brand: b.brand, briefId: null, NOT: { id: { startsWith: 'lark-' } } }] : [])] }, orderBy: { updatedAt: 'desc' }, take: 20, select: { id: true, name: true, month: true, briefId: true, _count: { select: { items: true } } } }),
  ]);
  const approved = quoted.filter((c) => c.stage === 'APPROVED');
  const sum = (list: typeof quoted) => list.reduce((s, c) => s + (((c.declare ?? {}) as Declare).quote ?? 0), 0);
  const gmv = (list: typeof quoted) => list.reduce((s, c) => { const m = ((c.data ?? {}) as CandData).metrics; return s + (m?.medianViews && m.gpm ? (m.medianViews * m.gpm) / 1000 : 0); }, 0);
  const allowed = can(me, 'match.approve');
  const over = b.feeCap ? quoted.filter((c) => (((c.declare ?? {}) as Declare).quote ?? 0) > b.feeCap!).length : 0;
  const waiting = n.CONFIRMED ?? 0, approvedN = n.APPROVED ?? 0;
  const ready = quoted.filter((c) => c.stage === 'CONFIRMED' && hasRequired(c.manual)).length;
  const linked = batches.filter((x) => x.briefId === b.id);
  return (
    <>
      <Todo briefId={b.id} step={6} />
      <section className={`mb-4 rounded-lg border px-5 py-4 ${approvedN ? 'border-positive/40 bg-positive-soft/40' : 'border-line bg-surface'}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Đẩy KOC đã duyệt sang Listing</h2>
            <p className="text-[13px] text-ink-2">{approvedN ? `${approvedN} KOC đã duyệt, sẵn sàng đẩy sang Listing để gửi brand chọn.` : 'Chưa có KOC nào được duyệt. Lead duyệt ở bảng bên dưới trước.'}</p>
            {linked.length > 0 && <p className="mt-1 text-[13px]">Đã đẩy sang: {linked.map((x, i) => <span key={x.id}>{i > 0 && ', '}<Link href={`/listing/${x.id}`} className="link">{x.name}</Link> ({x._count.items} KOC)</span>)}</p>}
          </div>
          {can(me, 'data.export') && approvedN > 0 && <div className="flex flex-wrap gap-2"><a href={`/matching/${b.id}/export`} className="btn h-8 px-3 text-xs">Tải Excel gửi brand</a><a href={`/matching/${b.id}/export?all=1`} className="btn h-8 px-3 text-xs">Tải Excel nội bộ</a></div>}
        </div>
        {approvedN > 0 && (
          <form action={toListing} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="briefId" value={b.id} />
            <label className="min-w-56 flex-1">
              <span className="label">Đưa vào đợt listing</span>
              <select name="batchId" defaultValue={linked[0]?.id ?? 'new'} className="input">
                <option value="new">+ Tạo đợt listing mới</option>
                {batches.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.month}</option>)}
              </select>
            </label>
            <label className="min-w-56 flex-1"><span className="label">Tên đợt mới (khi tạo mới)</span><input name="name" defaultValue={b.name} className="input" /></label>
            <button className="btn btn-primary">Đẩy {approvedN} KOC sang Listing</button>
          </form>
        )}
      </section>
      <Panel title="Tổng quan trước khi duyệt">
        <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-ink-3">Số KOC đã duyệt theo cấp</dt><dd className="mt-1"><Slots fill={fill} label="đã duyệt" /></dd></div>
          <div><dt className="text-xs text-ink-3">Chi phí đã duyệt / ngân sách</dt><dd className="font-semibold">{fmtVndShort(sum(approved))} / {b.budget ? fmtVndShort(b.budget) : '—'}</dd><dd className="text-xs text-ink-3">Gồm thuế TNCN ~{fmtVndShort(sum(approved) / FEE_DIVISOR)} · chờ duyệt {fmtVndShort(sum(quoted) - sum(approved))}</dd></div>
          <div><dt className="text-xs text-ink-3">GMV dự kiến / mục tiêu</dt><dd className="font-semibold">{fmtVndShort(gmv(approved))} / {b.gmvTarget ? fmtVndShort(b.gmvTarget) : '—'}</dd><dd className="text-xs text-ink-3">Ước tính từ view và GMV / 1.000 view của từng KOC</dd></div>
          <div><dt className="text-xs text-ink-3">KOC báo giá vượt phí tối đa</dt><dd className={`font-semibold ${over ? 'text-critical' : ''}`}>{b.feeCap ? over : '—'}</dd></div>
        </dl>
      </Panel>
      <Panel title={<>Lead B2C duyệt KOC <span className="text-[13px] font-normal text-ink-3">· {waiting} chờ duyệt · {approvedN} đã duyệt</span></>} action={<Filters sp={sp} step={6} />}>
        {!allowed && <p className="mb-2 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning">Bạn chỉ xem được. Duyệt cần quyền "Duyệt list KOC" (Lead B2C).</p>}
        {!waiting && !approvedN && <p className="mb-2 rounded-md bg-sunken px-3 py-2 text-[13px] text-ink-2">Chưa có KOC nào chờ duyệt. KOC có giá (bước 4) sẽ hiện ở đây.</p>}
        <form action={approve}>
          <input type="hidden" name="briefId" value={b.id} />
          {allowed && waiting > 0 && (
            <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
              {ready < waiting && <span className="text-xs text-critical">{waiting - ready} KOC chưa chấm Tone khớp brand: chưa duyệt được.</span>}
              <button name="action" value="all" disabled={!ready} className="btn btn-primary h-8 px-3 text-xs">Duyệt toàn bộ ({ready} KOC)</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>KOC</th><th className="text-right">Giá KOC báo</th><th className="text-center">Điểm</th><th>Tone khớp brand</th><th>Đánh giá</th><th /></tr></thead>
              <tbody>
                {rowsWithDivider(rows, 6, 6, (c, dim) => {
                  const { d, s } = sd(c);
                  const st = c.stage as Stage;
                  const tone = hasRequired(c.manual);
                  return (
                    <tr key={c.id} className={`align-top ${dim}`}>
                      <td><KocCell href={pop(c.id, 'detail')} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /><div className="mt-0.5"><StageChip stage={st} /></div></td>
                      <td className="text-right tabular-nums">{fmtVnd(((c.declare ?? {}) as Declare).quote)}</td>
                      <td className="text-center"><Total score={s} /></td>
                      <td>{st === 'CONFIRMED' || st === 'APPROVED' ? <ToneCell manual={c.manual} /> : null}</td>
                      <td className="max-w-60 text-xs">{st === 'CONFIRMED' || st === 'APPROVED' ? <><TierChip score={s} /><div className="mt-0.5 text-ink-3">{s?.action}</div></> : <Why c={c} />}</td>
                      <td>
                        <Act>
                          {allowed && st === 'CONFIRMED' && <>
                            {tone
                              ? <button name="row" value={`approve|${c.id}`} className={`${sm} btn-primary`}>Duyệt</button>
                              : <Link href={pop(c.id, 'score')} scroll={false} className={sm} title="Cần chấm Tone khớp brand trước khi duyệt">Chấm Tone</Link>}
                            <Link href={pop(c.id, 'reject')} scroll={false} className={sm}>Loại</Link>
                          </>}
                          {allowed && st === 'APPROVED' && <button name="row" value={`return|${c.id}`} className="link text-xs">Bỏ duyệt</button>}
                          <Link href={pop(c.id, 'detail')} scroll={false} className="link text-xs">Xem chi tiết</Link>
                        </Act>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && <Empty cols={6} />}
              </tbody>
            </table>
          </div>
        </form>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 7. Sau khi air
async function AfterAir({ b, n, page, pop, listParams, sp }: Ctx) {
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
    <>
      <Todo briefId={b.id} step={7} />
      <Panel title="Kết quả sau khi air" action={<Filters sp={sp} step={7} />}>
        <Summary step={7} n={n} label="KOC đã book" />
        <p className="mb-2 text-xs text-ink-3">View, GMV lấy từ booking trên Lark cùng brand (từ tháng air). Kết quả bạn ghi giúp lần tìm KOC sau chấm chính xác hơn: "Vào KOC core" gắn nhãn ở Danh bạ, "Dừng hợp tác" ghi KOC không hợp brand này.</p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>KOC</th><th>Job / booking</th><th className="text-right">View 30 ngày</th><th className="text-right">GMV mỗi video</th><th className="text-right">Chi phí / view</th><th className="text-right">GMV / chi phí</th><th>Kết quả</th><th /></tr></thead>
            <tbody>
              {rowsWithDivider(rows, 7, 8, (c, dim) => {
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
                    <td><KocCell href={pop(c.id, 'detail')} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                    <td className="text-xs">
                      {js.map((j) => <div key={j.number}><Link href={`/jobs?q=${j.number}`} className="link">Job #{j.number}</Link> · {j.stage}{j.reviewResult ? ` · ${j.reviewResult}` : ''}</div>)}
                      {bs.map((x) => <div key={x.code}>{x.code} · air {fmtDate(x.airDate)}</div>)}
                      {on && !js.length && !bs.length && <span className="text-ink-3">Chưa có</span>}
                      {!on && <StageChip stage={c.stage} />}
                    </td>
                    <td className="text-right tabular-nums">{views ? fmtShort(views) : '—'}</td>
                    <td className="text-right tabular-nums">{bs.length && gmv ? fmtVndShort(gmv / bs.length) : '—'}</td>
                    <td className="text-right tabular-nums">{views && cost ? fmtVnd(cost / views) : '—'}</td>
                    <td className="text-right tabular-nums">{cost && gmv ? `${(gmv / cost).toFixed(2).replace('.', ',')} lần` : '—'}</td>
                    <td className="text-xs">{o ? <>{o.decision ? <b>{DECISIONS[o.decision]}</b> : 'Đã ghi'}{o.kpiMet != null && ` · KPI ${o.kpiMet ? 'đạt' : 'không đạt'}`}</> : on ? <span className="text-ink-3">Chưa ghi</span> : null}</td>
                    <td className="text-right">{on && <Link href={pop(c.id, 'outcome')} scroll={false} className="btn btn-primary h-7 px-2 text-xs">Ghi kết quả</Link>}</td>
                  </tr>
                );
              })}
              {!rows.length && <Empty cols={8} />}
            </tbody>
          </table>
        </div>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}
