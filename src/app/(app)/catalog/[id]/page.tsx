import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, Avatar, Dialog } from '@/components/ui';
import { BRAND_ROLES, checklistOf } from '@/lib/catalog';
import { db } from '@/lib/db';
import { fmtNum, fmtPct, fmtVnd } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { addMember, deleteBrand, removeItem, saveBrand, saveProduct, saveStore } from '../actions';

type Search = { edit?: string; store?: string; product?: string };

export default async function BrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const canEdit = me.role !== 'STAFF';
  const b = await db.brand.findUnique({
    where: { id },
    include: {
      stores: { orderBy: { name: 'asc' } },
      products: { include: { store: true }, orderBy: { name: 'asc' } },
      members: { include: { user: { select: { id: true, name: true, avatarUrl: true, jobRole: true } } } },
      _count: { select: { jobs: true, planLines: true, briefs: true } },
    },
  });
  if (!b) notFound();
  const [users, bookings] = await Promise.all([
    canEdit ? db.user.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, jobRole: true } }) : [],
    db.booking.count({ where: { brand: { equals: b.name, mode: 'insensitive' } } }),
  ]);
  type StoreRow = (typeof b.stores)[number];
  type ProductRow = (typeof b.products)[number];
  const editingStore: Partial<StoreRow> | undefined = sp.store === 'new' ? {} : b.stores.find((s) => s.id === sp.store);
  const editingProduct: Partial<ProductRow> | undefined = sp.product === 'new' ? {} : b.products.find((p) => p.id === sp.product);
  const close = `/catalog/${b.id}`;
  const checklist = checklistOf(b.checklist);

  return (
    <>
      <Link href="/catalog" className="text-xs text-ink-3 hover:text-ink">← Danh mục</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar src={b.logoUrl} name={b.name} size={48} />
          <div>
            <h1 className="text-xl font-semibold">{b.name}</h1>
            <p className="text-xs text-ink-3">{b.stores.length} gian hàng · {b.products.length} sản phẩm · {b._count.jobs} job · {fmtNum(bookings)} booking trên Lark</p>
          </div>
        </div>
        {canEdit && <Link href="?edit=1" className="btn">Sửa brand</Link>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="USP"><Text v={b.usp} empty="Chưa có USP. Matching và brief dùng USP này." /></Card>
        <Card title="Brand guideline"><Text v={b.guideline} empty="Chưa có guideline (link tài liệu + tone, từ cấm, claim được phép)." /></Card>
        <Card title={`Checklist nghiệm thu${b.checklist ? '' : ' (mặc định)'}`}>
          <ol className="list-decimal space-y-0.5 pl-5 text-[13px]">{checklist.map((c) => <li key={c}>{c}</li>)}</ol>
        </Card>
      </div>

      <Section title="Gian hàng" action={canEdit && <Link href="?store=new" className="btn h-8 px-3 text-xs">Thêm gian hàng</Link>}>
        <table className="tbl">
          <thead><tr><th>Gian hàng</th><th>Sàn</th><th className="text-right">CR</th><th className="text-right">AOV</th><th /></tr></thead>
          <tbody>
            {b.stores.map((s) => (
              <tr key={s.id}>
                <td>{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="link">{s.name}</a> : s.name}</td>
                <td>{s.platform}</td>
                <td className="text-right">{s.cr == null ? '—' : fmtPct(s.cr)}</td>
                <td className="text-right">{fmtVnd(s.aov)}</td>
                <td className="text-right">{canEdit && <Link href={`?store=${s.id}`} className="link">Sửa</Link>}</td>
              </tr>
            ))}
            {!b.stores.length && <tr><td colSpan={5} className="py-6 text-center text-ink-3">Chưa có gian hàng.</td></tr>}
          </tbody>
        </table>
      </Section>

      <Section title="Sản phẩm" action={canEdit && <Link href="?product=new" className="btn h-8 px-3 text-xs">Thêm sản phẩm</Link>}>
        <table className="tbl">
          <thead><tr><th>Sản phẩm</th><th>Gian hàng</th><th>USP</th><th className="text-right">Giá</th><th /></tr></thead>
          <tbody>
            {b.products.map((p) => (
              <tr key={p.id} className="align-top">
                <td>
                  <div className="flex items-center gap-2">
                    {p.imageUrl ? <img src={p.imageUrl} alt="" className="size-10 rounded object-cover" /> : <span className="size-10 rounded bg-sunken" />}
                    {p.link ? <a href={p.link} target="_blank" rel="noreferrer" className="link">{p.name}</a> : p.name}
                  </div>
                </td>
                <td>{p.store?.name ?? '—'}</td>
                <td className="max-w-80 text-xs whitespace-pre-line">{p.usp ?? '—'}</td>
                <td className="text-right">{fmtVnd(p.price)}</td>
                <td className="text-right">{canEdit && <Link href={`?product=${p.id}`} className="link">Sửa</Link>}</td>
              </tr>
            ))}
            {!b.products.length && <tr><td colSpan={5} className="py-6 text-center text-ink-3">Chưa có sản phẩm.</td></tr>}
          </tbody>
        </table>
      </Section>

      <Section title="Nhân sự phụ trách">
        <ul className="mb-3 flex flex-wrap gap-2">
          {b.members.map((m) => (
            <li key={m.userId + m.role} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[13px]">
              <Avatar src={m.user.avatarUrl} name={m.user.name} size={22} />
              {m.user.name ?? '—'} <span className="pill bg-sunken text-ink-2">{m.role}</span>
              {canEdit && (
                <form action={removeItem}>
                  <input type="hidden" name="brandId" value={b.id} /><input type="hidden" name="kind" value="member" /><input type="hidden" name="id" value={`${m.userId}|${m.role}`} />
                  <button className="text-ink-3 hover:text-critical" aria-label={`Bỏ ${m.user.name}`}>✕</button>
                </form>
              )}
            </li>
          ))}
          {!b.members.length && <li className="text-[13px] text-ink-3">Chưa giao nhân sự.</li>}
        </ul>
        {canEdit && (
          <form action={addMember} className="flex flex-wrap gap-2">
            <input type="hidden" name="brandId" value={b.id} />
            <select name="userId" required aria-label="Nhân sự" className="input h-8 w-56 text-[13px]">
              <option value="">— Chọn nhân sự —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.id}{u.jobRole ? ` · ${u.jobRole}` : ''}</option>)}
            </select>
            <select name="role" aria-label="Vai trò trên brand" className="input h-8 w-44 text-[13px]">{BRAND_ROLES.map((r) => <option key={r}>{r}</option>)}</select>
            <button className="btn h-8 px-3 text-xs">Giao</button>
          </form>
        )}
      </Section>

      {sp.edit && canEdit && (
        <Dialog title={`Sửa ${b.name}`} closeHref={close}>
          <ActionForm action={saveBrand} className="grid gap-4">
            <input type="hidden" name="id" value={b.id} />
            <F label="Tên brand"><input name="name" required defaultValue={b.name} className="input" /></F>
            <F label="Link logo"><input name="logoUrl" type="url" defaultValue={b.logoUrl ?? ''} className="input" /></F>
            <F label="USP"><textarea name="usp" rows={3} defaultValue={b.usp ?? ''} className="input" /></F>
            <F label="Brand guideline (link tài liệu + điểm chính)"><textarea name="guideline" rows={4} defaultValue={b.guideline ?? ''} className="input" /></F>
            <F label="Checklist nghiệm thu (mỗi dòng một tiêu chí; trống = dùng mặc định)">
              <textarea name="checklist" rows={6} defaultValue={b.checklist ?? ''} placeholder={checklist.join('\n')} className="input" />
            </F>
            <F label="Ghi chú"><textarea name="note" rows={2} defaultValue={b.note ?? ''} className="input" /></F>
            <div className="flex justify-end gap-2"><Link href={close} className="btn">Hủy</Link><button className="btn btn-primary">Lưu</button></div>
          </ActionForm>
          {me.role === 'ADMIN' && !b._count.jobs && !b._count.planLines && !b._count.briefs && (
            <form action={deleteBrand} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="id" value={b.id} />
              <button className="btn btn-danger">Xoá brand</button>
            </form>
          )}
        </Dialog>
      )}

      {editingStore && canEdit && (
        <Dialog title={editingStore.id ? 'Sửa gian hàng' : 'Thêm gian hàng'} closeHref={close}>
          <ActionForm action={saveStore} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={editingStore.id ?? ''} />
            <input type="hidden" name="brandId" value={b.id} />
            <F label="Tên gian hàng" wide><input name="name" required defaultValue={editingStore.name ?? ''} className="input" /></F>
            <F label="Sàn"><input name="platform" defaultValue={editingStore.platform ?? 'TikTok Shop'} className="input" /></F>
            <F label="Link gian hàng"><input name="url" type="url" defaultValue={editingStore.url ?? ''} className="input" /></F>
            <F label="CR (%)"><input name="cr" inputMode="decimal" defaultValue={editingStore.cr != null ? String(+(editingStore.cr * 100).toFixed(4)) : ''} className="input" /></F>
            <F label="AOV (₫)"><input name="aov" inputMode="numeric" defaultValue={editingStore.aov ?? ''} className="input" /></F>
            <div className="col-span-full flex justify-end gap-2"><Link href={close} className="btn">Hủy</Link><button className="btn btn-primary">Lưu</button></div>
          </ActionForm>
          {editingStore.id && (
            <form action={removeItem} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="brandId" value={b.id} /><input type="hidden" name="kind" value="store" /><input type="hidden" name="id" value={editingStore.id} />
              <button className="btn btn-danger">Xoá gian hàng</button>
            </form>
          )}
        </Dialog>
      )}

      {editingProduct && canEdit && (
        <Dialog title={editingProduct.id ? 'Sửa sản phẩm' : 'Thêm sản phẩm'} closeHref={close}>
          <ActionForm action={saveProduct} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={editingProduct.id ?? ''} />
            <input type="hidden" name="brandId" value={b.id} />
            <F label="Tên sản phẩm" wide><input name="name" required defaultValue={editingProduct.name ?? ''} className="input" /></F>
            <F label="Gian hàng">
              <select name="storeId" defaultValue={editingProduct.storeId ?? ''} className="input">
                <option value="">—</option>
                {b.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </F>
            <F label="Giá bán (₫)"><input name="price" inputMode="numeric" defaultValue={editingProduct.price ?? ''} className="input" /></F>
            <F label="Link ảnh"><input name="imageUrl" type="url" defaultValue={editingProduct.imageUrl ?? ''} className="input" /></F>
            <F label="Link sản phẩm"><input name="link" type="url" defaultValue={editingProduct.link ?? ''} className="input" /></F>
            <F label="USP sản phẩm" wide><textarea name="usp" rows={3} defaultValue={editingProduct.usp ?? ''} className="input" /></F>
            <div className="col-span-full flex justify-end gap-2"><Link href={close} className="btn">Hủy</Link><button className="btn btn-primary">Lưu</button></div>
          </ActionForm>
          {editingProduct.id && (
            <form action={removeItem} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="brandId" value={b.id} /><input type="hidden" name="kind" value="product" /><input type="hidden" name="id" value={editingProduct.id} />
              <button className="btn btn-danger">Xoá sản phẩm</button>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface px-4 py-3">
      <h2 className="mb-1.5 text-[13px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Text({ v, empty }: { v: string | null; empty: string }) {
  if (!v) return <p className="text-[13px] text-warning">{empty}</p>;
  return (
    <p className="text-[13px] whitespace-pre-line">
      {v.split(/(https?:\/\/\S+)/).map((x, i) => (/^https?:\/\//.test(x) ? <a key={i} href={x} target="_blank" rel="noreferrer" className="link break-all">{x}</a> : x))}
    </p>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-lg border border-line bg-surface px-5 py-4">
      <div className="mb-2 flex items-center justify-between gap-2"><h2 className="text-base font-semibold">{title}</h2>{action}</div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function F({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block ${wide ? 'col-span-full' : ''}`}><span className="label">{label}</span>{children}</label>;
}
