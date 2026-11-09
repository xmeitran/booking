import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtNum, fmtPct, fmtShort } from '@/lib/format';
import { CANCELLED, jobCode } from '@/lib/jobs';
import { PRICE_TYPES } from '@/lib/listing';
import { fromLark } from '@/lib/planSync';
import { jobScope, lineScope, planScope, scopeOf } from '@/lib/scope';
import { can, requireUser } from '@/lib/session';
import { KL_LEVELS } from '../../contacts/platforms';
import { deletePlan, matchFromLine, removeLine, savePlan, saveLine } from '../actions';

type Search = { line?: string; edit?: string };

export default async function PlanPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const canEdit = can(me, 'plan.edit');
  const scope = await scopeOf(me);
  const plan = await db.plan.findFirst({
    where: { id, AND: [planScope(scope)] },
    include: {
      lines: {
        where: lineScope(scope),
        include: {
          brand: true, product: true, pic: { select: { name: true } }, briefs: { select: { id: true }, take: 1 },
          jobs: { where: { stage: { not: CANCELLED } }, select: { id: true, price: true, stage: true } },
        },
        orderBy: [{ week: 'asc' }, { brand: { name: 'asc' } }],
      },
    },
  });
  if (!plan) notFound();
  const [brands, users, prices, outside] = await Promise.all([
    canEdit ? db.brand.findMany({ orderBy: { name: 'asc' }, include: { products: { select: { id: true, name: true }, orderBy: { name: 'asc' } } } }) : [],
    canEdit ? db.user.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, jobRole: true } }) : [],
    db.tierPrice.findMany(),
    // Job từ listing của plan này nhưng không khớp tier nào của brand trong plan (book ngoài plan).
    db.job.findMany({
      where: { planLineId: null, stage: { not: CANCELLED }, listingItem: { batch: { planLineId: { in: plan.lines.map((l) => l.id) } } }, AND: [jobScope(scope)] },
      select: { id: true, number: true, price: true, stage: true, brand: { select: { name: true } }, koc: { select: { handle: true, kl: true, klAuto: true } } },
      orderBy: { number: 'asc' },
    }),
  ]);
  // Plan / dòng từ Lark Base chỉ sửa trên Lark (đồng bộ ghi đè); vẫn thêm được dòng tay vào plan Lark.
  const editing = sp.line === 'new' ? null : plan.lines.find((l) => l.id === sp.line && !fromLark(l.id));
  const lineOpen = canEdit && (sp.line === 'new' || editing);
  const qty = plan.lines.reduce((s, l) => s + l.quantity, 0);
  const jobs = plan.lines.flatMap((l) => l.jobs);
  const budget = (!scope && plan.budget) || plan.lines.reduce((s, l) => s + (l.budget ?? 0), 0);
  const spent = [...jobs, ...outside].reduce((s, j) => s + (j.price ?? 0), 0);
  const priceHint = (tier: string | null, type: string) => {
    const p = prices.find((x) => x.tier === tier && x.priceType === (/live/i.test(type) ? 'Phiên livestream' : 'Video'));
    return p ? `${fmtShort(p.minPrice)}–${fmtShort(p.maxPrice)} / KOC` : null;
  };
  const close = `/plan/${plan.id}`;

  return (
    <>
      <Link href="/plan" className="text-xs text-ink-3 hover:text-ink">← Plan</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{plan.name}</h1>
          <p className="text-xs text-ink-3">Tháng {plan.month.split('-').reverse().join('/')}{plan.note ? ` · ${plan.note}` : ''}</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {!fromLark(plan.id) && <Link href="?edit=1" className="btn">Sửa plan</Link>}
            <Link href="?line=new" className="btn btn-primary">Thêm dòng</Link>
          </div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="KOC cần book" value={fmtNum(qty)} sub={`${plan.lines.length} dòng chi tiết`} />
        <Kpi label="Đã có job" value={fmtNum(jobs.length)} sub={[qty ? `${fmtPct(jobs.length / qty, 0)} plan` : '', outside.length ? `+${outside.length} job ngoài plan` : ''].filter(Boolean).join(' · ') || undefined} />
        <Kpi label="Ngân sách" value={budget ? `${fmtShort(budget)} ₫` : 'Chưa nhập'} sub={!scope && plan.budget ? 'Ngân sách tổng' : 'Cộng từ các dòng'} />
        <Kpi label="Đã chốt (giá job)" value={spent ? `${fmtShort(spent)} ₫` : '0 ₫'} sub={budget ? (spent > budget ? `Vượt ngân sách ${fmtShort(spent - budget)} ₫` : `Còn ${fmtShort(budget - spent)} ₫`) : undefined} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr><th>Tuần</th><th>Brand · sản phẩm</th><th>Tier</th><th>Content</th><th className="text-right">SL</th><th className="text-right">Ngân sách</th><th>PIC</th><th>Tiến độ</th><th /></tr>
          </thead>
          <tbody>
            {plan.lines.map((l) => {
              const done = l.jobs.length;
              return (
                <tr key={l.id} className="align-top">
                  <td>{l.week ? `T${l.week}` : '—'}</td>
                  <td>
                    {l.brand ? <Link href={`/catalog/${l.brand.id}`} className="font-medium hover:underline">{l.brand.name}</Link> : '—'}
                    {l.product && <div className="text-xs text-ink-3">{l.product.name}</div>}
                    {l.note && <div className="text-xs text-ink-3">{l.note}</div>}
                  </td>
                  <td>{l.tier ?? '—'}</td>
                  <td>{l.contentType}</td>
                  <td className="text-right tabular-nums">{l.quantity}</td>
                  <td className="text-right tabular-nums">
                    {fmtShort(l.budget)}
                    {priceHint(l.tier, l.contentType) && <div className="text-xs text-ink-3">Giá tier {priceHint(l.tier, l.contentType)}</div>}
                  </td>
                  <td>{l.pic?.name ?? <span className="text-warning">Chưa giao</span>}</td>
                  <td className="min-w-32">
                    <div className="h-1.5 rounded bg-sunken"><div className="h-1.5 rounded bg-accent" style={{ width: `${l.quantity ? Math.min(100, (done / l.quantity) * 100) : 0}%` }} /></div>
                    <div className="mt-0.5 text-xs text-ink-3">
                      <Link href={`/jobs?line=${l.id}`} className="hover:underline">{done}/{l.quantity} job</Link>
                      {l.jobs.length > 0 && ` · ${fmtShort(l.jobs.reduce((s, j) => s + (j.price ?? 0), 0))} ₫`}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <form action={matchFromLine} className="inline">
                      <input type="hidden" name="id" value={l.id} />
                      <button className="link">{l.briefs[0] ? 'Mở matching' : 'Tìm KOC'}</button>
                    </form>
                    {canEdit && !fromLark(l.id) && <Link href={`?line=${l.id}`} className="link ml-3">Sửa</Link>}
                  </td>
                </tr>
              );
            })}
            {!plan.lines.length && <tr><td colSpan={9} className="py-12 text-center text-ink-3">Chưa có dòng chi tiết. Bấm &quot;Thêm dòng&quot;.</td></tr>}
          </tbody>
        </table>
      </div>

      {outside.length > 0 && (
        <section className="mt-4 rounded-lg border border-line bg-surface px-4 py-3 text-[13px]">
          <h2 className="font-medium">Job ngoài plan · {outside.length} · {fmtShort(outside.reduce((s, j) => s + (j.price ?? 0), 0))} ₫</h2>
          <p className="mb-2 text-xs text-ink-3">Tạo từ listing của plan này nhưng tier KOC không có dòng nào cùng brand trong plan. Thêm dòng plan đúng tier nếu cần theo dõi.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {outside.map((j) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="hover:underline">
                <span className="font-mono text-xs text-accent">{jobCode(j.number)}</span> {j.brand?.name} · @{j.koc.handle} · {j.koc.kl ?? j.koc.klAuto ?? 'chưa có tier'} · {fmtShort(j.price)}
              </Link>
            ))}
          </div>
        </section>
      )}

      {lineOpen && (
        <Dialog title={editing ? 'Sửa dòng plan' : 'Thêm dòng plan'} closeHref={close}>
          <ActionForm action={saveLine} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={editing?.id ?? ''} />
            <input type="hidden" name="planId" value={plan.id} />
            <F label="Brand">
              <select name="brandId" required defaultValue={editing?.brandId ?? ''} className="input">
                <option value="">— Chọn brand —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </F>
            <F label="Sản phẩm">
              <select name="productId" defaultValue={editing?.productId ?? ''} className="input">
                <option value="">—</option>
                {brands.flatMap((b) => b.products.map((p) => <option key={p.id} value={p.id}>{b.name} · {p.name}</option>))}
              </select>
            </F>
            <F label="Tuần trong tháng (1–5)"><input name="week" inputMode="numeric" defaultValue={editing?.week ?? ''} className="input" /></F>
            <F label="Tier KOC">
              <select name="tier" defaultValue={editing?.tier ?? ''} className="input"><option value="">Bất kỳ</option>{KL_LEVELS.map((t) => <option key={t}>{t}</option>)}</select>
            </F>
            <F label="Loại content">
              <select name="contentType" defaultValue={editing?.contentType ?? 'Video'} className="input">{PRICE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            </F>
            <F label="Số KOC cần book (0 = chỉ giữ ngân sách)"><input name="quantity" inputMode="numeric" required defaultValue={editing?.quantity ?? 1} className="input" /></F>
            <F label="Ngân sách dòng (₫)"><input name="budget" inputMode="numeric" defaultValue={editing?.budget ?? ''} className="input" /></F>
            <F label="PIC (trống = Booking PIC của brand)">
              <select name="picId" defaultValue={editing?.picId ?? ''} className="input">
                <option value="">—</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.id}{u.jobRole ? ` · ${u.jobRole}` : ''}</option>)}
              </select>
            </F>
            <F label="Ghi chú" wide><input name="note" defaultValue={editing?.note ?? ''} className="input" /></F>
            <div className="col-span-full flex justify-end gap-2"><Link href={close} className="btn">Hủy</Link><button className="btn btn-primary">Lưu</button></div>
          </ActionForm>
          {editing && (
            <form action={removeLine} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="id" value={editing.id} />
              <button className="btn btn-danger">Xoá dòng</button>
            </form>
          )}
        </Dialog>
      )}

      {sp.edit && canEdit && !fromLark(plan.id) && (
        <Dialog title="Sửa plan" closeHref={close}>
          <ActionForm action={savePlan} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={plan.id} />
            <F label="Tên plan" wide><input name="name" required defaultValue={plan.name} className="input" /></F>
            <F label="Tháng"><input name="month" type="month" required defaultValue={plan.month} className="input" /></F>
            <F label="Ngân sách tổng (₫)"><input name="budget" inputMode="numeric" defaultValue={plan.budget ?? ''} className="input" /></F>
            <F label="Ghi chú" wide><textarea name="note" rows={2} defaultValue={plan.note ?? ''} className="input" /></F>
            <div className="col-span-full flex justify-end gap-2"><Link href={close} className="btn">Hủy</Link><button className="btn btn-primary">Lưu</button></div>
          </ActionForm>
          <form action={deletePlan} className="mt-4 border-t border-line pt-4">
            <input type="hidden" name="id" value={plan.id} />
            <button className="btn btn-danger">Xoá plan</button>
          </form>
        </Dialog>
      )}
    </>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <div className="text-xs text-ink-3">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function F({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block ${wide ? 'col-span-full' : ''}`}><span className="label">{label}</span>{children}</label>;
}
