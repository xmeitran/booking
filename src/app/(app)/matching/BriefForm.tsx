import Link from 'next/link';
import type { MatchBrief } from '@prisma/client';
import { ActionForm } from '@/components/ui';
import { CHANNELS, KL_LEVELS, OBJECTIVES, parseSlots } from '@/lib/matching/spec';
import { saveBrief } from './actions';

type Brand = { id: string; name: string; products: { id: string; name: string; sku: string | null }[] };

/** Khối 4. Kế hoạch và brief đợt booking (I-28 – I-37). Brand, SKU chọn từ Danh mục (Khối 1–3 khai ở đó). */
export function BriefForm({ brief, brands, cancel }: { brief?: Partial<MatchBrief>; brands: Brand[]; cancel: string }) {
  const slots = new Map(parseSlots(brief?.slots).map((s) => [s.kl, s]));
  const pct = (x: number | null | undefined) => (x == null ? '' : String(+(x * 100).toFixed(2)));
  return (
    <ActionForm action={saveBrief} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={brief?.id ?? ''} />
      <F label="Tên đợt" wide><input name="name" required defaultValue={brief?.name ?? ''} placeholder="Ziaja – Kem tay – T12/2026" className="input" /></F>
      <F label="Brand / Store (I-01)">
        <select name="brandId" defaultValue={brief?.brandId ?? ''} className="input">
          <option value="">— Chọn từ Danh mục —</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </F>
      <F label="SKU cần book (I-28)">
        <select name="productId" defaultValue={brief?.productId ?? ''} className="input">
          <option value="">— Chọn SKU —</option>
          {brands.filter((b) => b.products.length).map((b) => (
            <optgroup key={b.id} label={b.name}>{b.products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ''}</option>)}</optgroup>
          ))}
        </select>
      </F>
      <F label="Kênh (I-31)">
        <select name="channel" defaultValue={brief?.channel ?? 'TikTok'} className="input">{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select>
      </F>
      <F label="Mục tiêu campaign (I-30)">
        <select name="objective" defaultValue={brief?.objective ?? 'Convert'} className="input">{OBJECTIVES.map((c) => <option key={c}>{c}</option>)}</select>
      </F>
      <F label="Tháng air (I-34)"><input name="airMonth" type="month" defaultValue={brief?.airMonth ?? ''} className="input" /></F>
      <F label="Tuần air (I-34)">
        <select name="airWeek" defaultValue={brief?.airWeek ?? ''} className="input"><option value="">—</option>{[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>Tuần {w}</option>)}</select>
      </F>
      <F label="Giá deal SKU (I-29, ₫)"><input name="dealPrice" inputMode="numeric" defaultValue={brief?.dealPrice ?? ''} className="input" /></F>
      <F label="AOV gian hàng hiện tại (I-29, ₫)"><input name="aov" inputMode="numeric" defaultValue={brief?.aov ?? ''} className="input" /></F>
      <F label="Tổng ngân sách đợt (I-33, ₫)"><input name="budget" inputMode="numeric" defaultValue={brief?.budget ?? ''} className="input" /></F>
      <F label="Trần fee mỗi KOC (I-33, ₫)"><input name="feeCap" inputMode="numeric" defaultValue={brief?.feeCap ?? ''} className="input" /></F>
      <F label="Mục tiêu GMV (I-37, ₫)"><input name="gmvTarget" inputMode="numeric" defaultValue={brief?.gmvTarget ?? ''} className="input" /></F>
      <div className="grid grid-cols-2 gap-2">
        <F label="CR mục tiêu (%)"><input name="crTarget" inputMode="decimal" defaultValue={pct(brief?.crTarget)} className="input" /></F>
        <F label="CTR mục tiêu (%)"><input name="ctrTarget" inputMode="decimal" defaultValue={pct(brief?.ctrTarget)} className="input" /></F>
      </div>
      <F label="Format và thời lượng video (I-35)" wide><input name="format" defaultValue={brief?.format ?? ''} placeholder="9:16, 45 giây – 2 phút" className="input" /></F>
      <fieldset className="col-span-full">
        <legend className="label">Số KOC theo KL và vai trò (I-32)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {KL_LEVELS.map((kl) => (
            <div key={kl} className="flex items-center gap-2 text-[13px]">
              <span className="w-9 font-medium">{kl}</span>
              <input name={`slot|${kl}`} inputMode="numeric" defaultValue={slots.get(kl)?.count ?? ''} placeholder="Số KOC" aria-label={`Số KOC ${kl}`} className="input h-8 w-24" />
              <input name={`role|${kl}`} defaultValue={slots.get(kl)?.role ?? ''} placeholder="Vai trò (review, seeding...)" aria-label={`Vai trò ${kl}`} className="input h-8 min-w-0 flex-1" />
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-ink-3">Đặt số KOC thì pool chỉ lấy các KL này (KOC chưa có KL vẫn được xét).</p>
      </fieldset>
      <F label="KOC brand chỉ định (I-36), mỗi dòng một ID kênh"><textarea name="includeHandles" rows={2} defaultValue={brief?.includeHandles?.join('\n') ?? ''} className="input" /></F>
      <F label="KOC brand cấm (I-36), mỗi dòng một ID kênh"><textarea name="excludeHandles" rows={2} defaultValue={brief?.excludeHandles?.join('\n') ?? ''} className="input" /></F>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="gmvMax" value="1" defaultChecked={brief?.gmvMax ?? false} />Brand chạy GMV Max (bật K14: KOC phải đồng ý ads code)</label>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="expertClaim" value="1" defaultChecked={brief?.expertClaim ?? false} />Nội dung có claim chuyên môn (bật K12: cần chứng chỉ hành nghề)</label>
      <F label="Ghi chú brief" wide><textarea name="note" rows={2} defaultValue={brief?.note ?? ''} className="input" /></F>
      <div className="col-span-full flex justify-end gap-2">
        <Link href={cancel} className="btn">Hủy</Link>
        <button className="btn btn-primary">Lưu</button>
      </div>
    </ActionForm>
  );
}

function F({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block ${wide ? 'col-span-full' : ''}`}><span className="label">{label}</span>{children}</label>;
}
