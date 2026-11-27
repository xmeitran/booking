import Link from 'next/link';
import type { Brand, MatchBrief, MatchCandidate, Product } from '@prisma/client';
import { Avatar, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate, fmtNum, fmtPct, fmtShort, fmtVnd } from '@/lib/format';
import { PRICE_TYPES } from '@/lib/booking/listing';
import { RATING_TAGS } from '@/lib/koc/kocDirectory';
import type { Finding, Part, ScoreResult } from '@/lib/matching/engine';
import { topVideosOf } from '@/lib/matching/data';
import { contentChecksFor } from '@/lib/matching/run';
import {
  ASSUMED_SCORE, CONTENT_ERRORS, criterion, DECISIONS, GROUP_LABEL, KO, koLabel, parseRules, REQUIRED_MANUAL,
  type Declare, type Manual, type Outcome,
} from '@/lib/matching/spec';
import { can, type Me } from '@/lib/auth/session';
import { keepException, pick, rejectCandidate, restoreCandidate, saveDeclare, saveManual, saveOutcome } from '../actions';
import { channelUrl, Findings, StageChip, TierChip, Total, type CandData } from '../parts';

/** Mỗi popup chỉ hỏi đúng việc của nó: xem chi tiết, loại, giữ lại, nhập giá, chấm điểm, ghi kết quả sau air. */
export type Mode = 'detail' | 'reject' | 'keep' | 'price' | 'score' | 'outcome';
const TITLE: Record<Mode, string> = { detail: 'Chi tiết KOC', reject: 'Loại KOC', keep: 'Giữ lại KOC bị hệ thống loại', price: 'Giá và cam kết', score: 'Chấm điểm', outcome: 'Kết quả sau khi air' };
const REUP = ['Shopee', 'Facebook', 'Instagram', 'Threads', 'YouTube'];
type BriefRef = MatchBrief & { brandRef: Brand | null; product: Product | null };

