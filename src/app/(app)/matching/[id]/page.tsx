import Link from 'next/link';
import { sameBrand } from '@/lib/listing';
import { notFound } from 'next/navigation';
import { ActionForm, Avatar, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtNum, fmtPct, fmtShort } from '@/lib/format';
import { profileInsights, USD_VND } from '@/lib/kocInsights';
import { describe, matchKocs, TIKTOK_CATEGORIES, type Criteria } from '@/lib/matching';
import { listingScope, scopeOf } from '@/lib/scope';
import { can, requireUser } from '@/lib/session';
import { addMatchesToListing, decideKoc, deleteBrief } from '../actions';
import { BriefForm } from '../BriefForm';

const SHOW = 200;
const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);

/** Chữ thường + link bấm được (guideline / strategy / plan hay dán link Lark, Drive). */
function Rich({ text }: { text: string }) {
  return (
    <p className="text-[13px] whitespace-pre-line">
      {text.split(/(https?:\/\/\S+)/).map((part, i) =>
        /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer" className="link break-all">{part}</a> : part,
      )}
    </p>
  );
}

export default async function BriefPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; need?: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const { edit, need } = await searchParams;
  const b = await db.matchBrief.findUnique({ where: { id }, include: { createdBy: { select: { name: true } }, planLine: { include: { plan: { select: { id: true, name: true } } } }, decisions: true } });
  if (!b) notFound();
  const c = b.criteria as Criteria;
  const [matches, allBatches, niches, cats, brands] = await Promise.all([
    matchKocs(c, b.brand),
    db.listingBatch.findMany({ where: listingScope(await scopeOf(me)), orderBy: { updatedAt: 'desc' }, take: 200, select: { id: true, name: true, brand: true, month: true } }),
    edit ? db.koc.findMany({ where: { niche: { not: null } }, distinct: ['niche'], select: { niche: true }, orderBy: { niche: 'asc' } }) : [],
    edit ? db.matchBrief.findMany({ where: { category: { not: null } }, distinct: ['category'], select: { category: true } }) : [],
    edit && !b.template ? db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }) : [],
  ]);
  // Chọn / loại: KOC đã loại ẩn khỏi danh sách (xem ở mục Đã loại), KOC đã chọn lên đầu và được tick sẵn để đưa vào listing.
  const decisionOf = new Map(b.decisions.map((d) => [d.kocId, d]));
  const [rejectedKocs, deciders] = await Promise.all([
    db.koc.findMany({ where: { id: { in: b.decisions.filter((d) => d.decision === 'reject').map((d) => d.kocId) } }, select: { id: true, handle: true, name: true, nickname: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(b.decisions.map((d) => d.byId))] } }, select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(deciders.map((u) => [u.id, u.name]));
  const visible = matches.filter((m) => decisionOf.get(m.koc.id)?.decision !== 'reject')
    .sort((x, y) => Number(decisionOf.get(y.koc.id)?.decision === 'pick') - Number(decisionOf.get(x.koc.id)?.decision === 'pick'));
  const picked = b.decisions.filter((d) => d.decision === 'pick').length;
  const shown = visible.slice(0, SHOW);
  // Đợt có sẵn: chỉ đợt cùng brand với brief (hoặc đợt chưa ghi brand); brief chưa có brand thì hiện mọi đợt.
  const batches = allBatches.filter((x) => !b.brand || !x.brand || sameBrand(x.brand, b.brand)).slice(0, 30);
  const docs = ([['Brand guideline', b.guideline], ['Content strategy', b.strategy], ['Content plan', b.plan], [b.template ? 'Best practice' : 'Ghi chú', b.note]] as const).filter(([, v]) => v);
  const chips = describe(c);
  const withStats = matches.filter((m) => m.koc.statsAt).length;
  const canDelete = can(me, 'brief.deleteAny') || b.createdById === me.id;

  return (
    <>
      <Link href="/matching" className="text-xs text-ink-3 hover:text-ink">← Creator matching</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{b.name}</h1>
            <span className={`pill ${b.template ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-2'}`}>{b.template ? 'Best practice ngành hàng' : 'Brief brand'}</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-3">
            {[b.brand, b.category, `tạo bởi ${b.createdBy.name ?? '—'}`].filter(Boolean).join(' · ')}
            {b.planLine && <> · từ plan <Link href={`/plan/${b.planLine.plan.id}`} className="link">{b.planLine.plan.name}</Link> (cần {b.planLine.quantity} KOC)</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {b.template && <Link href={`/matching?new=brief&from=${b.id}`} className="btn">Tạo brief từ best practice này</Link>}
          {can(me, 'data.export') && <a href={`/matching/${b.id}/export`} className="btn">Tải Excel KOC khớp</a>}
          <Link href="?edit=1" className="btn">Sửa</Link>
        </div>
      </div>

      {docs.length > 0 && (
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          {docs.map(([label, text]) => (
            <section key={label} className="rounded-lg border border-line bg-surface px-4 py-3">
              <h2 className="mb-1 text-[13px] font-semibold">{label}</h2>
              <Rich text={text!} />
            </section>
          ))}
        </div>
      )}

      <div className="mb-3 rounded-lg border border-line bg-surface px-4 py-3">
        <div className="mb-1.5 text-[13px] font-semibold">Bộ tiêu chí</div>
        <div className="flex flex-wrap gap-1">
          {chips.length ? chips.map((x) => <span key={x} className="pill bg-sunken text-ink-2">{x}</span>) : <span className="text-xs text-ink-3">Chưa đặt tiêu chí: đang hiện mọi KOC, xếp theo số món bán.</span>}
        </div>
      </div>

      <ActionForm action={addMatchesToListing}>
        <input type="hidden" name="briefId" value={b.id} />
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold">KOC khớp · {fmtNum(visible.length)} <span className="text-[13px] font-normal text-ink-2">· đã chọn {picked} · đã loại {rejectedKocs.length}</span></h2>
          <span className="text-xs text-ink-3">
            {fmtNum(withStats)} có số TikTok. KOC thiếu số liệu không bị loại, chỉ xếp sau.{visible.length > SHOW && ` Hiện ${SHOW} KOC đầu; tải Excel để xem đủ.`}
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="tbl">
            <thead>
              <tr>
                <th className="w-8" /><th>KOC</th><th className="text-right">Follower</th><th className="text-right">View TB</th><th className="text-right">Món bán</th>
                <th className="text-right">GPM</th><th className="text-right">Nữ</th><th className="text-right">Giá gần nhất</th><th>Khớp tiêu chí</th><th>Chọn / loại</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((m) => {
                const k = m.koc;
                const d = decisionOf.get(k.id);
                const fid = `d-${k.id}`;
                const p = profileInsights(k.ttsProfile);
                const unknown = m.checks.filter((x) => x.ok === null).map((x) => x.label);
                return (
                  <tr key={k.id} id={`k-${k.id}`} className={`align-top ${d?.decision === 'pick' ? 'bg-positive-soft/40' : ''}`}>
                    <td><input type="checkbox" name="kocId" value={k.id} defaultChecked={d?.decision === 'pick'} aria-label={`Tick @${k.handle} để đưa vào listing`} /></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <Avatar src={k.avatarUrl} name={k.nickname ?? k.name} size={28} />
                        <div className="min-w-0">
                          <Link href={`/contacts/${k.id}`} className="font-medium hover:text-accent hover:underline">{k.nickname ?? k.name}</Link>
                          <div className="text-xs text-ink-3">@{k.handle}{(k.kl ?? k.klAuto) && ` · ${k.kl ?? k.klAuto}`}{k.niche && ` · ${k.niche}`}{k.bookingCount > 0 && ` · ${k.bookingCount} booking`}</div>
                          {m.brandBookings > 0 && <span className="pill mt-0.5 bg-warning-soft text-warning">Đã book {b.brand} {m.brandBookings} lần{m.brandLastMonth && `, gần nhất ${m.brandLastMonth}`}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="text-right tabular-nums">{fmtShort(k.followers)}</td>
                    <td className="text-right tabular-nums">{fmtShort(k.avgViews)}</td>
                    <td className="text-right tabular-nums">{fmtShort(k.unitsSold)}</td>
                    <td className="text-right tabular-nums">{k.gpmUsd == null ? '—' : fmtShort(k.gpmUsd * USD_VND)}</td>
                    <td className="text-right tabular-nums">{fmtPct(p.female, 0)}</td>
                    <td className="text-right tabular-nums">{fmtShort(m.lastPrice)}</td>
                    <td className="text-xs">
                      {m.checks.length ? (
                        <>
                          <span className={`font-medium ${unknown.length ? '' : 'text-positive'}`}>{m.passed}/{m.checks.length} đạt</span>
                          {unknown.length > 0 && <div className="max-w-48 text-ink-3">Chưa rõ: {unknown.join(', ')}</div>}
                        </>
                      ) : '—'}
                    </td>
                    <td className="min-w-56 text-xs">
                      {d?.decision === 'pick' ? (
                        <span className="flex items-center gap-2">
                          <span className="pill bg-positive-soft text-positive">Đã chọn · {nameOf.get(d.byId) ?? '—'}</span>
                          <button form={fid} name="decision" value="clear" formNoValidate className="link">Bỏ</button>
                        </span>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button form={fid} name="decision" value="pick" formNoValidate className="btn h-7 px-2 text-xs">Chọn</button>
                          <input form={fid} name="reason" required placeholder="Lý do loại" aria-label={`Lý do loại @${k.handle}`} className={`input h-7 w-32 px-1.5 text-xs ${need === k.id ? 'ring-2 ring-critical' : ''}`} />
                          <button form={fid} name="decision" value="reject" className="btn h-7 px-2 text-xs">Loại</button>
                          {need === k.id && <span className="w-full text-critical">Ghi lý do trước khi loại.</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!visible.length && <tr><td colSpan={10} className="py-12 text-center text-ink-3">Không KOC nào đạt bộ tiêu chí. Nới tiêu chí bằng nút Sửa.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-3">
          <label className="min-w-56 flex-1">
            <span className="label">Thêm KOC đã tick vào listing</span>
            <select name="batchId" defaultValue="" className="input">
              <option value="">— Chọn đợt listing —</option>
              <option value="new">+ Tạo đợt mới</option>
              {batches.map((x) => <option key={x.id} value={x.id}>{x.name}{x.brand ? ` · ${x.brand}` : ''} · {x.month}</option>)}
            </select>
          </label>
          <label className="min-w-48 flex-1">
            <span className="label">Tên đợt mới (nếu tạo mới)</span>
            <input name="newName" defaultValue={b.brand ? `${b.brand} – ${b.name}` : b.name} className="input" />
          </label>
          <label>
            <span className="label">Tháng</span>
            <input name="month" type="month" defaultValue={thisMonth()} className="input" />
          </label>
          <button className="btn btn-primary">Thêm vào listing</button>
        </div>
      </ActionForm>
      {/* Form chọn / loại của từng dòng nằm ngoài form "Thêm vào listing" (HTML không cho form lồng nhau); nút trong bảng gắn bằng thuộc tính form. */}
      {[...shown.map((m) => m.koc.id), ...rejectedKocs.map((k) => k.id)].map((kid) => (
        <form key={kid} id={`d-${kid}`} action={decideKoc} hidden>
          <input type="hidden" name="briefId" value={b.id} />
          <input type="hidden" name="kocId" value={kid} />
        </form>
      ))}

      {rejectedKocs.length > 0 && (
        <section className="mt-4 rounded-lg border border-line bg-surface px-5 py-4">
          <h2 className="mb-2 text-base font-semibold">Đã loại · {rejectedKocs.length}</h2>
          <table className="tbl">
            <thead><tr><th>KOC</th><th>Lý do loại</th><th>Người loại</th><th /></tr></thead>
            <tbody>
              {rejectedKocs.map((k) => {
                const d = decisionOf.get(k.id)!;
                return (
                  <tr key={k.id}>
                    <td><Link href={`/creator/${k.handle}`} className="link">{k.nickname ?? k.name}</Link> <span className="text-xs text-ink-3">@{k.handle}</span></td>
                    <td className="text-[13px]">{d.reason}</td>
                    <td className="text-xs text-ink-3">{nameOf.get(d.byId) ?? '—'} · {d.at.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</td>
                    <td className="text-right"><button form={`d-${k.id}`} name="decision" value="clear" className="link text-xs">Khôi phục</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink-3">Lý do loại được lưu để sau này chỉnh bộ tiêu chí (backtest).</p>
        </section>
      )}

      {edit && (
        <Dialog title={b.template ? 'Sửa best practice' : 'Sửa brief'} closeHref={`/matching/${b.id}`}>
          <BriefForm
            brief={b} template={b.template} criteria={c} cancel={`/matching/${b.id}`}
            niches={niches.map((n) => n.niche!)}
            categories={[...new Set([...TIKTOK_CATEGORIES, ...cats.map((x) => x.category!)])]}
            brands={brands}
          />
          {canDelete && (
            <form action={deleteBrief} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="id" value={b.id} />
              <button className="btn btn-danger">Xóa {b.template ? 'best practice' : 'brief'} này</button>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}
