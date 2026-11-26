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
import { checksDone, contentChecksFor } from '@/lib/matching/run';
import {
  DECISIONS, KL_LEVELS, KO, koLabel, OBJECTIVE_LABEL, parseNeeds, parseRules, parseSlots, STAGE_ORDER, STAGES, STEP_PICKED, STEP_WORKING,
  type Check, type Declare, type Outcome, type Stage,
} from '@/lib/matching/spec';
import { warehouseStatus } from '@/lib/warehouse/creatorSync';
import { can, requireUser } from '@/lib/auth/session';
import { aiScoreFit, approve, deleteBrief, keepException, restoreCandidate, runNow, saveChecks, shortlist, toListing, unshortlist } from '../actions';
import { AiBriefBox, BriefForm } from '../BriefForm';
import { channelUrl, currentStep, Findings, FitCell, KocCell, StageChip, Stepper, TierChip, Todo, Total, type CandData } from '../parts';
import { CandidateDialog } from './CandidateDialog';

type Search = { step?: string; c?: string; page?: string; q?: string; src?: string; code?: string; stage?: string; sort?: string; msg?: string; err?: string; edit?: string };
const PER = 50;
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
  const step = Math.min(10, Math.max(1, Number(sp.step) || currentStep(b, n)));
  // Số trên từng bước = số KOC qua bước đó; danh sách của bước vẫn hiện đủ mọi KOC.
  const stepCounts: Record<number, number | undefined> = b.ranAt
    ? Object.fromEntries(Object.entries(STEP_PICKED).map(([k, st]) => [k, st.reduce((x, y) => x + (n[y] ?? 0), 0)]))
    : {};
  const page = pageOf(sp.page);
  const filters = Object.entries({ q: sp.q, src: sp.src, code: sp.code, stage: sp.stage, sort: sp.sort }).filter(([, v]) => v) as [string, string][];
  const base = `/matching/${id}?${new URLSearchParams([['step', String(step)], ...(sp.page ? [['page', sp.page]] : []), ...filters])}`;
  const open = (cid: string) => `${base}&c=${cid}`;
  const listParams = new URLSearchParams([['step', String(step)], ...filters]);
  const [brands, ai] = await Promise.all([
    sp.edit ? db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, products: { select: { id: true, name: true, sku: true }, orderBy: { name: 'asc' } } } }) : [],
    aiOn(),
  ]);
  const ctx = { b, me, n, step, page, base, open, listParams, sp, ai };

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
          <form action={runNow}><input type="hidden" name="id" value={id} /><button className="btn btn-primary" title="Tìm và lọc KOC theo yêu cầu. Những gì bạn đã làm (đã chọn, đã báo giá…) được giữ nguyên.">{b.ranAt ? 'Tìm lại KOC' : 'Tìm KOC'}</button></form>
        </div>
      </div>
      <Stepper briefId={id} step={step} counts={stepCounts} />
      {(sp.msg || sp.err) && <p role="status" className={`mb-3 rounded-md px-3 py-2 text-[13px] ${sp.err || sp.msg?.startsWith('Lỗi') ? 'bg-critical-soft text-critical' : 'bg-positive-soft text-positive'}`}>{sp.err ?? sp.msg}</p>}

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
type Ctx = { b: Brief; me: Awaited<ReturnType<typeof requireUser>>; n: Partial<Record<Stage, number>>; step: number; page: number; base: string; open: (cid: string) => string; listParams: URLSearchParams; sp: Search; ai: boolean };

const Panel = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
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

// ---------------------------------------------------------------- Bước 1. Nhập yêu cầu
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
            Nội dung video (phốt, nói quá, đối thủ) kho chưa có: bạn kiểm ở bước 4. Giá và cam kết của KOC: bạn ghi ở bước 6.
          </p>
        </Panel>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Danh sách chung của bước 2–10