export async function CandidateDialog({ cid, mode, brief, me, step, page, base, err }: {
  cid: string; mode: Mode; brief: BriefRef; me: Me; step: number; page?: string; base: string; err?: string;
}) {
  const c = await db.matchCandidate.findUnique({ where: { id: cid } });
  if (!c || c.briefId !== brief.id) return null;
  const m: Mode = mode in TITLE ? mode : 'detail';
  const d = (c.data ?? {}) as CandData;
  if (d.metrics) d.metrics.topVideos = (await topVideosOf([c])).get(`${c.platform}|${c.handle}`) ?? [];
  const s = (c.score ?? null) as ScoreResult | null;
  const go = (x: Mode) => `${base}&c=${c.id}&m=${x}`;
  const hidden = <><input type="hidden" name="cid" value={c.id} /><input type="hidden" name="step" value={step} /><input type="hidden" name="page" value={page ?? ''} /><input type="hidden" name="m" value={m} /></>;
  const url = channelUrl(c.platform, c.handle);

  return (
    <Dialog title={`${TITLE[m]} · ${d.name ?? `@${c.handle}`}`} closeHref={base} wide={m === 'detail' || m === 'score'}>
      {err && <p role="alert" className="mb-3 rounded-md bg-critical-soft px-3 py-2 text-[13px] text-critical">{err}</p>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-sunken px-3 py-2">
        <div className="flex items-center gap-3">
          <Avatar src={d.avatarUrl} name={d.name ?? c.handle} size={36} />
          <div className="text-[13px]">
            <div>{url ? <a href={url} target="_blank" rel="noreferrer" className="link">@{c.handle} ↗</a> : `@${c.handle}`}{d.kl && ` · ${d.kl}`}{d.niche && ` · ${d.niche}`}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5"><StageChip stage={c.stage} />{c.kocId ? <span className="text-xs text-ink-3">Trong Danh bạ (Lark Base) · <Link href={`/contacts/${c.kocId}`} target="_blank" className="link">Hồ sơ ↗</Link></span> : <span className="text-xs text-ink-3">Ngoài Danh bạ (DWH của Tech)</span>}</div>
          </div>
        </div>
        <div className="text-right"><div className="text-xs text-ink-3">Điểm / 100</div><div className="text-lg"><Total score={s} /></div><TierChip score={s} /></div>
      </div>

      {m === 'detail' && <Detail c={c} d={d} s={s} brief={brief} me={me} go={go} hidden={hidden} />}
      {m === 'reject' && <Reject c={c} brief={brief} hidden={hidden} />}
      {m === 'keep' && <Keep c={c} hidden={hidden} />}
      {m === 'price' && <Price c={c} d={d} brief={brief} hidden={hidden} />}
      {m === 'score' && <Score c={c} s={s} hidden={hidden} />}
      {m === 'outcome' && <OutcomeForm c={c} hidden={hidden} />}
    </Dialog>
  );
}

type P = { c: MatchCandidate; hidden: React.ReactNode };
const Foot = ({ children }: { children: React.ReactNode }) => <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-line pt-3">{children}</div>;
function F({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block ${wide ? 'col-span-full' : ''}`}><span className="label">{label}</span>{children}{hint && <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>}</label>;
}
/** Chọn một trong vài nút (radio dạng nút bấm). */
function Choice({ name, value, options }: { name: string; value: string; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([v, label]) => (
        <label key={v} className="cursor-pointer">
          <input type="radio" name={name} value={v} defaultChecked={value === v} className="peer sr-only" />
          <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-line px-2.5 text-[13px] hover:border-accent peer-checked:border-accent peer-checked:bg-accent peer-checked:text-surface peer-focus-visible:ring-2 peer-focus-visible:ring-focus">{label}</span>
        </label>
      ))}
    </div>
  );
}
const yn = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : '');
const YesNo = ({ name, v }: { name: string; v: boolean | null | undefined }) => <Choice name={name} value={yn(v)} options={[['yes', 'Có'], ['no', 'Không'], ['', 'Chưa rõ']]} />;

// ---------------------------------------------------------------- Chi tiết: chỉ xem, kèm nút việc tiếp theo
function Detail({ c, d, s, brief, me, go, hidden }: P & { d: CandData; s: ScoreResult | null; brief: BriefRef; me: Me; go: (x: Mode) => string }) {
  const m = d.metrics;
  const ko = (c.knockouts ?? []) as Finding[];
  const flags = ((c.flags ?? []) as Finding[]).filter((f) => f.code !== 'POOL' || c.stage === 'OUT');
  const canKeep = can(me, 'match.approve') || parseRules(brief.brandRef?.rules).exceptionApprover === me.id;
  const st = c.stage;
  return (
    <>
      <Sec title="Số liệu kênh">
        {m ? (
          <>
            <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
              {([
                ['Follower', fmtNum(m.followers)], ['View trung bình / video', fmtNum(m.medianViews)], ['Tỉ lệ tương tác', m.er == null ? '—' : fmtPct(m.er)],
                ['Video 30 ngày · gắn giỏ', `${m.videos30 ?? '—'} · ${m.ecVideos ?? '—'}`], ['Sản phẩm bán 30 ngày', fmtNum(m.unitsSold)], ['GMV 30 ngày', fmtVnd(m.gmv)],
                ['GMV / 1.000 view', fmtVnd(m.gpm)], ['Follower nữ', fmtPct(m.female)], ['18–24 · 25–34 tuổi', m.ages ? `${fmtPct(m.ages['18-24'])} · ${fmtPct(m.ages['25-34'])}` : '—'],
                ['Giá tham khảo', d.price ? `${fmtVnd(d.price)} (${d.priceSource})` : '—'], ['Đã book với UpBase', `${d.bookings ?? 0} lần`], ['Số liệu ngày', m.at ? fmtDate(new Date(m.at)) : '—'],
              ] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-ink-3">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
            </dl>
            {d.kwHits?.length ? <p className="mt-2 text-xs text-accent">Khớp từ khoá của đợt: {d.kwHits.join(', ')}</p> : null}
            {m.categories?.length ? <p className="mt-2 text-xs">Bán theo ngành: {m.categories.map((x) => `${x.name} ${fmtPct(x.share, 0)}`).join(' · ')}</p> : null}
            {m.topVideos.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {m.topVideos.map((v, i) => <li key={i}>{v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="link">{v.title || 'Video'}</a> : v.title} <span className="text-ink-3">· {fmtShort(v.views)} view{v.date ? ` · ${v.date}` : ''}</span></li>)}
              </ul>
            )}
          </>
        ) : <p className="text-[13px] text-ink-3">Kho dữ liệu chưa có số liệu của kênh này. Mở kênh để xem trực tiếp.</p>}
      </Sec>

      {(ko.length > 0 || flags.length > 0 || c.rejectCode || c.exception) && (
        <Sec title="Lý do loại và cảnh báo">
          {c.rejectCode && <p className="text-[13px] text-critical">Đã loại: {koLabel(c.rejectCode)}{c.reason ? ` (${c.reason})` : ''}</p>}
          {c.exception && <p className="text-[13px] text-warning">Được giữ lại: {c.exception}</p>}
          <Findings list={ko} />
          {flags.length > 0 && <div className="mt-1"><Findings list={flags} /></div>}
        </Sec>
      )}

      <Sec title="Điểm theo nhóm">
        <ul className="grid gap-1 text-[13px] sm:grid-cols-2">
          {(s?.groups ?? []).map((g) => (
            <li key={g.group} className="flex justify-between gap-2 border-b border-line py-1"><span>{GROUP_LABEL[g.group]} <span className="text-xs text-ink-3">({g.weight}%)</span></span><b className="tabular-nums">{g.score == null ? <span className="font-normal text-ink-3">chưa chấm</span> : `${g.score}/5`}</b></li>
          ))}
        </ul>
        {s?.strengths.length ? <p className="mt-2 text-xs text-positive">Mạnh: {s.strengths.join(', ')}</p> : null}
        {s?.weaknesses.length ? <p className="text-xs text-critical">Yếu: {s.weaknesses.join(', ')}</p> : null}
      </Sec>

      <Foot>
        {st === 'POOL' && <>
          <Link href={go('reject')} scroll={false} className="btn">Loại</Link>
          <form action={pick}>{hidden}<input type="hidden" name="briefId" value={c.briefId} /><input type="hidden" name="one" value={c.id} /><button className="btn btn-primary">Chọn để hỏi giá</button></form>
        </>}
        {(st === 'SHORTLIST' || st === 'CONFIRMED' || st === 'APPROVED') && <>
          {st !== 'APPROVED' && <Link href={go('reject')} scroll={false} className="btn">Loại</Link>}
          <Link href={go('score')} scroll={false} className="btn">Chấm điểm</Link>
          {st !== 'APPROVED' ? <Link href={go('price')} scroll={false} className="btn btn-primary">Nhập giá</Link> : <Link href={go('outcome')} scroll={false} className="btn btn-primary">Ghi kết quả sau air</Link>}
        </>}
        {(st === 'KO' || st === 'OUT') && canKeep && <Link href={go('keep')} scroll={false} className="btn btn-primary">Giữ lại</Link>}
        {st === 'REJECTED' && <form action={restoreCandidate}>{hidden}<button className="btn btn-primary">Khôi phục</button></form>}
      </Foot>
    </>
  );
}

// ---------------------------------------------------------------- Loại: chỉ chọn lý do
function Reject({ c, brief, hidden }: P & { brief: BriefRef }) {
  const content = contentChecksFor(brief);
  const late = ['SHORTLIST', 'CONFIRMED', 'APPROVED'].includes(c.stage);
  const other: string[] = [...(late ? ['PRICE'] : []), 'SCORE', 'OTHER'];
  const Opt = ({ code }: { code: string }) => {
    const k = KO[code as keyof typeof KO];
    return (
      <label className="flex cursor-pointer gap-2 rounded-md border border-line px-3 py-2 hover:border-accent has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
        <input type="radio" name="code" value={code} required className="mt-0.5" />
        <span className="text-[13px]"><b className="font-medium">{k.label}</b>{k.rule && <span className="block text-xs text-ink-3">{k.rule}</span>}</span>
      </label>
    );
  };
  return (
    <form action={rejectCandidate}>{hidden}
      <p className="mb-2 text-[13px] text-ink-2">Chọn nhóm lý do và ghi rõ lý do. KOC vẫn nằm cuối danh sách, khôi phục được.</p>
      <fieldset className="mb-3"><legend className="label">Nội dung kênh</legend><div className="grid gap-1.5 sm:grid-cols-2">{content.map((k) => <Opt key={k} code={k} />)}</div></fieldset>
      <fieldset className="mb-3"><legend className="label">Lý do khác</legend><div className="grid gap-1.5 sm:grid-cols-2">{other.map((k) => <Opt key={k} code={k} />)}</div></fieldset>
      <F label="Lý do loại (bắt buộc)"><textarea name="reason" required rows={2} placeholder="Vd: video 12/11 nói chữa khỏi mụn trong 3 ngày, link…" className="input" /></F>
      <Foot><button className="btn btn-danger">Loại KOC</button></Foot>
    </form>
  );
}

// ---------------------------------------------------------------- Giữ lại KOC bị hệ thống loại
function Keep({ c, hidden }: P) {
  const ko = (c.knockouts ?? []) as Finding[];
  const flags = ((c.flags ?? []) as Finding[]).filter((f) => f.code === 'POOL');
  return (
    <form action={keepException}>{hidden}
      <p className="mb-1 text-[13px] text-ink-2">Hệ thống loại vì:</p>
      <div className="mb-3 rounded-md bg-critical-soft/50 px-3 py-2"><Findings list={c.stage === 'OUT' ? flags : ko} empty="—" /></div>
      <F label="Lý do vẫn giữ lại"><input name="reason" required placeholder="Vd: brand chỉ định, KOC vừa đổi tệp" className="input" /></F>
      <Foot><button className="btn btn-primary">Giữ lại, đưa về "Đang xét"</button></Foot>
    </form>
  );
}

// ---------------------------------------------------------------- Nhập giá: giá + cam kết, phần thêm gập lại
function Price({ c, d, brief, hidden }: P & { d: CandData; brief: BriefRef }) {
  const dc = (c.declare ?? {}) as Declare;
  const rules = parseRules(brief.brandRef?.rules);
  return (
    <form action={saveDeclare}>{hidden}<input type="hidden" name="more" value="1" />
      <p className="mb-3 text-xs text-ink-3">
        {d.price ? `Giá tham khảo: ${fmtVnd(d.price)} (${d.priceSource}). ` : ''}{brief.feeCap ? `Phí tối đa mỗi KOC: ${fmtVnd(brief.feeCap)}. ` : ''}
        Có giá và cam kết không đăng đối thủ{brief.gmvMax ? ', cho chạy ads' : ''} thì KOC tự chuyển "Đã báo giá".
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <F label="Giá KOC báo (₫, chưa thuế)"><input name="quote" inputMode="numeric" defaultValue={dc.quote ?? ''} autoFocus className="input" /></F>
        <F label="Loại giá"><select name="priceType" defaultValue={dc.priceType ?? 'Video'} className="input">{PRICE_TYPES.map((p) => <option key={p}>{p}</option>)}</select></F>
        <F label="Cam kết không đăng sản phẩm đối thủ sau air"><YesNo name="noCompetitor" v={dc.noCompetitor} /></F>
        <F label={`Cho chạy ads code / Spark Ads${brief.gmvMax ? ' (bắt buộc: brand chạy GMV Max)' : ''}`}><YesNo name="adsCode" v={dc.adsCode} /></F>
        {brief.expertClaim && <F label="Chứng chỉ hành nghề" hint="Nội dung đợt có nói chuyên môn: thiếu chứng chỉ thì KOC bị loại." wide><input name="certificate" defaultValue={dc.certificate ?? ''} placeholder="Vd: chứng chỉ dược sĩ số…" className="input" /></F>}
      </div>
      <details className="mt-3 rounded-md border border-line px-3 py-2">
        <summary className="cursor-pointer text-[13px] text-ink-2">Thông tin thêm (không bắt buộc)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <F label={`Số ngày cho chạy ads (brand cần ${rules.adsCodeDays})`}><input name="adsDays" inputMode="numeric" defaultValue={dc.adsDays ?? ''} className="input" /></F>
          <F label="Số lần nhận sửa kịch bản / video"><input name="revisions" inputMode="numeric" defaultValue={dc.revisions ?? ''} className="input" /></F>
          <F label="Đã có hàng mẫu"><YesNo name="sample" v={dc.sample} /></F>
          <fieldset><legend className="label">Đồng ý đăng lại video ở</legend>
            <div className="flex flex-wrap gap-x-3 text-[13px]">{REUP.map((r) => <label key={r} className="flex items-center gap-1"><input type="checkbox" name="reup" value={r} defaultChecked={dc.reup?.includes(r)} />{r}</label>)}</div>
          </fieldset>
          <F label="Ghi chú" wide><input name="note" defaultValue={dc.note ?? ''} className="input" /></F>
        </div>
      </details>
      <Foot><button className="btn btn-primary">Lưu giá</button></Foot>
    </form>
  );
}

// ---------------------------------------------------------------- Chấm điểm: ô đỏ B2C điền, mục hệ thống tự tính hiện mờ
function Score({ c, s, hidden }: P & { s: ScoreResult | null }) {
  const manual = (c.manual ?? {}) as Manual;
  const parts = (s?.groups ?? []).flatMap((g) => g.parts.map((p) => ({ ...p, group: g.group })));
  const isAuto = (p: Part) => criterion(p.id)?.auto === true;
  // B2C điền: mục bắt buộc (Tone), mục công thức thiếu số liệu, mục cảm nhận; mục B2C đã chấm cũng sửa được ở đây.
  const fillable = (p: Part) => REQUIRED_MANUAL.includes(p.id) || p.gap || p.manual || !isAuto(p) || (isAuto(p) && p.score == null);
  const rank = (p: Part) => (REQUIRED_MANUAL.includes(p.id) ? 0 : p.gap || (isAuto(p) && p.score == null) ? 1 : 2);
  const mine = parts.filter(fillable).sort((x, y) => rank(x) - rank(y));
  const auto = parts.filter((p) => !fillable(p));
  const blank = mine.filter((p) => !manual[p.id] || manual[p.id]!.by === 'AI').length;
  return (
    <form action={saveManual}>{hidden}
      <div className="mb-3 rounded-md border border-critical/30 bg-critical-soft/40 px-3 py-2 text-[13px]">
        <b className="text-critical">Ô màu đỏ là ô B2C cần điền ({blank} ô còn trống).</b> Chấm 1–5 theo cảm nhận khi xem kênh.
        {' '}Ô bỏ trống hệ thống tính {ASSUMED_SCORE} điểm, riêng <b>Tone khớp brand</b> bắt buộc chấm (không tính mặc định).
      </div>
      <div className="grid gap-2">
        {mine.map((p) => {
          const cr = criterion(p.id);
          const mm = manual[p.id];
          const ai = mm?.by === 'AI' ? mm : null;
          const done = !!mm && !ai;
          const required = REQUIRED_MANUAL.includes(p.id);
          const tag = required ? 'Bắt buộc' : p.gap || (isAuto(p) && p.score == null) ? 'Thiếu số liệu' : 'Cảm nhận';
          return (
            <div key={p.id} className={`rounded-md border px-3 py-2 ${done ? 'border-line' : 'border-critical/50 bg-critical-soft/20'}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 max-w-md text-[13px]">
                  <b className={`font-medium ${done ? '' : 'text-critical'}`}>{p.label}{required && ' *'}</b>
                  <span className={`ml-1.5 pill ${required ? 'bg-critical-soft text-critical' : 'bg-sunken text-ink-3'}`}>{tag}</span>{p.must && <span className="ml-1 pill bg-critical-soft text-critical">Brand yêu cầu</span>}
                  <div className="text-xs text-ink-3">{cr?.measure}</div>
                  {p.gap && !done && p.value && <div className="text-xs text-ink-3">Hệ thống: {p.value}</div>}
                  {ai && <div className="mt-0.5 text-xs text-accent">AI gợi ý {ai.score}/5{ai.note ? `: ${ai.note}` : ''}</div>}
                </div>
                <Choice name={`score|${p.id}`} value={done ? String(mm!.score) : ''} options={[['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['', required ? 'Chưa chấm' : `Để trống (= ${ASSUMED_SCORE})`]]} />
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-ink-3">1: {cr?.scale[0]} · 3: {cr?.scale[1]} · 5: {cr?.scale[2]}</span>
                <input name={`snote|${p.id}`} defaultValue={done ? mm!.note ?? '' : ''} placeholder="Ghi chú (tuỳ chọn)" aria-label={`Ghi chú ${p.label}`} className="input h-7 w-56 text-xs" />
              </div>
            </div>
          );
        })}
      </div>

      <h3 className="mt-4 mb-1 text-[13px] font-semibold">Hệ thống tự tính ({auto.length} mục, không cần điền)</h3>
      <ul className="divide-y divide-line rounded-md border border-line bg-sunken text-[13px]">
        {auto.map((p) => (
          <li key={p.id} className="flex items-start justify-between gap-3 px-3 py-1.5 text-ink-3" aria-disabled="true">
            <span className="min-w-0"><span className="pill mr-1 bg-surface text-ink-3">Tự tính</span>{p.label}<span className="block text-xs">{p.value}</span></span>
            <b className="shrink-0 tabular-nums text-ink-2">{p.score}/5</b>
          </li>
        ))}
        {!auto.length && <li className="px-3 py-1.5 text-xs text-ink-3">Kho chưa có số liệu nào của KOC này.</li>}
      </ul>
      {s?.mustFail.length ? <p className="mt-2 text-xs text-critical">Trượt yêu cầu bắt buộc của brand: {s.mustFail.join(', ')}</p> : null}
      <Foot><button className="btn btn-primary">Lưu điểm</button></Foot>
    </form>
  );
}

