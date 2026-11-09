import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { CatalogPick, placeKey } from '@/components/CatalogPick';
import { InlineField } from '@/components/InlineField';
import { ActionForm, Avatar, CopyButton, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate, fmtNum, fmtPct, fmtShort, fmtVnd } from '@/lib/format';
import { BRAND_CHOICE, COL_GROUPS, COLS, CONTACT_STATUS, loadListing, PRICE_TYPES, RECOMMEND, type Col, type ListingRow } from '@/lib/listing';
import { gmvLabel } from '@/lib/kocInsights';
import { guard } from '@/lib/scope';
import { can, requireUser } from '@/lib/session';
import { addKocs, createShare, deleteBatch, removeItem, revokeShare, saveBatch, saveItem, setItemField } from '../actions';
import { createJobsFromListing } from '../../jobs/actions';
import { jobCode } from '@/lib/jobs';

const CHOICE_TONE: Record<string, string> = { Yes: 'bg-positive-soft text-positive', No: 'bg-critical-soft text-critical', 'Cân nhắc': 'bg-warning-soft text-warning' };
const REC_TONE: Record<string, string> = { 'Must Have': 'bg-accent-soft text-accent', Recommend: 'bg-sunken text-ink-2', Optional: 'bg-sunken text-ink-3' };
const isoDate = (d: Date | null) => (d ? d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');

type Search = { edit?: string; item?: string; view?: string; choice?: string; rec?: string; sort?: string; hide?: string; dup?: string };

const SORTS: Record<string, { label: string; key?: (r: ListingRow) => number | null; asc?: boolean }> = {
  '': { label: 'Thứ tự thêm' },
  fee: { label: 'Phí cao nhất', key: (r) => r.f.fee },
  gmv: { label: 'GMV Target cao nhất', key: (r) => r.f.gmvTarget },
  followers: { label: 'Follower nhiều nhất', key: (r) => r.koc.followers },
  views: { label: 'View TB cao nhất', key: (r) => r.koc.avgViews },
  cpv: { label: 'CPV thấp nhất', key: (r) => r.f.cpv, asc: true },
};
const CHOICES: [string, string][] = [['', 'Tất cả'], ['none', 'Brand chưa phản hồi'], ['Yes', 'Yes'], ['Cân nhắc', 'Cân nhắc'], ['No', 'No']];
const DEFAULT_HIDE = ['meta', 'contact', 'bank'];
// Ô sửa nhanh trong bảng Excel, theo tên cột.
const EDIT: Record<string, { field: string; options?: string[]; type?: 'number' | 'date'; value: (r: ListingRow) => string; placeholder?: (r: ListingRow) => string }> = {
  'Giá net video': { field: 'price', type: 'number', value: (r) => r.item.price?.toString() ?? '', placeholder: (r) => (r.collab.lastPrice ? String(r.collab.lastPrice) : '') },
  'Trạng thái': { field: 'status', options: CONTACT_STATUS, value: (r) => r.item.status ?? '' },
  'Đề xuất từ UpBase': { field: 'recommendation', options: RECOMMEND, value: (r) => r.item.recommendation ?? '' },
  'Content note': { field: 'contentNote', value: (r) => r.item.contentNote ?? '' },
  'Brand chọn': { field: 'brandChoice', options: BRAND_CHOICE, value: (r) => r.item.brandChoice ?? '' },
  'Lý do từ chối': { field: 'rejectReason', value: (r) => r.item.rejectReason ?? '' },
  'Ngày air plan': { field: 'planAirDate', type: 'date', value: (r) => isoDate(r.item.planAirDate) },
  'View Target': { field: 'viewTarget', type: 'number', value: (r) => r.item.viewTarget?.toString() ?? '', placeholder: (r) => (r.viewTarget == null ? '' : String(r.viewTarget)) },
};

export default async function ListingBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const { edit, item: itemId, choice = '', rec = '', dup = '' } = sp;
  const grid = sp.view === 'grid';
  const sort = sp.sort && SORTS[sp.sort] ? sp.sort : '';
  await guard(me, 'listing', id);
  const data = await loadListing(id);
  if (!data) notFound();
  const catalog = edit ? await db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, stores: { select: { id: true, name: true }, orderBy: { name: 'asc' } }, products: { select: { id: true, name: true }, orderBy: { name: 'asc' } } } }) : [];
  const { batch, rows } = data;
  const editingRow = rows.find((r) => r.item.id === itemId);
  const canDelete = me.role !== 'STAFF' || batch.createdById === me.id;

  // Lọc + xếp trên bộ nhớ: một đợt chỉ vài chục KOC.
  const byRec = rows.filter((r) => !rec || r.item.recommendation === rec);
  const choiceOk = (r: ListingRow, c: string) => !c || (c === 'none' ? !r.item.brandChoice : r.item.brandChoice === c);
  let shown = byRec.filter((r) => choiceOk(r, choice) && (!dup || r.dup.length > 0));
  const key = SORTS[sort].key;
  if (key) shown = [...shown].sort((a, b) => {
    const x = key(a), y = key(b);
    if (x == null) return 1;
    if (y == null) return -1;
    return SORTS[sort].asc ? x - y : y - x;
  });

  const query = new URLSearchParams(Object.entries({ view: grid ? 'grid' : '', choice, rec, sort, dup }).filter(([, v]) => v));
  if (sp.hide !== undefined) query.set('hide', sp.hide);
  const withParam = (k: string, v: string) => {
    const p = new URLSearchParams(query);
    if (v || k === 'hide') p.set(k, v); else p.delete(k);
    return p.size ? `?${p}` : `/listing/${batch.id}`;
  };
  const hidden = new Set(sp.hide === undefined ? DEFAULT_HIDE : sp.hide.split(',').filter(Boolean));
  const toggleGroup = (g: string) => withParam('hide', [...(hidden.has(g) ? [...hidden].filter((x) => x !== g) : [...hidden, g])].join(','));
  const groups = (Object.keys(COL_GROUPS) as Col['g'][]).filter((g) => g !== 'batch' && !(g === 'bank' && !can(me, 'koc.bank')));
  const cols = COLS.filter((c) => groups.includes(c.g) && !hidden.has(c.g) && c.h !== 'ID kênh' && c.h !== 'Tên người ảnh hưởng (Tên kênh)');

  const h = await headers();
  const origin = `${h.get('x-forwarded-proto')?.split(',')[0].trim() ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const shareUrl = batch.shareToken ? `${origin}/review/${batch.shareToken}` : '';

  const chosen = rows.filter((r) => r.item.brandChoice === 'Yes');
  const sum = (list: ListingRow[], f: (r: ListingRow) => number | null) => list.reduce((s, r) => s + (f(r) ?? 0), 0);
  // Phí / GMV của dòng = 1 video × số video KOC làm trong đợt.
  const times = (v: number | null, r: ListingRow) => (v == null ? null : v * r.item.videos);
  // Video Brand chọn Yes chưa có job (KOC blacklist không tạo job).
  const jobsToCreate = sum(chosen.filter((r) => !r.koc.blacklisted), (r) => Math.max(0, r.item.videos - r.item.jobs.length));

  return (
    <>
      <Link href="/listing" className="text-xs text-ink-3 hover:text-ink">← Listing</Link>
      <div className="mt-2 mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{batch.name}</h1>
          <p className="mt-0.5 text-xs text-ink-3">
            {[batch.brand, batch.store, batch.product, `Tháng ${batch.month.split('-').reverse().join('/')}`].filter(Boolean).join(' · ')}
            {' · '}CR {batch.cr == null ? '—' : fmtPct(batch.cr)} · AOV {fmtVnd(batch.aov)} · tạo bởi {batch.createdBy.name ?? '—'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(me, 'data.export') && (
            <>
              <a href={`/listing/${batch.id}/export?mode=brand`} className="btn">Tải file cho Brand</a>
              <a href={`/listing/${batch.id}/export?mode=internal`} className="btn">Tải file nội bộ</a>
            </>
          )}
          <Link href="?edit=1" className="btn">Sửa đợt</Link>
          {jobsToCreate > 0 && (
            <form action={createJobsFromListing}>
              <input type="hidden" name="batchId" value={batch.id} />
              <button className="btn btn-primary">Tạo {jobsToCreate} job cho KOC Brand chọn Yes</button>
            </form>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="KOC trong đợt" value={String(rows.length)} sub={`${rows.filter((r) => r.item.recommendation === 'Must Have').length} Must Have`} />
        <Kpi label="Brand chọn" value={String(chosen.length)} sub={`${rows.filter((r) => r.item.brandChoice).length}/${rows.length} đã phản hồi`} />
        <Kpi label="Phí kèm TNCN (Brand chọn)" value={fmtShort(sum(chosen, (r) => times(r.f.fee, r)))} sub={`Toàn đợt ${fmtShort(sum(rows, (r) => times(r.f.fee, r)))}`} />
        <Kpi label="GMV Target (Brand chọn)" value={fmtShort(sum(chosen, (r) => times(r.f.gmvTarget, r)))} sub={`Toàn đợt ${fmtShort(sum(rows, (r) => times(r.f.gmvTarget, r)))}`} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-4 py-3 text-[13px]">
        <span className="font-medium">Brand duyệt online</span>
        {batch.shareToken ? (
          <>
            <code className="max-w-full truncate rounded bg-sunken px-2 py-1 text-xs">{shareUrl}</code>
            <CopyButton text={shareUrl} />
            <form action={revokeShare}>
              <input type="hidden" name="id" value={batch.id} />
              <button className="btn h-8 px-2.5 text-xs">Thu hồi link</button>
            </form>
            <span className="text-xs text-ink-3">Ai có link đều xem và chọn được. Trang Brand không có SĐT, địa chỉ, tài khoản ngân hàng.</span>
          </>
        ) : (
          <>
            <span className="text-ink-3">Gửi Brand một link để tự chọn Yes / No / Cân nhắc và ghi lý do, không cần tài khoản.</span>
            <form action={createShare}>
              <input type="hidden" name="id" value={batch.id} />
              <button className="btn h-8 px-2.5 text-xs">Tạo link</button>
            </form>
          </>
        )}
      </div>

      <ActionForm action={addKocs} className="mb-4 grid gap-2 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <input type="hidden" name="batchId" value={batch.id} />
        <div>
          <label className="label" htmlFor="ids">Thêm KOC: ID kênh hoặc link TikTok, mỗi dòng một kênh</label>
          <textarea id="ids" name="ids" rows={2} required placeholder={'@mesaylamdep\nhttps://www.tiktok.com/@sooi.unbox'} className="input font-mono" />
        </div>
        <div>
          <label className="label" htmlFor="priceType">Loại giá</label>
          <select id="priceType" name="priceType" className="input">{PRICE_TYPES.map((p) => <option key={p}>{p}</option>)}</select>
        </div>
        <button className="btn btn-primary">Thêm vào listing</button>
      </ActionForm>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {CHOICES.map(([v, label]) => (
            <Link key={v} href={withParam('choice', v)} className={`pill px-2.5 py-1 ${choice === v ? 'bg-ink text-white' : 'bg-surface text-ink-2 ring-1 ring-line'}`}>
              {label} · {byRec.filter((r) => choiceOk(r, v)).length}
            </Link>
          ))}
          <Link href={withParam('dup', dup ? '' : '1')} className={`pill px-2.5 py-1 ${dup ? 'bg-ink text-white' : byRec.some((r) => r.dup.length) ? 'bg-warning-soft text-warning' : 'bg-surface text-ink-3 ring-1 ring-line'}`}>
            Trùng · {byRec.filter((r) => r.dup.length).length}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form className="flex gap-2">
            {[...query].filter(([k]) => k !== 'rec' && k !== 'sort').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <select name="rec" defaultValue={rec} aria-label="Đề xuất" className="input h-8 w-auto text-xs">
              <option value="">Mọi đề xuất</option>
              {RECOMMEND.map((o) => <option key={o}>{o}</option>)}
            </select>
            <select name="sort" defaultValue={sort} aria-label="Sắp xếp" className="input h-8 w-auto text-xs">
              {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <button className="btn h-8 px-2.5 text-xs">Lọc</button>
          </form>
          <div className="flex rounded-md bg-sunken p-0.5 text-[13px]">
            <Link href={withParam('view', '')} className={`rounded px-3 py-1 ${!grid ? 'bg-surface font-medium shadow-sm' : 'text-ink-3'}`}>Tóm tắt</Link>
            <Link href={withParam('view', 'grid')} className={`rounded px-3 py-1 ${grid ? 'bg-surface font-medium shadow-sm' : 'text-ink-3'}`}>Bảng Excel</Link>
          </div>
        </div>
      </div>

      {grid ? (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-ink-3">Nhóm cột:</span>
            {groups.map((g) => (
              <Link key={g} href={toggleGroup(g)} className={`pill px-2 py-0.5 ${hidden.has(g) ? 'bg-surface text-ink-3 ring-1 ring-line' : 'bg-accent-soft text-accent'}`}>
                {hidden.has(g) ? '+ ' : '✓ '}{COL_GROUPS[g]}
              </Link>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="tbl text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface" />
                  {spans(cols).map(([g, n], i) => <th key={i} colSpan={n} className="border-l border-line text-center">{COL_GROUPS[g]}</th>)}
                </tr>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface">KOC</th>
                  {cols.map((c) => <th key={c.h} className="min-w-24 whitespace-normal">{c.h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.item.id} className="align-top">
                    <td className="sticky left-0 z-10 bg-surface">
                      <Link href={`/contacts/${r.koc.id}`} className="font-medium hover:text-accent hover:underline">{r.koc.nickname ?? r.koc.name}</Link>
                      <div className="text-ink-3">@{r.koc.handle}</div>
                      <Dup notes={r.dup} />
                      <Link href={`?${new URLSearchParams([...query, ['item', r.item.id]])}`} className="link">Sửa</Link>
                    </td>
                    {cols.map((c) => {
                      const e = EDIT[c.h];
                      if (e) {
                        const v = e.value(r);
                        return (
                          <td key={c.h}>
                            <InlineField key={v} action={setItemField} id={r.item.id} field={e.field} label={`${c.h} · @${r.koc.handle}`} value={v} options={e.options} type={e.type} placeholder={e.placeholder?.(r)} />
                          </td>
                        );
                      }
                      const v = c.v(r);
                      const text = v == null ? '' : String(v);
                      return (
                        <td key={c.h} className={typeof v === 'number' ? 'text-right tabular-nums' : ''}>
                          {text.startsWith('http') ? <a href={text} target="_blank" rel="noreferrer" className="link">Mở</a>
                            : typeof v === 'number' ? fmtNum(v)
                            : <span className="line-clamp-3 max-w-56" title={text}>{text || '—'}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={cols.length + 1} className="py-12 text-center text-ink-3">Không có KOC khớp bộ lọc.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="tbl">
            <thead>
              <tr>
                <th>KOC</th><th className="text-right">Follower</th><th>Hiệu quả 30 ngày</th><th>Khán giả</th>
                <th>Với UpBase</th><th className="text-right">Giá / phí</th><th className="text-right">Dự báo</th><th>Đề xuất · Brand</th><th />
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => <Row key={r.item.id} r={r} />)}
              {!shown.length && <tr><td colSpan={9} className="py-12 text-center text-ink-3">{rows.length ? 'Không có KOC khớp bộ lọc.' : 'Chưa có KOC. Dán ID kênh ở ô phía trên.'}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-3">
        Số TikTok 30 ngày; GPM quy đổi từ USD. GMV Target = View Target × GPM / 1000 (bằng View × CTR × CR × AOV). View Target KL6–KL7 nhập tay.
      </p>

      {editingRow && <ItemDialog r={editingRow} />}

      {edit && (
        <Dialog title="Sửa đợt listing" closeHref={`/listing/${batch.id}`}>
          <ActionForm action={saveBatch} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={batch.id} />
            <F label="Tên đợt" wide><input name="name" required defaultValue={batch.name} className="input" /></F>
            <CatalogPick
              brands={catalog} place={placeKey(catalog, batch.brand, batch.store)}
              productId={catalog.flatMap((b) => b.products).find((p) => p.name === batch.product)?.id ?? ''}
              productText={catalog.flatMap((b) => b.products).some((p) => p.name === batch.product) ? '' : batch.product ?? ''}
            />
            <F label="Tháng"><input name="month" type="month" required defaultValue={batch.month} className="input" /></F>
            <div />
            <F label="CR sản phẩm (%)"><input name="cr" inputMode="decimal" defaultValue={batch.cr == null ? '' : String(+(batch.cr * 100).toFixed(4))} className="input" /></F>
            <F label="AOV sản phẩm (₫)"><input name="aov" type="number" min={0} step={1000} defaultValue={batch.aov ?? ''} className="input" /></F>
            <div className="col-span-full flex justify-end gap-2">
              <Link href={`/listing/${batch.id}`} className="btn">Hủy</Link>
              <button className="btn btn-primary">Lưu</button>
            </div>
          </ActionForm>
          {canDelete && (
            <form action={deleteBatch} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="id" value={batch.id} />
              <button className="btn btn-danger">Xóa đợt listing</button>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}

function Row({ r }: { r: ListingRow }) {
  const { koc: k, p, item } = r;
  const pending = !k.ttsCheckedAt;
  return (
    <tr>
      <td>
        <div className="flex items-center gap-2.5">
          <Avatar src={k.avatarUrl} name={k.nickname ?? k.name} size={32} />
          <div className="min-w-0">
            <Link href={`/contacts/${k.id}`} className="font-medium hover:text-accent hover:underline">{k.nickname ?? k.name}</Link>
            <div className="text-xs text-ink-3">@{k.handle}{r.kl && ` · ${r.kl}`}{k.niche && ` · ${k.niche}`}</div>
            <Dup notes={r.dup} />
          </div>
        </div>
      </td>
      <td className="text-right">{fmtShort(k.followers)}</td>
      <td className="text-xs whitespace-nowrap">
        {k.statsAt ? (
          <>
            <div>{fmtNum(k.avgViews)} view TB · {fmtNum(k.unitsSold)} món</div>
            <div className="text-ink-3">GMV {r.gmv30 != null ? `~${fmtShort(r.gmv30)}` : gmvLabel(k.gmvRange) ?? '—'} · GPM {fmtShort(r.f.gpmVnd)}</div>
          </>
        ) : <span className="text-ink-3">{pending ? 'Chờ tra TikTok (lượt mỗi giờ)' : 'Không có trên Marketplace'}</span>}
      </td>
      <td className="text-xs whitespace-nowrap">
        {p.female != null ? (
          <>
            <div>Nữ {fmtPct(p.female, 0)} · 18–24 {fmtPct(p.age18_24, 0)} · 25–34 {fmtPct(p.age25_34, 0)}</div>
            <div className="text-ink-3">{p.locations.slice(0, 2).map((l) => `${l.name} ${fmtPct(l.share, 0)}`).join(' · ')}</div>
          </>
        ) : '—'}
      </td>
      <td className="text-xs">
        {r.collab.count ? (
          <>
            <div>{r.collab.count} booking</div>
            <div className="text-ink-3">Gần nhất {fmtShort(r.collab.lastPrice)}</div>
          </>
        ) : <span className="text-ink-3">Chưa hợp tác</span>}
      </td>
      <td className="text-right text-xs whitespace-nowrap">
        <div>{fmtNum(r.price)}{item.price == null && r.price != null && <span className="text-ink-3"> (giá cũ)</span>}</div>
        <div className="text-ink-3">{item.priceType}{item.videos > 1 && <b className="text-ink"> × {item.videos}</b>} · kèm TNCN {fmtShort(r.f.fee)}</div>
      </td>
      <td className="text-right text-xs whitespace-nowrap">
        <div>GMV {fmtShort(r.f.gmvTarget)}</div>
        <div className="text-ink-3">View {fmtShort(r.viewTarget)}{r.viewTargetManual ? ' (tay)' : ''}{r.f.cpv != null && ` · CPV ${fmtNum(r.f.cpv)}`}</div>
      </td>
      <td className="text-xs">
        <div className="flex flex-wrap gap-1">
          {item.recommendation && <span className={`pill ${REC_TONE[item.recommendation]}`}>{item.recommendation}</span>}
          {item.brandChoice && <span className={`pill ${CHOICE_TONE[item.brandChoice]}`}>Brand: {item.brandChoice}</span>}
        </div>
        {item.status && <div className="mt-0.5 text-ink-3">{item.status}</div>}
        {item.jobs.map((j) => <Link key={j.id} href={`/jobs/${j.id}`} className="mt-0.5 block text-accent hover:underline">{jobCode(j.number)} · {j.stage}</Link>)}
        {item.rejectReason && <div className="max-w-40 truncate text-critical" title={item.rejectReason}>{item.rejectReason}</div>}
      </td>
      <td className="text-right"><Link href={`?item=${item.id}`} className="link">Sửa</Link></td>
    </tr>
  );
}

function ItemDialog({ r }: { r: ListingRow }) {
  const { item, koc } = r;
  const close = `/listing/${item.batchId}`;
  const select = (name: string, value: string | null, options: string[], empty = '—') => (
    <select id={name} name={name} defaultValue={value ?? ''} className="input">
      <option value="">{empty}</option>
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
  return (
    <Dialog title={`${koc.nickname ?? koc.name} · @${koc.handle}`} closeHref={close}>
      <ActionForm action={saveItem} className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="id" value={item.id} />
        <F label="Loại giá">
          <select name="priceType" defaultValue={item.priceType} className="input">{PRICE_TYPES.map((p) => <option key={p}>{p}</option>)}</select>
        </F>
        <F label={`Giá net đề xuất (₫)${r.collab.lastPrice ? ` · giá cũ ${fmtNum(r.collab.lastPrice)}` : ''}`}>
          <input name="price" type="number" min={0} step={1000} defaultValue={item.price ?? ''} placeholder={r.collab.lastPrice ? String(r.collab.lastPrice) : ''} className="input" />
        </F>
        <F label="Số video / phiên trong đợt"><input name="videos" type="number" min={1} max={50} required defaultValue={item.videos} className="input" /></F>
        <F label="Trạng thái liên hệ">{select('status', item.status, CONTACT_STATUS)}</F>
        <F label="Ngày air plan (video đầu)"><input name="planAirDate" type="date" defaultValue={isoDate(item.planAirDate)} className="input" /></F>
        <F label="Đề xuất từ UpBase">{select('recommendation', item.recommendation, RECOMMEND)}</F>
        <F label="Brand chọn">{select('brandChoice', item.brandChoice, BRAND_CHOICE)}</F>
        <F label="Lý do từ chối" wide><input name="rejectReason" list="reasons" defaultValue={item.rejectReason ?? ''} className="input" /></F>
        <datalist id="reasons"><option value="Không phù hợp" /><option value="Giá cao" /><option value="Trùng đối thủ" /><option value="Không phù hợp lịch" /></datalist>
        <F label={`View Target nhập tay${r.viewTargetManual ? '' : ` · tự tính ${fmtNum(r.viewTarget)}`}`} wide>
          <input name="viewTarget" type="number" min={0} defaultValue={item.viewTarget ?? ''} placeholder="Để trống: view TB video 30 ngày (KL1–KL5)" className="input" />
        </F>
        <F label="Content note" wide><textarea name="contentNote" rows={3} defaultValue={item.contentNote ?? ''} className="input" /></F>
        <p className="col-span-full text-xs text-ink-3">Thêm bởi {item.createdBy.name ?? '—'} · {fmtDate(item.createdAt)}</p>
        <div className="col-span-full flex justify-end gap-2">
          <Link href={close} className="btn">Hủy</Link>
          <button className="btn btn-primary">Lưu</button>
        </div>
      </ActionForm>
      <form action={removeItem} className="mt-4 border-t border-line pt-4">
        <input type="hidden" name="id" value={item.id} />
        <button className="btn btn-danger">Bỏ KOC khỏi đợt</button>
      </form>
    </Dialog>
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
  return (
    <label className={`block ${wide ? 'col-span-full' : ''}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

/** Cột liền nhau cùng nhóm → [nhóm, số cột] cho hàng tiêu đề nhóm. */
function spans(cols: Col[]) {
  const out: [Col['g'], number][] = [];
  for (const c of cols) {
    const last = out[out.length - 1];
    if (last?.[0] === c.g) last[1]++;
    else out.push([c.g, 1]);
  }
  return out;
}

function Dup({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <div className="mt-0.5 max-w-64 text-xs text-warning" title={notes.join('\n')}>
      <span className="pill bg-warning-soft text-warning">Trùng</span> <span className="line-clamp-2">{notes[0]}{notes.length > 1 && ` (+${notes.length - 1})`}</span>
    </div>
  );
}
