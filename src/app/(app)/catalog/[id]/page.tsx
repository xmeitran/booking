import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, Avatar, Dialog } from '@/components/ui';
import { BRAND_ROLES, checklistOf } from '@/lib/booking/catalog';
import { db } from '@/lib/db';
import { fmtNum, fmtPct, fmtVnd } from '@/lib/format';
import { can, requireUser } from '@/lib/auth/session';
import { CATEGORY } from '@/lib/koc/kocInsights';
import { GROUP0, KL_LEVELS, KL_METRICS, parseRules, SCANDAL_LABEL } from '@/lib/matching/spec';
import { addMember, deleteBrand, removeItem, saveBrand, saveProduct, saveRules, saveStore } from '../actions';

type Search = { edit?: string; store?: string; product?: string; rules?: string };
const REUP = ['Shopee', 'Facebook', 'Instagram', 'Threads', 'YouTube'];

export default async function BrandPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const canEdit = can(me, 'catalog.edit');
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
  const editing = canEdit && (sp.edit || sp.product || sp.rules);
  const [users, bookings, niches, cats] = await Promise.all([
    db.user.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, jobRole: true } }),
    db.booking.count({ where: { brand: { equals: b.name, mode: 'insensitive' } } }),
    editing ? db.koc.findMany({ where: { niche: { not: null } }, distinct: ['niche'], select: { niche: true }, orderBy: { niche: 'asc' } }) : [],
    // Tên ngành trong tỷ trọng GMV của creator (kho dữ liệu) để brand chọn đúng tên khi khai ngành hàng.
    sp.edit && canEdit ? db.$queryRaw<{ name: string }[]>`select distinct e->>'name' as name from "WarehouseCreator", jsonb_array_elements(categories) e where categories is not null order by 1 limit 300` : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name ?? u.id]));
  const rules = parseRules(b.rules);
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

      <Section title="Hồ sơ brand cho Creator matching (Khối 1)" action={canEdit && <Link href="?edit=1" className="btn h-8 px-3 text-xs">Sửa</Link>}>
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <Info k="Ngành hàng (I-02)" v={b.category} hint="Thiếu: không lọc pool theo ngành, không chấm Niche & ngành" />
          <Info k="Ngành con UpBase (I-02)" v={b.subCategory} hint="Dùng cho K7" />
          <Info k="Nhóm brand / tập đoàn (I-03)" v={b.group} hint="Thiếu: K7 chỉ xét ngành con" />
          <Info k="TA chính (I-04)" v={b.audience} />
          <Info k="Mood & tone (I-05)" v={b.tone} />
          <Info k="RTB, claim được phép (I-07)" v={b.rtb} />
          <Info k="Claim / từ bị cấm (I-07)" v={b.bannedClaims.join(', ')} hint="Cộng vào từ điển cấm chung (K4)" />
          <Info k="Đối thủ cùng công dụng (I-08)" v={b.competitors.join(', ')} hint="Dùng cho K8" />
        </dl>
      </Section>

      <section id="rules" className="mt-4 rounded-lg border border-line bg-surface px-5 py-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Ngưỡng và quy tắc lọc KOC (Khối 3)</h2>
          {canEdit && <Link href="?rules=1" className="btn h-8 px-3 text-xs">Sửa quy tắc</Link>}
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <Info k="Ngưỡng ngành (I-21)" v={`GMV ngành ≥ ${rules.industryGmvMin}% · nội dung ngành ≥ ${rules.industryContentMin}%`} />
          <Info k="Cửa sổ chống trùng (I-22)" v={`${rules.cooldownDays} ngày`} />
          <Info k="Cửa sổ scandal (I-23)" v={SCANDAL_LABEL[rules.scandal]} />
          <Info k="Uy tín brand đã hợp tác (I-24)" v={rules.k3 ? 'Bật (K3)' : 'Tắt'} />
          <Info k="Khoảng giá đối thủ (I-09)" v={`±${rules.priceBand}%`} />
          <Info k="Ads code, reup mặc định (I-25)" v={`${rules.adsCodeDays} ngày${rules.reupChannels.length ? ` · reup ${rules.reupChannels.join(', ')}` : ''}`} />
          <Info k="Duyệt ngoại lệ, giữ chỗ (I-26)" v={`${rules.exceptionApprover ? userName.get(rules.exceptionApprover) : 'Người có quyền duyệt list'} · giữ chỗ ${rules.holdDays} ngày`} />
          <Info k="Cửa sổ chống đối thủ (I-56)" v={`${rules.competitorDays} ngày trước air`} />
          <Info k="Nhóm 0 (I-27)" v={rules.group0.length ? rules.group0.map((g) => `${GROUP0.find((c) => c.id === g.id)?.label} (${g.mode === 'must' ? 'Bắt buộc' : 'Cộng điểm'})`).join(', ') : 'Chưa chọn: lấy điểm trung bình nhóm A'} />
        </dl>
        <div className="mt-3 overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>KL (I-19)</th>{KL_METRICS.map(([k, l]) => <th key={k} className="text-right">{l}</th>)}<th>Người chốt</th></tr></thead>
            <tbody>
              {KL_LEVELS.map((lv) => {
                const r = rules.kl[lv];
                const must = new Set(r?.must ?? ['followersMin', 'viewsMin']);
                return (
                  <tr key={lv}>
                    <td className="font-medium">{lv}</td>
                    {KL_METRICS.map(([k]) => <td key={k} className="text-right tabular-nums">{r?.[k] != null ? <>{fmtNum(r[k] as number)} <span className="text-[11px] text-ink-3">{must.has(k) ? 'Must' : 'Nice'}</span></> : '—'}</td>)}
                    <td className="text-xs">{r?.approver ? userName.get(r.approver) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1.5 text-xs text-ink-3">Must have dưới ngưỡng thì loại (K9), Nice to have chỉ cảnh báo (I-20). KL không đặt ngưỡng thì K9 không áp. KOC chưa có KL ở Danh bạ được suy theo follower tối thiểu.</p>
        </div>
      </section>

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
          <thead><tr><th>Sản phẩm</th><th>Gian hàng</th><th>USP</th><th className="text-right">Giá</th><th>Cấu hình SKU (Khối 2)</th><th /></tr></thead>
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
                <td className="max-w-80 text-xs">
                  {[
                    p.sku && `Mã ${p.sku}${p.line ? ` · ${p.line}` : ''}`,
                    (p.targetGender || p.ageMin != null || p.ageMax != null) && `TA ${[p.targetGender, (p.ageMin != null || p.ageMax != null) && `${p.ageMin ?? '?'}–${p.ageMax ?? '?'} tuổi`].filter(Boolean).join(' ')}`,
                    (p.femaleMin != null || p.age18_34Min != null || p.regionMin != null) && `K10: ${[p.femaleMin != null && `nữ ≥ ${p.femaleMin}%`, p.age18_34Min != null && `18–34 ≥ ${p.age18_34Min}%`, p.regionMin != null && `${p.regions.join(', ')} ≥ ${p.regionMin}%`].filter(Boolean).join(', ')}`,
                    p.channelTypes.length > 0 && `Tệp kênh: ${p.channelTypes.join(', ')}`,
                    p.exclusions.length > 0 && `TH loại: ${p.exclusions.length}`,
                    p.bannedWords.length > 0 && `Từ cấm: ${p.bannedWords.length}`,
                    p.reviewerId && `PIC duyệt: ${userName.get(p.reviewerId) ?? '—'}`,
                  ].filter(Boolean).join(' · ') || <span className="text-warning">Chưa cấu hình</span>}
                </td>
                <td className="text-right">{canEdit && <Link href={`?product=${p.id}`} className="link">Sửa</Link>}</td>
              </tr>
            ))}
            {!b.products.length && <tr><td colSpan={6} className="py-6 text-center text-ink-3">Chưa có sản phẩm.</td></tr>}
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
            <F label="Từ khoá / hashtag bắt buộc trong caption (cách nhau dấu phẩy)"><input name="keywords" defaultValue={b.keywords ?? ''} placeholder="#phcare, dung dịch vệ sinh" className="input" /></F>
            <F label="Checklist nghiệm thu (mỗi dòng một tiêu chí; trống = dùng mặc định)">
              <textarea name="checklist" rows={6} defaultValue={b.checklist ?? ''} placeholder={checklist.join('\n')} className="input" />
            </F>
            <F label="Ghi chú"><textarea name="note" rows={2} defaultValue={b.note ?? ''} className="input" /></F>
            <p className="-mb-1 border-t border-line pt-3 text-xs font-semibold text-ink-2">Khối 1 · Brand Profile cho Creator matching</p>
            <F label="Ngành hàng (I-02), chọn đúng tên ngành của creator">
              <input name="category" list="cats" defaultValue={b.category ?? ''} className="input" />
              <datalist id="cats">{[...new Set([...cats.map((c) => c.name), ...Object.values(CATEGORY)])].map((c) => <option key={c} value={c} />)}</datalist>
            </F>
            <div className="grid gap-4 sm:grid-cols-2">
              <F label="Ngành con UpBase (I-02)"><input name="subCategory" defaultValue={b.subCategory ?? ''} placeholder="Chăm sóc da" className="input" /></F>
              <F label="Nhóm brand / tập đoàn (I-03)"><input name="group" defaultValue={b.group ?? ''} placeholder="EUPC" className="input" /></F>
            </div>
            <F label="TA chính (I-04): giới tính, tuổi, khu vực, insight"><textarea name="audience" rows={2} defaultValue={b.audience ?? ''} className="input" /></F>
            <F label="Mood & tone (I-05)"><input name="tone" defaultValue={b.tone ?? ''} placeholder="Tự nhiên, chân thật" className="input" /></F>
            <F label="RTB và claim được phép (I-07)"><textarea name="rtb" rows={2} defaultValue={b.rtb ?? ''} className="input" /></F>
            <F label="Claim / từ bị cấm (I-07), mỗi dòng một cụm"><textarea name="bannedClaims" rows={2} defaultValue={b.bannedClaims.join('\n')} placeholder="trị mụn" className="input" /></F>
            <F label="Đối thủ cùng công dụng (I-08), mỗi dòng một brand"><textarea name="competitors" rows={2} defaultValue={b.competitors.join('\n')} className="input" /></F>
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

      {sp.rules && canEdit && <RulesDialog brandId={b.id} rules={rules} users={users} close={close} />}

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
            <F label="USP sản phẩm (P-USP, I-06)" wide><textarea name="usp" rows={3} defaultValue={editingProduct.usp ?? ''} className="input" /></F>
            <p className="col-span-full -mb-1 border-t border-line pt-3 text-xs font-semibold text-ink-2">Khối 2 · SKU Config cho Creator matching</p>
            <F label="Mã SP (I-10)"><input name="sku" defaultValue={editingProduct.sku ?? ''} className="input" /></F>
            <F label="Dòng SP (I-10)"><input name="line" defaultValue={editingProduct.line ?? ''} placeholder="Kem tay" className="input" /></F>
            <F label="Giới tính mục tiêu (I-12)">
              <select name="targetGender" defaultValue={editingProduct.targetGender ?? ''} className="input"><option value="">Mọi giới</option><option>Nữ</option><option>Nam</option></select>
            </F>
            <div className="grid grid-cols-2 gap-2">
              <F label="Tuổi từ (I-12)"><input name="ageMin" inputMode="numeric" defaultValue={editingProduct.ageMin ?? ''} className="input" /></F>
              <F label="đến"><input name="ageMax" inputMode="numeric" defaultValue={editingProduct.ageMax ?? ''} className="input" /></F>
            </div>
            <F label="% follower nữ tối thiểu (I-17, K10)"><input name="femaleMin" inputMode="decimal" defaultValue={editingProduct.femaleMin ?? ''} placeholder="75" className="input" /></F>
            <F label="% follower 18–34 tối thiểu (I-17, K10)"><input name="age18_34Min" inputMode="decimal" defaultValue={editingProduct.age18_34Min ?? ''} placeholder="70" className="input" /></F>
            <F label="Khu vực mục tiêu (I-17), cách nhau dấu phẩy"><input name="regions" defaultValue={editingProduct.regions?.join(', ') ?? ''} placeholder="Hồ Chí Minh, Bình Dương" className="input" /></F>
            <F label="% follower tại khu vực tối thiểu"><input name="regionMin" inputMode="decimal" defaultValue={editingProduct.regionMin ?? ''} className="input" /></F>
            <F label="Chân dung và visual bắt buộc của KOC (I-13)" wide><textarea name="kocVisual" rows={2} defaultValue={editingProduct.kocVisual ?? ''} placeholder="Bàn tay thon, quay cận" className="input" /></F>
            <F label="Vấn đề sản phẩm giải quyết (nhóm 0: trải nghiệm thật)" wide><input name="problem" defaultValue={editingProduct.problem ?? ''} placeholder="Da tay khô" className="input" /></F>
            <F label="Trường hợp loại (I-14, K11), mỗi dòng một trường hợp" wide><textarea name="exclusions" rows={2} defaultValue={editingProduct.exclusions?.join('\n') ?? ''} placeholder="Tay khô ráp, tróc da" className="input" /></F>
            <F label="Từ cấm riêng của SKU (I-16, K4), mỗi dòng một cụm" wide><textarea name="bannedWords" rows={2} defaultValue={editingProduct.bannedWords?.join('\n') ?? ''} placeholder="bản dupe" className="input" /></F>
            <fieldset className="col-span-full">
              <legend className="label">Tệp kênh ưu tiên (I-15)</legend>
              <div className="flex max-h-40 flex-wrap gap-x-4 gap-y-1 overflow-y-auto text-[13px]">
                {niches.map((n) => <label key={n.niche} className="flex items-center gap-1.5"><input type="checkbox" name="channelTypes" value={n.niche!} defaultChecked={editingProduct.channelTypes?.includes(n.niche!)} />{n.niche}</label>)}
              </div>
            </fieldset>
            <F label="PIC duyệt content (I-18)">
              <select name="reviewerId" defaultValue={editingProduct.reviewerId ?? ''} className="input">
                <option value="">—</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.id}</option>)}
              </select>
            </F>
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