// ---------------------------------------------------------------- Kết quả sau air
async function OutcomeForm({ c, hidden }: P) {
  const o = (c.outcome ?? {}) as Outcome;
  const rating = c.kocId ? await db.kocRating.findUnique({ where: { dealId: `MC-${c.id}` } }) : null;
  return (
    <form action={saveOutcome} className="grid gap-3 sm:grid-cols-2">{hidden}
      <F label="Đạt KPI view / GMV"><YesNo name="kpiMet" v={o.kpiMet} /></F>
      <F label="Nộp kịch bản, video, air đúng hạn"><YesNo name="onTime" v={o.onTime} /></F>
      <F label="Lần sau">
        <select name="decision" defaultValue={o.decision ?? ''} className="input"><option value="">—</option>{Object.entries(DECISIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </F>
      {c.kocId && <F label="Chấm sao KOC"><select name="stars" defaultValue={rating?.stars ?? ''} className="input"><option value="">—</option>{[5, 4, 3, 2, 1].map((x) => <option key={x} value={x}>{'★'.repeat(x)}</option>)}</select></F>}
      <details className="col-span-full rounded-md border border-line px-3 py-2">
        <summary className="cursor-pointer text-[13px] text-ink-2">Thông tin thêm (không bắt buộc)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <F label="Nghiệm thu đạt ngay lần đầu"><YesNo name="firstPass" v={o.firstPass} /></F>
          <F label="Giữ video công khai từ 90 ngày"><YesNo name="keptPublic" v={o.keptPublic} /></F>
          <F label="Lỗi nội dung"><select name="contentError" defaultValue={o.contentError ?? ''} className="input"><option value="">Không</option>{Object.entries(CONTENT_ERRORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></F>
          {c.kocId && (
            <fieldset className="col-span-full"><legend className="label">Nhận định</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">{RATING_TAGS.map((t) => <label key={t.code} className="flex items-center gap-1"><input type="checkbox" name="tags" value={t.code} defaultChecked={rating?.tags.includes(t.code)} />{t.label}</label>)}</div>
            </fieldset>
          )}
        </div>
      </details>
      <F label="Ghi chú" wide><input name="note" defaultValue={o.note ?? ''} className="input" /></F>
      <div className="col-span-full"><Foot><button className="btn btn-primary">Lưu kết quả</button></Foot></div>
    </form>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mb-4"><h3 className="mb-2 text-[13px] font-semibold">{title}</h3>{children}</section>;
}
