import Link from 'next/link';
import { ActionForm } from '@/components/ui';
import { NUM_FIELDS, TIKTOK_CATEGORIES, type Criteria } from '@/lib/matching';
import { KL_LEVELS } from '../contacts/platforms';
import { saveBrief } from './actions';

type Brief = { id?: string; name?: string; category?: string | null; brand?: string | null; brandId?: string | null; guideline?: string | null; strategy?: string | null; plan?: string | null; note?: string | null };

/** Form best practice ngành hàng (template) hoặc brief brand; cả hai có bộ tiêu chí lọc KOC. */
export function BriefForm({ brief, template, criteria, niches, categories, cancel, brands = [] }: {
  brief?: Brief; template: boolean; criteria: Criteria; niches: string[]; categories: string[]; cancel: string; brands?: { id: string; name: string }[];
}) {
  const area = (name: keyof Brief, label: string, placeholder: string) => (
    <label className="col-span-full block">
      <span className="label">{label}</span>
      <textarea name={name} rows={3} defaultValue={(brief?.[name] as string) ?? ''} placeholder={placeholder} className="input" />
    </label>
  );
  return (
    <ActionForm action={saveBrief} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={brief?.id ?? ''} />
      <input type="hidden" name="template" value={template ? '1' : ''} />
      <label className={`block ${template ? '' : 'col-span-full'}`}>
        <span className="label">{template ? 'Tên best practice' : 'Tên brief'}</span>
        <input name="name" required defaultValue={brief?.name ?? ''} placeholder={template ? 'Làm đẹp – dung dịch vệ sinh' : 'pH Care – T12 – ra mắt sản phẩm mới'} className="input" />
      </label>
      {!template && (
        <label className="block">
          <span className="label">Brand</span>
          {brands.length ? (
            <select name="brandId" defaultValue={brief?.brandId ?? ''} className="input">
              <option value="">— Chọn từ Danh mục —</option>
              {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          ) : <input name="brand" defaultValue={brief?.brand ?? ''} className="input" />}
        </label>
      )}
      <label className="block">
        <span className="label">Ngành hàng</span>
        <input name="category" list="categories" defaultValue={brief?.category ?? ''} className="input" />
        <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      {template ? (
        area('note', 'Best practice của ngành', 'Loại KOC hiệu quả, định dạng video, khung giờ air, mức giá hợp lý, lưu ý...')
      ) : (
        <>
          {area('guideline', 'Brand guideline', 'Link tài liệu + điểm chính: tone, từ cấm, claim được phép...')}
          {area('strategy', 'Content strategy', 'Thông điệp, góc tiếp cận, định dạng (review, unbox, POV...)')}
          {area('plan', 'Content plan', 'Số video, lịch air, phân bổ theo tuần / KOC...')}
          {area('note', 'Ghi chú', '')}
        </>
      )}

      <p className="col-span-full -mb-1 border-t border-line pt-3 text-xs font-semibold text-ink-2">Bộ tiêu chí lọc KOC (để trống = không xét)</p>
      <fieldset className="col-span-full">
        <legend className="label">Tệp kênh</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {niches.map((n) => (
            <label key={n} className="flex items-center gap-1.5"><input type="checkbox" name="niches" value={n} defaultChecked={criteria.niches?.includes(n)} />{n}</label>
          ))}
        </div>
      </fieldset>
      <fieldset className="col-span-full">
        <legend className="label">Cấp KOL</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {KL_LEVELS.map((n) => (
            <label key={n} className="flex items-center gap-1.5"><input type="checkbox" name="kl" value={n} defaultChecked={criteria.kl?.includes(n)} />{n}</label>
          ))}
        </div>
      </fieldset>
      {NUM_FIELDS.map(([k, label]) => (
        <label key={k} className="block">
          <span className="label">{label}</span>
          <input name={k} inputMode="numeric" defaultValue={criteria[k]?.toString() ?? ''} className="input" />
        </label>
      ))}
      <label className="block">
        <span className="label">Ngành hàng TikTok (theo GMV của KOC)</span>
        <select name="ttCategory" defaultValue={criteria.category ?? ''} className="input">
          <option value="">—</option>
          {TIKTOK_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="label">Hợp tác với UpBase</span>
        <select name="collab" defaultValue={criteria.collab ?? ''} className="input">
          <option value="">Bất kỳ</option>
          <option value="yes">Đã hợp tác</option>
          <option value="no">Chưa hợp tác</option>
        </select>
      </label>
      <div className="col-span-full flex justify-end gap-2">
        <Link href={cancel} className="btn">Hủy</Link>
        <button className="btn btn-primary">Lưu</button>
      </div>
    </ActionForm>
  );
}