function RulesDialog({ brandId, rules, users, close }: { brandId: string; rules: ReturnType<typeof parseRules>; users: { id: string; name: string | null }[]; close: string }) {
  const userSelect = (name: string, value: string | null | undefined, empty = '—') => (
    <select name={name} defaultValue={value ?? ''} className="input h-8 text-[13px]"><option value="">{empty}</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.id}</option>)}</select>
  );
  const g0 = new Map(rules.group0.map((g) => [g.id, g.mode]));
  return (
    <Dialog title="Ngưỡng và quy tắc lọc KOC (Khối 3)" closeHref={close} wide>
      <ActionForm action={saveRules} className="grid gap-4">
        <input type="hidden" name="brandId" value={brandId} />
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>KL</th>{KL_METRICS.map(([k, l]) => <th key={k}>{l}<div className="font-normal text-ink-3">tick = Must have</div></th>)}<th>Người chốt</th></tr></thead>
            <tbody>
              {KL_LEVELS.map((lv) => {
                const r = rules.kl[lv];
                const must = new Set(r?.must ?? ['followersMin', 'viewsMin']);
                return (
                  <tr key={lv}>
                    <td className="font-medium">{lv}</td>
                    {KL_METRICS.map(([k, l]) => (
                      <td key={k}>
                        <div className="flex items-center gap-1">
                          <input name={`${k}|${lv}`} inputMode="numeric" defaultValue={r?.[k] ?? ''} aria-label={`${lv} ${l}`} className="input h-8 w-24 text-right text-[13px]" />
                          <input type="checkbox" name={`must|${lv}`} value={k} defaultChecked={must.has(k)} aria-label={`${lv} ${l} là Must have`} />
                        </div>
                      </td>
                    ))}
                    <td>{userSelect(`approver|${lv}`, r?.approver)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <F label="% GMV ngành tối thiểu (I-21)"><input name="industryGmvMin" inputMode="numeric" defaultValue={rules.industryGmvMin} className="input" /></F>
          <F label="% nội dung ngành tối thiểu (I-21, kho chưa có)"><input name="industryContentMin" inputMode="numeric" defaultValue={rules.industryContentMin} className="input" /></F>
          <F label="Cửa sổ chống trùng KOC, ngày (I-22)"><input name="cooldownDays" inputMode="numeric" defaultValue={rules.cooldownDays} list="cooldown" className="input" /><datalist id="cooldown"><option value="30" /><option value="60" /><option value="90" /></datalist></F>
          <F label="Cửa sổ scandal (I-23)">
            <select name="scandal" defaultValue={rules.scandal} className="input">{Object.entries(SCANDAL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </F>
          <F label="Khoảng giá đối thủ ± % (I-09)"><input name="priceBand" inputMode="numeric" defaultValue={rules.priceBand} className="input" /></F>
          <F label="Cửa sổ chống đối thủ, ngày trước air (I-56)"><input name="competitorDays" inputMode="numeric" defaultValue={rules.competitorDays} className="input" /></F>
          <F label="Số ngày ads code mặc định (I-25)"><input name="adsCodeDays" inputMode="numeric" defaultValue={rules.adsCodeDays} className="input" /></F>
          <F label="Người duyệt ngoại lệ (I-26)">{userSelect('exceptionApprover', rules.exceptionApprover, 'Người có quyền duyệt list')}</F>
          <F label="Thời hạn giữ chỗ KOC, ngày (I-26)"><input name="holdDays" inputMode="numeric" defaultValue={rules.holdDays} className="input" /></F>
        </div>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="k3" value="1" defaultChecked={rules.k3} />Bật K3: kiểm tra uy tín brand KOC đã hợp tác 90 ngày (≥ 50% có gian Mall / Official) (I-24)</label>
        <fieldset>
          <legend className="label">Kênh reup mặc định (I-25)</legend>
          <div className="flex flex-wrap gap-x-4 text-[13px]">{REUP.map((c) => <label key={c} className="flex items-center gap-1.5"><input type="checkbox" name="reupChannels" value={c} defaultChecked={rules.reupChannels.includes(c)} />{c}</label>)}</div>
        </fieldset>
        <fieldset>
          <legend className="label">Nhóm 0 mặc định (I-27): chọn 3–5 tiêu chí. Bắt buộc = lọc; Cộng điểm = chấm 1/3/5. Không chọn thì lấy điểm trung bình nhóm A.</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {GROUP0.map((c) => (
              <label key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-line px-2.5 py-1.5 text-[13px]">
                <span><span className="font-medium">{c.label}</span><span className="block text-xs text-ink-3">{c.measure}</span></span>
                <select name={`g0|${c.id}`} defaultValue={g0.get(c.id) ?? ''} className="input h-8 w-32 shrink-0 text-[13px]">
                  <option value="">Không dùng</option><option value="must">Bắt buộc</option><option value="score">Cộng điểm</option>
                </select>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2"><Link href={close} className="btn">Hủy</Link><button className="btn btn-primary">Lưu quy tắc</button></div>
      </ActionForm>
    </Dialog>
  );
}

function Info({ k, v, hint }: { k: string; v: string | null | undefined; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{k}</dt>
      <dd className="whitespace-pre-line">{v || <span className="text-warning">Chưa có{hint ? ` · ${hint}` : ''}</span>}</dd>
    </div>
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
