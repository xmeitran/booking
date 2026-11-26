import Link from 'next/link';
import type { Brand, MatchBrief, Product } from '@prisma/client';
import { Avatar, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate, fmtNum, fmtPct, fmtShort, fmtVnd } from '@/lib/format';
import { PRICE_TYPES } from '@/lib/booking/listing';
import { RATING_TAGS } from '@/lib/koc/kocDirectory';
import type { Finding, ScoreResult } from '@/lib/matching/engine';
import { contentChecksFor } from '@/lib/matching/run';
import {
  CONTENT_ERRORS, criterion, DECISIONS, GROUP_LABEL, KO, koLabel, parseRules,
  type Check, type Declare, type Manual, type Outcome,
} from '@/lib/matching/spec';
import { can, type Me } from '@/lib/auth/session';
import { keepException, rejectCandidate, restoreCandidate, saveChecks, saveDeclare, saveManual, saveOutcome } from '../actions';
import { channelUrl, Findings, StageChip, TierChip, Total, type CandData } from '../parts';

const REUP = ['Shopee', 'Facebook', 'Instagram', 'Threads', 'YouTube'];
const yn = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : '');

/** Chi tiết một ứng viên: mọi thao tác Booker của bước 3–10 trên một KOC. */
export async function CandidateDialog({ cid, brief, me, step, page, close, err }: {
  cid: string; brief: MatchBrief & { brandRef: Brand | null; product: Product | null }; me: Me; step: number; page?: string; close: string; err?: string;
}) {
  const c = await db.matchCandidate.findUnique({ where: { id: cid }, include: { koc: { select: { id: true, phone: true, zalo: true, email: true, rateCard: true } } } });
  if (!c || c.briefId !== brief.id) return null;
  const d = (c.data ?? {}) as CandData;
  const s = (c.score ?? null) as ScoreResult | null;
  const m = d.metrics;
  const ko = (c.knockouts ?? []) as Finding[];
  const flags = (c.flags ?? []) as Finding[];
  const checks = (c.checks ?? {}) as Record<string, Check>;
  const dc = (c.declare ?? {}) as Declare;
  const manual = (c.manual ?? {}) as Manual;
  const o = (c.outcome ?? {}) as Outcome;
  const rules = parseRules(brief.brandRef?.rules);
  const codes = contentChecksFor(brief);
  const rating = c.kocId ? await db.kocRating.findUnique({ where: { dealId: `MC-${c.id}` } }) : null;
  const canKeep = can(me, 'match.approve') || rules.exceptionApprover === me.id;
  const hidden = (k: string, v: string | number) => <input type="hidden" name={k} value={v} />;
  const common = <>{hidden('cid', c.id)}{hidden('step', step)}{hidden('page', page ?? '')}</>;
  const url = channelUrl(c.platform, c.handle);
  const late = ['SHORTLIST', 'CONFIRMED', 'APPROVED'].includes(c.stage);

  return (
    <Dialog title={d.name ?? `@${c.handle}`} closeHref={close} wide>
      {err && <p role="alert" className="mb-3 rounded-md bg-critical-soft px-3 py-2 text-critical">{err}</p>}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar src={d.avatarUrl} name={d.name ?? c.handle} size={44} />
          <div>
            <div className="text-[13px]">
              {url ? <a href={url} target="_blank" rel="noreferrer" className="link">@{c.handle}</a> : `@${c.handle}`} · {c.platform}
              {d.kl && ` · ${d.kl}${d.klSource ? ` (${d.klSource})` : ''}`}{d.niche && ` · ${d.niche}`}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StageChip stage={c.stage} /><TierChip score={s} />
              {c.kocId ? <Link href={`/contacts/${c.kocId}`} className="link text-xs">Hồ sơ Danh bạ</Link> : <span className="pill bg-accent-soft text-accent">Chỉ có trong kho</span>}
              {c.rejectCode && <span className="text-xs text-critical">{koLabel(c.rejectCode)}: {c.reason}</span>}
              {c.exception && <span className="text-xs text-warning">Ngoại lệ: {c.exception}</span>}
            </div>
          </div>
        </div>
        <div className="text-right text-[13px]"><Total score={s} /><div className="text-xs text-ink-3">{s?.action}</div></div>
      </div>

      <Sec title="Số liệu kênh">
        {m ? (
          <>
            <dl className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-3">
              {([
                ['Nguồn', `${m.source}${m.at ? ` · ${fmtDate(new Date(m.at))}` : ''}`], ['Follower', fmtNum(m.followers)], ['View trung vị', fmtNum(m.medianViews)],
                ['ER', m.er == null ? '—' : fmtPct(m.er)], ['Video 30 ngày · gắn giỏ', `${m.videos30 ?? '—'} · ${m.ecVideos ?? '—'}`], ['Lượt bán 30 ngày', fmtNum(m.unitsSold)],
                ['GMV 30 ngày', fmtVnd(m.gmv)], ['GPM', fmtVnd(m.gpm)], ['GMV / người mua', fmtVnd(m.aov)],
                ['Follower nữ', fmtPct(m.female)], ['18–24 · 25–34', m.ages ? `${fmtPct(m.ages['18-24'])} · ${fmtPct(m.ages['25-34'])}` : '—'], ['Brand đã hợp tác', m.brandCount == null ? '—' : String(m.brandCount)],
                ['Giá tham chiếu', d.price ? `${fmtVnd(d.price)} (${d.priceSource})` : '—'], ['Booking với UpBase', String(d.bookings ?? 0)], ['Lượt chấm sao', String(d.ratings ?? 0)],
              ] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-ink-3">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
            </dl>
            {m.categories?.length ? <p className="mt-2 text-xs">Tỷ trọng GMV theo ngành: {m.categories.map((x) => `${x.name} ${fmtPct(x.share, 0)}`).join(' · ')}</p> : null}
            {m.locations?.length ? <p className="mt-1 text-xs">Follower theo tỉnh: {m.locations.map((x) => `${x.name} ${fmtPct(x.share, 0)}`).join(' · ')}</p> : null}
            {m.brands.length ? <p className="mt-1 text-xs">Brand đối tác: {m.brands.join(', ')}</p> : null}
            {m.topVideos.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs">
                {m.topVideos.map((v, i) => <li key={i}>{v.url ? <a href={v.url} target="_blank" rel="noreferrer" className="link">{v.title || 'Video'}</a> : v.title} <span className="text-ink-3">· {fmtShort(v.views)} view{v.date ? ` · ${v.date}` : ''}</span></li>)}
              </ul>
            )}
          </>
        ) : <p className="text-[13px] text-ink-3">Chưa có số liệu kênh (KOC chưa có trong kho và chưa tra TikTok Shop).</p>}
      </Sec>

      <Sec title="Knock-out (bước 3) và cảnh báo">
        <Findings list={ko} empty="Không trượt mã loại nào bằng dữ liệu." />
        {flags.length > 0 && <div className="mt-2 rounded-md bg-sunken px-3 py-2"><Findings list={flags} /></div>}
        <div className="mt-3 flex flex-wrap gap-3">
          {(c.stage === 'KO' || c.stage === 'OUT') && canKeep && (
            <form action={keepException} className="flex gap-1.5">{common}
              <input name="reason" required placeholder="Lý do giữ ngoại lệ (I-26)" className="input h-8 w-64 text-[13px]" />
              <button className="btn h-8 px-3 text-xs">Giữ lại</button>
            </form>
          )}
          {c.stage === 'REJECTED' && <form action={restoreCandidate}>{common}<button className="btn h-8 px-3 text-xs">Khôi phục về pool</button></form>}
          {!['REJECTED', 'KO', 'OUT'].includes(c.stage) && (
            <form action={rejectCandidate} className="flex flex-wrap gap-1.5">{common}
              <select name="code" aria-label="Mã loại" className="input h-8 w-52 text-[13px]">{Object.entries(KO).map(([k, v]) => <option key={k} value={k}>{k} · {v.label}</option>)}</select>
              <input name="reason" required placeholder="Lý do loại" className="input h-8 w-56 text-[13px]" />
              <button className="btn btn-danger h-8 px-3 text-xs">Loại</button>
            </form>
          )}
        </div>
      </Sec>

      <Sec title="Bước 4 · Kiểm tra nội dung kênh">
        <form action={saveChecks} className="grid gap-2">{common}
          {codes.map((k) => (
            <div key={k} className="grid items-start gap-2 sm:grid-cols-[14rem_10rem_1fr]">
              <div className="text-[13px]"><b>{koLabel(k)}</b><div className="text-xs text-ink-3">{KO[k].rule}</div></div>
              <select name={`check|${k}`} defaultValue={checks[k] ? (checks[k].ok ? 'ok' : 'fail') : ''} aria-label={`Kết quả ${k}`} className="input h-8 text-[13px]">
                <option value="">Chưa kiểm</option><option value="ok">Đạt</option><option value="fail">Không đạt (loại)</option>
              </select>
              <input name={`note|${k}`} defaultValue={checks[k]?.note ?? ''} placeholder={checks[k] ? `${checks[k].by ?? ''} ${checks[k].at ? fmtDate(new Date(checks[k].at!)) : ''}` : 'Ghi chú / bằng chứng (link video)'} aria-label={`Ghi chú ${k}`} className="input h-8 text-[13px]" />
            </div>
          ))}
          <div className="flex justify-end"><button className="btn h-8 px-3 text-xs">Lưu kiểm tra</button></div>
        </form>
      </Sec>

      {late && (
        <Sec title="Bước 6 · KOC báo giá và xác nhận">
          <form action={saveDeclare} className="grid gap-3 sm:grid-cols-3">{common}
            <F label="Giá KOC báo, net (₫) · I-52"><input name="quote" inputMode="numeric" defaultValue={dc.quote ?? ''} className="input" /></F>
            <F label="Loại giá"><select name="priceType" defaultValue={dc.priceType ?? 'Video'} className="input">{PRICE_TYPES.map((p) => <option key={p}>{p}</option>)}</select></F>
            <F label="Cam kết không đăng đối thủ sau air · I-40 (K8)"><YesNo name="noCompetitor" v={dc.noCompetitor} /></F>
            <F label={`Đồng ý ads code / Spark Ads · I-39${brief.gmvMax ? ' (K14)' : ''}`}><YesNo name="adsCode" v={dc.adsCode} /></F>
            <F label={`Số ngày ads code (yêu cầu ${rules.adsCodeDays})`}><input name="adsDays" inputMode="numeric" defaultValue={dc.adsDays ?? ''} className="input" /></F>
            <F label="Số vòng sửa kịch bản / demo nhận"><input name="revisions" inputMode="numeric" defaultValue={dc.revisions ?? ''} className="input" /></F>
            {brief.expertClaim && <F label="Chứng chỉ hành nghề · I-41 (K12)"><input name="certificate" defaultValue={dc.certificate ?? ''} placeholder="Chứng chỉ dược sĩ số..." className="input" /></F>}
            <F label="Có sample / nhận wave"><YesNo name="sample" v={dc.sample} /></F>
            <fieldset className="col-span-full"><legend className="label">Kênh reup đồng ý</legend>
              <div className="flex flex-wrap gap-x-4 text-[13px]">{REUP.map((r) => <label key={r} className="flex items-center gap-1.5"><input type="checkbox" name="reup" value={r} defaultChecked={dc.reup?.includes(r)} />{r}</label>)}</div>
            </fieldset>
            <F label="Ghi chú" wide><input name="note" defaultValue={dc.note ?? ''} className="input" /></F>
            <div className="col-span-full flex justify-end gap-2">
              <button className="btn h-8 px-3 text-xs">Lưu</button>
              {c.stage === 'SHORTLIST' && <button name="confirm" value="1" className="btn btn-primary h-8 px-3 text-xs">Lưu và xác nhận đã báo giá</button>}
            </div>
          </form>
        </Sec>
      )}

      <Sec title="Điểm 6 nhóm · chấm tay (bước 7)" id="manual">
        <form action={saveManual}>{common}
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Tiêu chí</th><th>Số liệu / cách tính</th><th className="text-center">Điểm</th><th>Booker chấm</th></tr></thead>
              <tbody>
                {(s?.groups ?? []).map((g) => (
                  <GroupRows key={g.group} label={`${GROUP_LABEL[g.group]} · ${g.weight}% · ${g.score == null ? 'chưa có' : `${g.score}/5`}`} note={g.note}>
                    {g.parts.map((p) => {
                      const cr = criterion(p.id);
                      return (
                        <tr key={p.id} className="align-top">
                          <td className="text-[13px]">{p.label}{p.must && <span className="ml-1 pill bg-critical-soft text-critical">Bắt buộc</span>}<div className="text-xs text-ink-3">{cr?.measure}</div></td>
                          <td className="max-w-72 text-xs">{p.value ?? <span className="text-ink-3">Chưa có số liệu</span>}<div className="text-ink-3">1: {cr?.scale[0]} · 3: {cr?.scale[1]} · 5: {cr?.scale[2]}</div></td>
                          <td className="text-center tabular-nums">{p.score ?? '·'}</td>
                          <td>
                            <div className="flex gap-1">
                              <select name={`score|${p.id}`} defaultValue={manual[p.id]?.score ?? ''} aria-label={`Điểm ${p.label}`} className="input h-8 w-16 text-[13px]">
                                <option value="">{cr?.auto ? 'Tự động' : '—'}</option>{[1, 2, 3, 4, 5].map((x) => <option key={x}>{x}</option>)}
                              </select>
                              <input name={`snote|${p.id}`} defaultValue={manual[p.id]?.note ?? ''} placeholder="Lý do" aria-label={`Lý do ${p.label}`} className="input h-8 w-36 text-[13px]" />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </GroupRows>
                ))}
              </tbody>
            </table>
          </div>
          {s?.mustFail.length ? <p className="mt-2 text-xs text-critical">Không đạt tiêu chí Bắt buộc: {s.mustFail.join(', ')}</p> : null}
          <div className="mt-2 flex justify-end"><button className="btn h-8 px-3 text-xs">Lưu điểm và chấm lại</button></div>
        </form>
      </Sec>

      {c.stage === 'APPROVED' && (
        <Sec title="Bước 10 · Đánh giá sau air" id="outcome">
          <form action={saveOutcome} className="grid gap-3 sm:grid-cols-3">{common}
            <F label="Đạt KPI view / GMV"><YesNo name="kpiMet" v={o.kpiMet} /></F>
            <F label="Trả kịch bản, demo, air đúng hạn"><YesNo name="onTime" v={o.onTime} /></F>
            <F label="Nghiệm thu đạt lần 1"><YesNo name="firstPass" v={o.firstPass} /></F>
            <F label="Giữ video công khai ≥ 90 ngày"><YesNo name="keptPublic" v={o.keptPublic} /></F>
            <F label="Lỗi content">
              <select name="contentError" defaultValue={o.contentError ?? ''} className="input"><option value="">Không</option>{Object.entries(CONTENT_ERRORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </F>
            <F label="Quyết định">
              <select name="decision" defaultValue={o.decision ?? ''} className="input"><option value="">—</option>{Object.entries(DECISIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </F>
            {c.kocId && (
              <>
                <F label="Rating Booker (sao)">
                  <select name="stars" defaultValue={rating?.stars ?? ''} className="input"><option value="">—</option>{[5, 4, 3, 2, 1].map((x) => <option key={x} value={x}>{'★'.repeat(x)}</option>)}</select>
                </F>
                <fieldset className="col-span-2"><legend className="label">Nhận định</legend>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">{RATING_TAGS.map((t) => <label key={t.code} className="flex items-center gap-1"><input type="checkbox" name="tags" value={t.code} defaultChecked={rating?.tags.includes(t.code)} />{t.label}</label>)}</div>
                </fieldset>
              </>
            )}
            <F label="Ghi chú" wide><input name="note" defaultValue={o.note ?? ''} className="input" /></F>
            <div className="col-span-full flex justify-end"><button className="btn btn-primary h-8 px-3 text-xs">Lưu kết quả</button></div>
          </form>
        </Sec>
      )}
    </Dialog>
  );
}

function Sec({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return <section id={id} className="mb-4 border-t border-line pt-3"><h3 className="mb-2 text-[13px] font-semibold">{title}</h3>{children}</section>;
}
function F({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block ${wide ? 'col-span-full' : ''}`}><span className="label">{label}</span>{children}</label>;
}
function YesNo({ name, v }: { name: string; v: boolean | null | undefined }) {
  return <select name={name} defaultValue={yn(v)} className="input"><option value="">—</option><option value="yes">Có</option><option value="no">Không</option></select>;
}
function GroupRows({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <>
      <tr><td colSpan={4} className="bg-sunken text-xs font-semibold">{label}{note && <span className="ml-2 font-normal text-ink-3">{note}</span>}</td></tr>
      {children}
    </>
  );
}