/** Một trang danh sách đầy đủ của đợt (không bỏ KOC nào), xếp theo trạng thái rồi điểm; lọc theo ID kênh, nguồn, trạng thái, lý do loại. */
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
      out.push(<tr key="divider"><td colSpan={cols} className="bg-sunken py-1.5 text-center text-xs text-ink-3">Các KOC dưới đây đã bị loại hoặc chưa tới bước này (vẫn giữ để xem lại, không bị xoá)</td></tr>);
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
  const sortable = step >= 5 && step <= 8;
  return (
    <form className="flex flex-wrap gap-2">
      <input type="hidden" name="step" value={step} />
      <input name="q" defaultValue={sp.q ?? ''} placeholder="Tìm @ID kênh" aria-label="Tìm ID kênh" className="input h-8 w-36 text-[13px]" />
      <select name="stage" defaultValue={sp.stage ?? ''} aria-label="Trạng thái" className="input h-8 w-40 text-[13px]">
        <option value="">Mọi trạng thái</option>
        {STAGE_ORDER.map((st) => <option key={st} value={st}>{STAGES[st]}</option>)}
      </select>
      <select name="src" defaultValue={sp.src ?? ''} aria-label="Nguồn" className="input h-8 w-36 text-[13px]">
        <option value="">Mọi KOC</option><option value="danhba">Trong Danh bạ</option><option value="kho">Ngoài Danh bạ</option>
      </select>
      {codes && (
        <select name="code" defaultValue={sp.code ?? ''} aria-label="Lý do loại" className="input h-8 w-56 text-[13px]">
          <option value="">Mọi lý do</option>
          {codes.map((c) => <option key={c.code} value={c.code}>{koLabel(c.code)} ({c.n})</option>)}
        </select>
      )}
      {sortable && (
        <select name="sort" defaultValue={sp.sort ?? ''} aria-label="Sắp xếp" className="input h-8 w-48 text-[13px]">
          <option value="">Xếp theo điểm</option><option value="fit">Xếp theo hợp nội dung (AI)</option>
        </select>
      )}
      <button className="btn h-8 px-3 text-xs">Lọc</button>
    </form>
  );
}

const hiddenCtx = (c: MatchCandidate, step: number, sp: Search) => (
  <><input type="hidden" name="cid" value={c.id} /><input type="hidden" name="step" value={step} /><input type="hidden" name="page" value={sp.page ?? ''} /></>
);
const Empty = ({ cols }: { cols: number }) => <tr><td colSpan={cols} className="py-10 text-center text-ink-3">Không có KOC nào.</td></tr>;

