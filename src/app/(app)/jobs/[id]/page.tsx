import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, Avatar, CopyButton } from '@/components/ui';
import { checklistOf } from '@/lib/catalog';
import { db } from '@/lib/db';
import { fmtDate, fmtNum, fmtShort, fmtVnd } from '@/lib/format';
import { CANCELLED, jobCode, RESULT_TONE, RESULTS, SAMPLE, STAGE_HINT, STAGE_TONE, STAGES, type ReviewItem } from '@/lib/jobs';
import { FEE_DIVISOR } from '@/lib/kocInsights';
import { PRICE_TYPES } from '@/lib/listing';
import { requireUser } from '@/lib/session';
import { draftBrief, moveStage, reviewJob, saveBrief, updateJob } from '../actions';

const iso = (d: Date | null) => (d ? d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');
const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  await requireUser();
  const { id } = await params;
  const { err } = await searchParams;
  const j = await db.job.findUnique({
    where: { id },
    include: {
      koc: true, brand: { include: { products: { select: { id: true, name: true } } } }, product: true, pic: { select: { name: true } },
      planLine: { include: { plan: { select: { id: true, name: true } } } }, listingItem: { include: { batch: { select: { id: true, name: true } } } },
      payment: { select: { id: true, number: true, status: true } },
    },
  });
  if (!j) notFound();
  const [users, logs, tier] = await Promise.all([
    db.user.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, jobRole: true } }),
    db.auditLog.findMany({ where: { entity: 'Job', entityId: id }, orderBy: { at: 'desc' }, take: 30 }),
    db.tierPrice.findFirst({ where: { tier: j.koc.kl ?? j.koc.klAuto ?? '', priceType: /live/i.test(j.priceType) ? 'Phiên livestream' : 'Video' } }),
  ]);
  const who = new Map((await db.user.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.userId).filter(Boolean) as string[]), j.reviewedById ?? ''] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const stage = STAGES.indexOf(j.stage as (typeof STAGES)[number]);
  const next = stage >= 0 && stage < STAGES.length - 2 ? STAGES[stage + 1] : null; // "Thanh toán" chỉ qua ĐNTT
  const checklist = checklistOf(j.brand?.checklist);
  const review = (j.review ?? []) as ReviewItem[];
  const priceOut = tier && j.price != null && ((tier.minPrice != null && j.price < tier.minPrice) || (tier.maxPrice != null && j.price > tier.maxPrice));
  const kl = j.koc.kl ?? j.koc.klAuto;
  const fix = review.filter((r) => r.result && r.result !== 'Đạt');
  const fixText = fix.length
    ? [`Chào ${j.koc.nickname ?? j.koc.name}, video ${j.submittedUrl ?? ''} cần chỉnh lại các điểm sau:`, ...fix.map((r, i) => `${i + 1}. ${r.item}${r.at ? ` (phút ${r.at})` : ''}${r.note ? `: ${r.note}` : ''}`), j.reviewNote ?? '', 'Bạn sửa xong gửi lại link giúp mình nhé. Cảm ơn bạn!'].filter(Boolean).join('\n')
    : '';

  return (
    <>
      <Link href="/jobs" className="text-xs text-ink-3 hover:text-ink">← Job</Link>
      <div className="mt-2 mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar src={j.koc.avatarUrl} name={j.koc.nickname ?? j.koc.name} size={44} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold">{jobCode(j.number)}</h1>
              <span className={`pill ${STAGE_TONE[j.stage] ?? 'bg-sunken text-ink-2'}`}>{j.stage}</span>
              {j.reviewResult && <span className={`pill ${RESULT_TONE[j.reviewResult]}`}>Nghiệm thu: {j.reviewResult}</span>}
            </div>
            <p className="text-[13px] text-ink-2">
              <Link href={`/creator/${j.koc.handle}`} className="link">{j.koc.nickname ?? j.koc.name}</Link> (@{j.koc.handle}{kl ? ` · ${kl}` : ''}) · {j.brand?.name ?? 'chưa gắn brand'}{j.product ? ` · ${j.product.name}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {next && (
            <form action={moveStage}>
              <input type="hidden" name="id" value={j.id} /><input type="hidden" name="stage" value={next} />
              <button className="btn btn-primary">Chuyển sang &quot;{next}&quot;</button>
            </form>
          )}
          {j.stage !== CANCELLED && j.stage !== 'Thanh toán' && (
            <form action={moveStage}>
              <input type="hidden" name="id" value={j.id} /><input type="hidden" name="stage" value={CANCELLED} />
              <button className="btn">Huỷ job</button>
            </form>
          )}
        </div>
      </div>
      {err && <p role="alert" className="mb-3 rounded-md bg-critical-soft px-3 py-2 text-critical">{err}</p>}

      <ol className="mb-4 grid grid-cols-7 gap-1 text-center text-xs">
        {STAGES.map((s, i) => (
          <li key={s} title={STAGE_HINT[s]} className={`rounded px-1 py-1.5 ${i < stage ? 'bg-positive-soft text-positive' : i === stage ? 'bg-accent font-medium text-white' : 'bg-sunken text-ink-3'}`}>{s}</li>
        ))}
      </ol>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Thông tin job" meta={[j.listingItem && `từ listing "${j.listingItem.batch.name}"`, j.planLine && `plan "${j.planLine.plan.name}"`].filter(Boolean).join(' · ')}>
          <ActionForm action={updateJob} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="id" value={j.id} />
            <F label="PIC">
              <select name="picId" defaultValue={j.picId ?? ''} className="input">
                <option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.jobRole ? ` · ${u.jobRole}` : ''}</option>)}
              </select>
            </F>
            <F label="Sản phẩm">
              <select name="productId" defaultValue={j.productId ?? ''} className="input">
                <option value="">—</option>{j.brand?.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </F>
            <F label="Loại giá">
              <select name="priceType" defaultValue={j.priceType} className="input">{PRICE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </F>
            <F label={`Giá net (₫)${tier ? ` · khung ${kl}: ${fmtShort(tier.minPrice)}–${fmtShort(tier.maxPrice)}` : ''}`}>
              <input name="price" inputMode="numeric" defaultValue={j.price ?? ''} className={`input ${priceOut ? 'ring-2 ring-warning' : ''}`} />
              {priceOut && <span className="text-xs text-warning">Ngoài khung giá tier {kl}.</span>}
              {j.price != null && <span className="block text-xs text-ink-3">Nếu trả cho cá nhân, kèm thuế TNCN: {fmtVnd(Math.round(j.price / FEE_DIVISOR))}</span>}
            </F>
            <F label="Deadline air"><input name="deadline" type="date" defaultValue={iso(j.deadline)} className="input" /></F>
            <F label="Hàng mẫu">
              <select name="sample" defaultValue={j.sample ?? ''} className="input"><option value="">—</option>{SAMPLE.map((s) => <option key={s}>{s}</option>)}</select>
            </F>
            <F label="Link video KOC nộp" wide>
              <input name="submittedUrl" type="url" defaultValue={j.submittedUrl ?? ''} placeholder="https://www.tiktok.com/@.../video/..." className="input" />
              {j.submittedAt && <span className="text-xs text-ink-3">Nộp lúc {fmtTime(j.submittedAt)}</span>}
            </F>
            <F label="Ghi chú" wide><textarea name="note" rows={2} defaultValue={j.note ?? ''} className="input" /></F>
            <div className="col-span-full flex justify-end"><button className="btn btn-primary">Lưu</button></div>
          </ActionForm>
        </Section>

        <Section title="Brief" meta={j.briefApproved ? 'Đã duyệt, gửi KOC được' : j.brief ? 'Nháp, chưa duyệt' : 'Chưa có'}>
          <form action={saveBrief} className="grid gap-2">
            <input type="hidden" name="id" value={j.id} />
            <textarea name="brief" rows={14} defaultValue={j.brief ?? ''} placeholder="Bấm &quot;Tạo brief nháp&quot; để có bản đầu từ USP, guideline của brand và checklist nghiệm thu." className="input font-mono text-xs" />
            <div className="flex flex-wrap items-center justify-end gap-2">
              {j.brief && <CopyButton text={j.brief} />}
              <button formAction={draftBrief} formNoValidate className="btn h-8 px-3 text-xs">Tạo brief nháp</button>
              <button name="approve" value="" className="btn h-8 px-3 text-xs">Lưu nháp</button>
              <button name="approve" value="1" className="btn btn-primary h-8 px-3 text-xs">Duyệt brief</button>
            </div>
          </form>
        </Section>
      </div>

      <section id="review" className="mt-4 rounded-lg border border-line bg-surface px-5 py-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">Nghiệm thu</h2>
          <span className="text-xs text-ink-3">
            Checklist của {j.brand?.name ?? 'brand'}{j.brand?.checklist ? '' : ' (mặc định)'}
            {j.reviewedAt && ` · lần gần nhất ${fmtTime(j.reviewedAt)} bởi ${who.get(j.reviewedById ?? '') ?? '—'}`}
          </span>
        </div>
        {!j.submittedUrl ? (
          <p className="text-[13px] text-ink-3">KOC chưa nộp video. Nhập link video ở &quot;Thông tin job&quot;, job tự chuyển sang &quot;Đã nộp&quot;.</p>
        ) : (
          <form action={reviewJob} className="grid gap-3">
            <input type="hidden" name="id" value={j.id} />
            <p className="text-[13px]">Video: <a href={j.submittedUrl} target="_blank" rel="noreferrer" className="link break-all">{j.submittedUrl}</a></p>
            <table className="tbl">
              <thead><tr><th>Tiêu chí</th><th>Kết quả</th><th>Mốc trong video</th><th>Ghi chú / bằng chứng</th></tr></thead>
              <tbody>
                {checklist.map((c, i) => {
                  const old = review.find((r) => r.item === c);
                  return (
                    <tr key={c}>
                      <td className="text-[13px]">{c}</td>
                      <td>
                        <div className="flex gap-2 text-xs">
                          {RESULTS.map((r) => (
                            <label key={r} className="flex items-center gap-1"><input type="radio" name={`r${i}`} value={r} required defaultChecked={old?.result === r} />{r}</label>
                          ))}
                        </div>
                      </td>
                      <td><input name={`t${i}`} defaultValue={old?.at ?? ''} placeholder="0:15" aria-label={`Mốc thời gian: ${c}`} className="input h-7 w-20 text-xs" /></td>
                      <td><input name={`n${i}`} defaultValue={old?.note ?? ''} aria-label={`Ghi chú: ${c}`} className="input h-7 text-xs" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <textarea name="reviewNote" rows={2} defaultValue={j.reviewNote ?? ''} placeholder="Nhận xét chung (gửi kèm yêu cầu sửa)" className="input text-[13px]" />
            <div className="flex items-center justify-end gap-3">
              <span className="text-xs text-ink-3">Có tiêu chí &quot;Không đạt&quot; → Không đạt; có &quot;Cần sửa&quot; → Cần sửa (job về &quot;Đang quay&quot;); tất cả &quot;Đạt&quot; → chờ đề nghị thanh toán.</span>
              <button className="btn btn-primary">Xác nhận nghiệm thu</button>
            </div>
          </form>
        )}
        {fixText && (
          <div className="mt-3 rounded-md bg-warning-soft px-3 py-2">
            <div className="mb-1 flex items-center justify-between gap-2 text-[13px] font-medium text-warning">Yêu cầu sửa gửi KOC (chép, gửi qua Zalo / TikTok) <CopyButton text={fixText} /></div>
            <pre className="text-xs whitespace-pre-wrap text-ink">{fixText}</pre>
          </div>
        )}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Thanh toán">
          {j.payment ? (
            <p className="text-[13px]">Trong <Link href={`/payments/${j.payment.id}`} className="link">ĐNTT #{j.payment.number}</Link> · {j.payment.status}</p>
          ) : j.stage === 'Nghiệm thu' ? (
            <p className="text-[13px]">Nghiệm thu đạt. Vào <Link href="/payments?new=1" className="link">Thanh toán</Link> để gom vào đề nghị thanh toán.</p>
          ) : (
            <p className="text-[13px] text-ink-3">Chỉ job nghiệm thu Đạt mới vào đề nghị thanh toán.</p>
          )}
          <p className="mt-1 text-xs text-ink-3">Giá {fmtNum(j.price)} ₫{j.price != null ? ` · nếu trả cá nhân, kèm thuế TNCN ${fmtNum(Math.round(j.price / FEE_DIVISOR))} ₫` : ''}{j.koc.bankAccount ? ` · TK ${j.koc.bankName ?? ''}` : ' · KOC chưa có thông tin tài khoản'}</p>
        </Section>
        <Section title="Lịch sử thay đổi">
          <ol className="space-y-1 text-xs">
            {logs.map((l) => <li key={l.id}><span className="text-ink-3">{fmtTime(l.at)} · {who.get(l.userId ?? '') ?? 'Hệ thống'}:</span> {l.action}</li>)}
            {!logs.length && <li className="text-ink-3">Chưa có.</li>}
          </ol>
        </Section>
      </div>
    </>
  );
}

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface px-5 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-base font-semibold">{title}</h2>{meta && <span className="text-xs text-ink-3">{meta}</span>}</div>
      {children}
    </section>
  );
}

function F({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block ${wide ? 'col-span-full' : ''}`}><span className="label">{label}</span>{children}</label>;
}
