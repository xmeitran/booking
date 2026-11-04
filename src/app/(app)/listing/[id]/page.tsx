import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionForm, Avatar, Dialog } from '@/components/ui';
import { fmtDate, fmtNum, fmtPct, fmtShort, fmtVnd } from '@/lib/format';
import { BRAND_CHOICE, CONTACT_STATUS, loadListing, PRICE_TYPES, RECOMMEND, type ListingRow } from '@/lib/listing';
import { requireUser } from '@/lib/session';
import { addKocs, deleteBatch, removeItem, saveBatch, saveItem } from '../actions';

const CHOICE_TONE: Record<string, string> = { Yes: 'bg-positive-soft text-positive', No: 'bg-critical-soft text-critical', 'Cân nhắc': 'bg-warning-soft text-warning' };
const REC_TONE: Record<string, string> = { 'Must Have': 'bg-accent-soft text-accent', Recommend: 'bg-sunken text-ink-2', Optional: 'bg-sunken text-ink-3' };
const isoDate = (d: Date | null) => (d ? d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) : '');

type Search = { edit?: string; item?: string };

export default async function ListingBatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Search> }) {
  const me = await requireUser();
  const { id } = await params;
  const { edit, item: itemId } = await searchParams;
  const data = await loadListing(id);
  if (!data) notFound();
  const { batch, rows } = data;
  const editingRow = rows.find((r) => r.item.id === itemId);
  const canDelete = me.role !== 'STAFF' || batch.createdById === me.id;

  const chosen = rows.filter((r) => r.item.brandChoice === 'Yes');
  const sum = (list: ListingRow[], f: (r: ListingRow) => number | null) => list.reduce((s, r) => s + (f(r) ?? 0), 0);

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
          <a href={`/listing/${batch.id}/export?mode=brand`} className="btn">Tải file cho Brand</a>
          <a href={`/listing/${batch.id}/export?mode=internal`} className="btn">Tải file nội bộ</a>
          <Link href="?edit=1" className="btn">Sửa đợt</Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="KOC trong đợt" value={String(rows.length)} sub={`${rows.filter((r) => r.item.recommendation === 'Must Have').length} Must Have`} />
        <Kpi label="Brand chọn" value={String(chosen.length)} sub={`${rows.filter((r) => r.item.brandChoice).length}/${rows.length} đã phản hồi`} />
        <Kpi label="Phí kèm TNCN (Brand chọn)" value={fmtShort(sum(chosen, (r) => r.f.fee))} sub={`Toàn đợt ${fmtShort(sum(rows, (r) => r.f.fee))}`} />
        <Kpi label="GMV Target (Brand chọn)" value={fmtShort(sum(chosen, (r) => r.f.gmvTarget))} sub={`Toàn đợt ${fmtShort(sum(rows, (r) => r.f.gmvTarget))}`} />
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

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr>
              <th>KOC</th><th className="text-right">Follower</th><th>Hiệu quả 30 ngày</th><th>Khán giả</th>
              <th>Với UpBase</th><th className="text-right">Giá / phí</th><th className="text-right">Dự báo</th><th>Đề xuất · Brand</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => <Row key={r.item.id} r={r} />)}
            {!rows.length && <tr><td colSpan={9} className="py-12 text-center text-ink-3">Chưa có KOC. Dán ID kênh ở ô phía trên.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-3">
        Số TikTok 30 ngày; GPM quy đổi từ USD. GMV Target = View Target × GPM / 1000 (bằng View × CTR × CR × AOV). View Target KL6–KL7 nhập tay.
      </p>

      {editingRow && <ItemDialog r={editingRow} />}

      {edit && (
        <Dialog title="Sửa đợt listing" closeHref={`/listing/${batch.id}`}>
          <ActionForm action={saveBatch} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={batch.id} />
            <F label="Tên đợt" wide><input name="name" required defaultValue={batch.name} className="input" /></F>
            <F label="Brand"><input name="brand" defaultValue={batch.brand ?? ''} className="input" /></F>
            <F label="Store"><input name="store" defaultValue={batch.store ?? ''} className="input" /></F>
            <F label="Sản phẩm" wide><input name="product" defaultValue={batch.product ?? ''} className="input" /></F>
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
          </div>
        </div>
      </td>
      <td className="text-right">{fmtShort(k.followers)}</td>
      <td className="text-xs whitespace-nowrap">
        {k.statsAt ? (
          <>
            <div>{fmtNum(k.avgViews)} view TB · {fmtNum(k.unitsSold)} món</div>
            <div className="text-ink-3">GMV {r.gmv30 != null ? `~${fmtShort(r.gmv30)}` : k.gmvRange ?? '—'} · GPM {fmtShort(r.f.gpmVnd)}</div>
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
        <div className="text-ink-3">{item.priceType} · kèm TNCN {fmtShort(r.f.fee)}</div>
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
        <F label="Trạng thái liên hệ">{select('status', item.status, CONTACT_STATUS)}</F>
        <F label="Ngày air plan"><input name="planAirDate" type="date" defaultValue={isoDate(item.planAirDate)} className="input" /></F>
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