// ---------------------------------------------------------------- Bước 2. Tìm KOC
async function Pool({ b, n, page, open, listParams, sp }: Ctx) {
  if (!b.ranAt) return <><Todo briefId={b.id} step={2} /><NotRun /></>;
  const { rows, total } = await listPage(b, sp, page);
  return (
    <>
      <Todo briefId={b.id} step={2} />
      <Panel title="KOC hệ thống tìm được" action={<Filters sp={sp} step={2} />}>
        <Summary step={2} n={n} label="KOC khớp yêu cầu" />
        <p className="mb-2 text-xs text-ink-3">Gồm KOC trong Danh bạ và creator trong kho dữ liệu bán hàng đúng ngành, cộng creator có video khớp từ khoá của đợt. KOC không khớp ngành / cấp KOC xếp cuối, vẫn xem được.</p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>KOC</th><th>Trạng thái</th><th className="text-right">Follower</th><th className="text-right">View trung bình</th><th className="text-right">GMV 30 ngày</th><th className="text-center">Điểm</th><th>Ghi chú</th></tr></thead>
            <tbody>
              {rowsWithDivider(rows, 2, 7, (c, dim) => {
                const { d, s } = sd(c);
                const m = d.metrics;
                return (
                  <tr key={c.id} className={`align-top ${dim}`}>
                    <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                    <td><StageChip stage={c.stage} /></td>
                    <td className="text-right tabular-nums">{fmtShort(m?.followers)}</td>
                    <td className="text-right tabular-nums">{fmtShort(m?.medianViews)}</td>
                    <td className="text-right tabular-nums">{fmtShort(m?.gmv)}</td>
                    <td className="text-center"><Total score={s} /></td>
                    <td className="max-w-72">{m ? <Why c={c} /> : <span className="text-xs text-ink-3">Kho chưa có số liệu</span>}</td>
                  </tr>
                );
              })}
              {!rows.length && <Empty cols={7} />}
            </tbody>
          </table>
        </div>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 3. Lọc tự động
async function DataKo({ b, me, n, page, open, listParams, sp }: Ctx) {
  if (!b.ranAt) return <><Todo briefId={b.id} step={3} /><NotRun /></>;
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
    <>
      <Todo briefId={b.id} step={3} />
      <Panel title="KOC bị loại và lý do" action={<Filters sp={sp} step={3} codes={byCode} />}>
        <Summary step={3} n={n} label="KOC còn lại sau khi lọc" />
        <div className="mb-3 flex flex-wrap gap-1.5">
          {byCode.map((c) => <Link key={c.code} href={`?step=3&code=${c.code}`} className={`pill ${sp.code === c.code ? 'bg-accent text-surface' : 'bg-critical-soft text-critical'}`} title={KO[c.code as keyof typeof KO]?.rule}>{koLabel(c.code)}: {fmtNum(c.n)}</Link>)}
          {sp.code && <Link href="?step=3" className="pill bg-sunken text-ink-2">Bỏ lọc</Link>}
        </div>
        <p className="mb-2 text-xs text-ink-3">Thiếu số liệu thì hệ thống không loại, chỉ cảnh báo. {canKeep ? 'Bạn có quyền giữ lại KOC bị loại: ghi lý do rồi bấm "Giữ lại".' : 'Muốn giữ lại KOC bị loại thì nhờ trưởng nhóm.'}</p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>KOC</th><th>Trạng thái</th><th>Lý do / cảnh báo</th><th className="text-right">Follower</th><th className="text-center">Điểm</th><th /></tr></thead>
            <tbody>
              {rowsWithDivider(rows, 3, 6, (c, dim) => {
                const { d, s, flags } = sd(c);
                return (
                  <tr key={c.id} className={`align-top ${dim}`}>
                    <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                    <td><StageChip stage={c.stage} />{c.exception && <div className="mt-0.5 text-xs text-warning">Được giữ lại</div>}</td>
                    <td className="max-w-xl"><Why c={c} />{picked(3, c.stage) && <Findings list={flags.filter((f) => f.code !== 'POOL')} hideInternal />}</td>
                    <td className="text-right tabular-nums">{fmtShort(d.metrics?.followers)}</td>
                    <td className="text-center"><Total score={s} /></td>
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
              {!rows.length && <Empty cols={6} />}
            </tbody>
          </table>
        </div>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 4. Kiểm tra nội dung
async function ContentKo({ b, n, page, open, listParams, sp }: Ctx) {
  if (!b.ranAt) return <><Todo briefId={b.id} step={4} /><NotRun /></>;
  const codes = contentChecksFor(b);
  const { rows, total } = await listPage(b, sp, page);
  return (
    <>
      <Todo briefId={b.id} step={4} />
      <Panel title="Kiểm tra nội dung kênh" action={<Filters sp={sp} step={4} />}>
        <Summary step={4} n={n} label="KOC đang được xét" />
        <div className="mb-3 rounded-md bg-sunken px-3 py-2 text-xs text-ink-2">
          Mở kênh, xem 20–30 video gần nhất và để ý: {codes.map((k) => KO[k].label.toLowerCase()).join(', ')}. Bắt đầu từ KOC điểm cao.
          {' '}Có vi phạm thì bấm "Kiểm chi tiết" và chọn "Có vi phạm" ở mục tương ứng: KOC chuyển sang "Đã loại".
        </div>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>KOC</th><th>Trạng thái</th><th>Video nổi bật</th><th>Hệ thống gợi ý</th><th className="text-center">Đã kiểm</th><th className="text-center">Điểm</th><th /></tr></thead>
            <tbody>
              {rowsWithDivider(rows, 4, 7, (c, dim) => {
                const { d, s, flags } = sd(c);
                const checks = (c.checks ?? {}) as Record<string, Check>;
                const hints = flags.filter((f) => (codes as readonly string[]).includes(f.code));
                const done = checksDone(checks, codes);
                const url = channelUrl(c.platform, c.handle);
                return (
                  <tr key={c.id} className={`align-top ${dim}`}>
                    <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} />{url && <a href={url} target="_blank" rel="noreferrer" className="link text-xs">Mở kênh ↗</a>}</td>
                    <td><StageChip stage={c.stage} /></td>
                    <td className="max-w-64 text-xs">
                      {(d.metrics?.topVideos ?? []).slice(0, 2).map((v, i) => <div key={i} className="truncate">{v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="link">{v.title || 'Video'}</a> : v.title}</div>)}
                      {!d.metrics?.topVideos?.length && <span className="text-ink-3">—</span>}
                    </td>
                    <td className="max-w-64">{picked(4, c.stage) ? <Findings list={hints} empty="Không thấy gì bất thường" /> : <Why c={c} />}</td>
                    <td className={`text-center text-xs ${done === codes.length ? 'text-positive' : 'text-ink-3'}`}>{done === codes.length ? 'Xong' : `${done}/${codes.length}`}</td>
                    <td className="text-center"><Total score={s} /></td>
                    <td className="whitespace-nowrap text-right">
                      {picked(4, c.stage) && done < codes.length && (
                        <form action={saveChecks} className="inline">{hiddenCtx(c, 4, sp)}<input type="hidden" name="all" value="1" />
                          <button className="btn h-7 px-2 text-xs" title="Đã xem kênh, không có vấn đề gì">Không vi phạm</button>
                        </form>
                      )}
                      <Link href={open(c.id)} scroll={false} className="btn ml-1 h-7 px-2 text-xs">Kiểm chi tiết</Link>
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <Empty cols={7} />}
            </tbody>
          </table>
        </div>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 5. Chọn KOC liên hệ
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

async function Shortlist({ b, n, page, open, listParams, sp, ai }: Ctx) {
  if (!b.ranAt) return <><Todo briefId={b.id} step={5} /><NotRun /></>;
  const codes = contentChecksFor(b);
  const [{ rows, total }, fill, aiDone] = await Promise.all([
    listPage(b, sp, page), slotFill(b, ['SHORTLIST', 'CONFIRMED', 'APPROVED']),
    db.$queryRaw<{ n: number }[]>`select count(*)::int n from "MatchCandidate" where "briefId" = ${b.id} and manual->'A3'->>'by' = 'AI'`,
  ]);
  const need = fill.slots.reduce((s, x) => s + x.count, 0);
  return (
    <>
      <Todo briefId={b.id} step={5}>
        {ai && (
          <ActionForm action={aiScoreFit} pendingText="AI đang đọc video và sản phẩm của từng KOC, khoảng 30–60 giây…" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="briefId" value={b.id} />
            <label><span className="label">AI chấm độ hợp nội dung cho top</span><input name="top" inputMode="numeric" defaultValue={100} className="input h-8 w-20" /></label>
            <button className="btn btn-primary h-8 px-3 text-xs">AI chấm độ hợp nội dung</button>
            <span className="text-xs text-ink-3">{aiDone[0]?.n ? `Đã chấm ${fmtNum(aiDone[0].n)} KOC. ` : ''}Chỉ chấm KOC chưa được chấm.</span>
          </ActionForm>
        )}
        <form action={shortlist} className="flex items-end gap-2">
          <input type="hidden" name="briefId" value={b.id} />
          <label><span className="label">Lấy nhanh top theo điểm</span><input name="top" inputMode="numeric" defaultValue={need ? need * 2 : 20} className="input h-8 w-20" /></label>
          <button className="btn h-8 px-3 text-xs">Chọn top này để liên hệ</button>
        </form>
      </Todo>
      <Panel title="Chọn KOC để liên hệ" action={<Filters sp={sp} step={5} />}>
        <Summary step={5} n={n} label="KOC đã chọn để liên hệ" />
        <div className="mb-2"><Slots fill={fill} label="đã chọn" /></div>
        <form action={shortlist}>
          <input type="hidden" name="briefId" value={b.id} />
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th className="w-8" /><th>KOC</th><th>Trạng thái</th><th className="text-center">Điểm</th><th>Đánh giá</th><th>Hợp nội dung</th><th className="text-center">Kiểm nội dung</th><th className="text-right">Giá tham khảo</th></tr></thead>
              <tbody>
                {rowsWithDivider(rows, 5, 8, (c, dim) => {
                  const { d, s } = sd(c);
                  const done = checksDone((c.checks ?? {}) as Record<string, Check>, codes);
                  return (
                    <tr key={c.id} className={`align-top ${dim}`}>
                      <td>{c.stage === 'POOL' && <input type="checkbox" name="cid" value={c.id} aria-label={`Chọn @${c.handle}`} />}</td>
                      <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                      <td><StageChip stage={c.stage} /></td>
                      <td className="text-center"><Total score={s} /></td>
                      <td><TierChip score={s} /></td>
                      <td><FitCell manual={c.manual} /></td>
                      <td className={`text-center text-xs ${done === codes.length ? 'text-positive' : 'text-warning'}`}>{done === codes.length ? 'Xong' : `${done}/${codes.length}`}</td>
                      <td className="text-right text-xs tabular-nums">{fmtShort(d.price)}{d.priceSource && <div className="text-ink-3">{d.priceSource}</div>}</td>
                    </tr>
                  );
                })}
                {!rows.length && <Empty cols={8} />}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex justify-end"><button className="btn btn-primary">Chọn KOC đã tick để liên hệ</button></div>
        </form>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 6. Hỏi giá KOC
async function Quotes({ b, n, page, open, listParams, sp }: Ctx) {
  const { rows, total } = await listPage(b, sp, page);
  const yn = (v: boolean | undefined) => (v === undefined ? '—' : v ? 'Có' : 'Không');
  return (
    <>
      <Todo briefId={b.id} step={6} />
      <Panel title="Hỏi giá KOC" action={<Filters sp={sp} step={6} />}>
        <Summary step={6} n={n} label="KOC đã báo giá" />
        <p className="mb-2 text-xs text-ink-3">KOC không cam kết không đăng đối thủ, không cho chạy ads code khi brand chạy GMV Max, hoặc thiếu chứng chỉ khi nội dung nói chuyên môn sẽ tự chuyển "Đã loại".</p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>KOC</th><th>Trạng thái</th><th className="text-right">Giá tham khảo</th><th className="text-right">Giá KOC báo</th><th>Cho chạy ads</th><th>Cam kết không đăng đối thủ</th>{b.expertClaim && <th>Chứng chỉ</th>}<th /></tr></thead>
            <tbody>
              {rowsWithDivider(rows, 6, 8, (c, dim) => {
                const { d } = sd(c);
                const dc = (c.declare ?? {}) as Declare;
                const active = c.stage === 'SHORTLIST' || c.stage === 'CONFIRMED';
                return (
                  <tr key={c.id} className={`align-top ${dim}`}>
                    <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                    <td><StageChip stage={c.stage} />{c.stage === 'SHORTLIST' && <div className="text-xs text-ink-3">{dc.declared ? 'Đang trao đổi' : 'Chưa liên hệ'}</div>}</td>
                    <td className="text-right text-xs tabular-nums">{d.priceSource === 'Giá KOC báo' ? '—' : fmtShort(d.price)}</td>
                    <td className="text-right tabular-nums">{dc.quote ? fmtVnd(dc.quote) : '—'}{b.feeCap && dc.quote && dc.quote > b.feeCap ? <div className="text-xs text-critical">Vượt phí tối đa</div> : null}</td>
                    <td className="text-xs">{yn(dc.adsCode)}{dc.adsDays ? ` · ${dc.adsDays} ngày` : ''}</td>
                    <td className="text-xs">{yn(dc.noCompetitor)}</td>
                    {b.expertClaim && <td className="text-xs">{dc.certificate ?? '—'}</td>}
                    <td className="whitespace-nowrap text-right">
                      {active && c.kocId && <Link href={`/contacts/${c.kocId}`} className="btn h-7 px-2 text-xs">Liên hệ</Link>}
                      <Link href={open(c.id)} scroll={false} className={`btn ml-1 h-7 px-2 text-xs ${active ? 'btn-primary' : ''}`}>{active ? 'Ghi giá' : 'Xem'}</Link>
                      {c.stage === 'SHORTLIST' && <form action={unshortlist} className="inline">{hiddenCtx(c, 6, sp)}<button className="link ml-2 text-xs">Bỏ chọn</button></form>}
                    </td>
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

// ---------------------------------------------------------------- Bước 7. Chấm điểm
async function FullScore({ b, n, page, open, listParams, sp }: Ctx) {
  const { rows, total } = await listPage(b, sp, page);
  return (
    <>
      <Todo briefId={b.id} step={7} />
      <Panel title="Chấm điểm" action={<Filters sp={sp} step={7} />}>
        <Summary step={7} n={n} label="KOC cần chấm (đang liên hệ trở đi)" />
        <p className="mb-2 text-xs text-ink-3">Hệ thống tự chấm phần có số liệu (follower, view, bán hàng, giá). Phần kho không có (chất lượng video, tone…) bạn chấm 1–5 trong "Chấm điểm". Điểm trên 100.</p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>KOC</th><th>Trạng thái</th><th className="text-center">Điểm</th><th>Đánh giá</th><th>Hợp nội dung</th><th>Còn thiếu</th><th /></tr></thead>
            <tbody>
              {rowsWithDivider(rows, 7, 7, (c, dim) => {
                const { d, s } = sd(c);
                const missing = (s?.groups ?? []).flatMap((g) => g.parts).filter((p) => p.score == null).length;
                return (
                  <tr key={c.id} className={`align-top ${dim}`}>
                    <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                    <td><StageChip stage={c.stage} /></td>
                    <td className="text-center"><Total score={s} /></td>
                    <td><TierChip score={s} /></td>
                    <td><FitCell manual={c.manual} /></td>
                    <td className="text-xs">{missing ? `${missing} mục` : <span className="text-positive">Đủ</span>}</td>
                    <td className="text-right"><Link href={`${open(c.id)}#manual`} scroll={false} className="btn h-7 px-2 text-xs">Chấm điểm</Link></td>
                  </tr>
                );
              })}
              {!rows.length && <Empty cols={7} />}
            </tbody>
          </table>
        </div>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 8. Trưởng nhóm duyệt
async function Approve({ b, me, n, page, open, listParams, sp }: Ctx) {
  const [{ rows, total }, fill, quoted] = await Promise.all([
    listPage(b, sp, page), slotFill(b, ['APPROVED']),
    db.matchCandidate.findMany({ where: { briefId: b.id, stage: { in: ['CONFIRMED', 'APPROVED'] } }, select: { stage: true, declare: true, data: true } }),
  ]);
  const approved = quoted.filter((c) => c.stage === 'APPROVED');
  const sum = (list: typeof quoted) => list.reduce((s, c) => s + (((c.declare ?? {}) as Declare).quote ?? 0), 0);
  const gmv = (list: typeof quoted) => list.reduce((s, c) => { const m = ((c.data ?? {}) as CandData).metrics; return s + (m?.medianViews && m.gpm ? (m.medianViews * m.gpm) / 1000 : 0); }, 0);
  const allowed = can(me, 'match.approve');
  const over = b.feeCap ? quoted.filter((c) => (((c.declare ?? {}) as Declare).quote ?? 0) > b.feeCap!).length : 0;
  return (
    <>
      <Todo briefId={b.id} step={8} />
      <Panel title="Tổng quan trước khi duyệt">
        <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-ink-3">Số KOC đã duyệt theo cấp</dt><dd className="mt-1"><Slots fill={fill} label="đã duyệt" /></dd></div>
          <div><dt className="text-xs text-ink-3">Chi phí đã duyệt / ngân sách</dt><dd className="font-semibold">{fmtVndShort(sum(approved))} / {b.budget ? fmtVndShort(b.budget) : '—'}</dd><dd className="text-xs text-ink-3">Kèm thuế TNCN ~{fmtVndShort(sum(approved) / FEE_DIVISOR)} · đang chờ duyệt {fmtVndShort(sum(quoted) - sum(approved))}</dd></div>
          <div><dt className="text-xs text-ink-3">GMV dự kiến / mục tiêu</dt><dd className="font-semibold">{fmtVndShort(gmv(approved))} / {b.gmvTarget ? fmtVndShort(b.gmvTarget) : '—'}</dd><dd className="text-xs text-ink-3">Ước tính từ view và GMV / 1.000 view của từng KOC</dd></div>
          <div><dt className="text-xs text-ink-3">KOC báo giá vượt phí tối đa</dt><dd className={`font-semibold ${over ? 'text-critical' : ''}`}>{b.feeCap ? over : '—'}</dd></div>
        </dl>
      </Panel>
      <Panel title="Duyệt KOC" action={<Filters sp={sp} step={8} />}>
        <Summary step={8} n={n} label="KOC đã duyệt" />
        {!allowed && <p className="mb-2 text-xs text-warning">Bạn chỉ xem được: duyệt cần quyền "Duyệt list KOC" (trưởng nhóm).</p>}
        <form action={approve}>
          <input type="hidden" name="briefId" value={b.id} />
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th className="w-8" /><th>KOC</th><th>Trạng thái</th><th className="text-center">Điểm</th><th>Đánh giá</th><th>Hợp nội dung</th><th className="text-right">Giá báo</th></tr></thead>
              <tbody>
                {rowsWithDivider(rows, 8, 7, (c, dim) => {
                  const { d, s } = sd(c);
                  return (
                    <tr key={c.id} className={`align-top ${dim}`}>
                      <td>{allowed && (c.stage === 'CONFIRMED' || c.stage === 'APPROVED') && <input type="checkbox" name="cid" value={c.id} aria-label={`Chọn @${c.handle}`} />}</td>
                      <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                      <td><StageChip stage={c.stage} /></td>
                      <td className="text-center"><Total score={s} /></td>
                      <td><TierChip score={s} /><div className="mt-0.5 max-w-60 text-xs text-ink-3">{s?.action}</div></td>
                      <td><FitCell manual={c.manual} /></td>
                      <td className="text-right tabular-nums">{fmtVnd(((c.declare ?? {}) as Declare).quote)}</td>
                    </tr>
                  );
                })}
                {!rows.length && <Empty cols={7} />}
              </tbody>
            </table>
          </div>
          {allowed && (
            <div className="mt-3 flex flex-wrap items-end justify-end gap-2">
              <label><span className="label">Lý do (khi trả về / loại)</span><input name="reason" className="input h-8 w-64" /></label>
              <select name="code" defaultValue="SCORE" aria-label="Lý do loại" className="input h-8 w-52 text-[13px]">
                {Object.entries(KO).filter(([k]) => k !== 'POOL').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <button name="action" value="reject" className="btn h-8 px-3 text-xs">Loại</button>
              <button name="action" value="return" className="btn h-8 px-3 text-xs">Trả về hỏi lại giá</button>
              <button name="action" value="approve" className="btn btn-primary h-8 px-3 text-xs">Duyệt KOC đã tick</button>
            </div>
          )}
        </form>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 9. Gửi brand
async function Export({ b, me, n, page, open, listParams, sp }: Ctx) {
  const [{ rows, total }, batches] = await Promise.all([
    listPage(b, sp, page),
    db.listingBatch.findMany({ where: { OR: [{ briefId: b.id }, ...(b.brand ? [{ brand: b.brand, briefId: null, NOT: { id: { startsWith: 'lark-' } } }] : [])] }, orderBy: { updatedAt: 'desc' }, take: 20, select: { id: true, name: true, month: true, briefId: true, _count: { select: { items: true } } } }),
  ]);
  const linked = batches.filter((x) => x.briefId === b.id);
  const approvedN = n.APPROVED ?? 0;
  return (
    <>
      <Todo briefId={b.id} step={9}>
        {can(me, 'data.export') && <>
          <a href={`/matching/${b.id}/export`} className="btn btn-primary h-8 px-3 text-xs">Tải Excel gửi brand</a>
          <a href={`/matching/${b.id}/export?all=1`} className="btn h-8 px-3 text-xs">Tải Excel tất cả KOC (nội bộ)</a>
        </>}
      </Todo>
      <Panel title="Chuyển sang Listing để brand duyệt online">
        {linked.length > 0 && <p className="mb-2 text-[13px]">Đã chuyển sang: {linked.map((x, i) => <span key={x.id}>{i > 0 && ', '}<Link href={`/listing/${x.id}`} className="link">{x.name}</Link> ({x._count.items} KOC)</span>)}</p>}
        {approvedN > 0 ? (
          <form action={toListing} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="briefId" value={b.id} />
            <label className="min-w-56 flex-1">
              <span className="label">Đợt listing</span>
              <select name="batchId" defaultValue={linked[0]?.id ?? 'new'} className="input">
                <option value="new">+ Tạo đợt listing mới</option>
                {batches.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.month}</option>)}
              </select>
            </label>
            <label className="min-w-56 flex-1"><span className="label">Tên đợt listing mới</span><input name="name" defaultValue={b.name} className="input" /></label>
            <button className="btn btn-primary">Chuyển {approvedN} KOC đã duyệt sang Listing</button>
          </form>
        ) : <p className="text-xs text-ink-3">Chưa có KOC nào được duyệt: duyệt ở bước 8 trước.</p>}
      </Panel>
      <Panel title="List KOC gửi brand" action={<Filters sp={sp} step={9} />}>
        <Summary step={9} n={n} label="KOC trong list gửi brand" />
        <p className="mb-2 text-xs text-ink-3">List gửi brand chỉ gồm KOC đã duyệt, kèm điểm, đánh giá và lý do chọn. Thông tin nội bộ (tác phong, liên hệ, thanh toán) không xuất ra.</p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>KOC</th><th>Trạng thái</th><th className="text-center">Điểm</th><th>Đánh giá</th><th>Vì sao chọn</th><th className="text-right">Giá báo</th></tr></thead>
            <tbody>
              {rowsWithDivider(rows, 9, 6, (c, dim) => {
                const { d, s } = sd(c);
                return (
                  <tr key={c.id} className={`align-top ${dim}`}>
                    <td><KocCell href={open(c.id)} handle={c.handle} platform={c.platform} d={d} kocId={c.kocId} /></td>
                    <td><StageChip stage={c.stage} /></td>
                    <td className="text-center"><Total score={s} /></td>
                    <td><TierChip score={s} /></td>
                    <td className="max-w-80 text-xs">{picked(9, c.stage) ? <>{s?.strengths.length ? `Mạnh: ${s.strengths.join(', ')}` : ''}{s?.weaknesses.length ? <div className="text-ink-3">Yếu: {s.weaknesses.join(', ')}</div> : null}</> : <Why c={c} />}</td>
                    <td className="text-right tabular-nums">{fmtVnd(((c.declare ?? {}) as Declare).quote)}</td>
                  </tr>
                );
              })}
              {!rows.length && <Empty cols={6} />}
            </tbody>
          </table>
        </div>
        <Pager params={listParams} page={page} perPage={PER} total={total} />
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------- Bước 10. Sau khi air
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
    <>
      <Todo briefId={b.id} step={10} />
      <Panel title="Kết quả sau khi air" action={<Filters sp={sp} step={10} />}>
        <Summary step={10} n={n} label="KOC đã book" />
        <p className="mb-2 text-xs text-ink-3">View, GMV lấy từ booking trên Lark cùng brand (từ tháng air). Kết quả bạn ghi giúp lần tìm KOC sau chấm chính xác hơn: "Vào KOC core" gắn nhãn ở Danh bạ, "Dừng hợp tác" ghi KOC không hợp brand này.</p>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>KOC</th><th>Job / booking</th><th className="text-right">View 30 ngày</th><th className="text-right">GMV mỗi video</th><th className="text-right">Chi phí / view</th><th className="text-right">GMV / chi phí</th><th>Kết quả</th><th /></tr></thead>
            <tbody>
              {rowsWithDivider(rows, 10, 8, (c, dim) => {
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
                    <td className="text-right">{on && <Link href={`${open(c.id)}#outcome`} scroll={false} className="btn btn-primary h-7 px-2 text-xs">Ghi kết quả</Link>}</td>
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
