import Link from 'next/link';
import type { MatchBrief } from '@prisma/client';
import { ActionForm } from '@/components/ui';
import { CHANNELS, KL_LEVELS, OBJECTIVE_LABEL, OBJECTIVES, parseNeeds, parseSlots } from '@/lib/matching/spec';
import { aiFillBrief, saveBrief } from './actions';

type Brand = { id: string; name: string; products: { id: string; name: string; sku: string | null }[] };

/** Ô "AI điền giúp": dán brief của brand, AI điền form (đợt mới thì tạo đợt rồi mở form để xem lại). */
export function AiBriefBox({ briefId, plan }: { briefId?: string; plan?: string | null }) {
  return (
    <ActionForm action={aiFillBrief} pendingText="AI đang đọc brief, khoảng 20–60 giây…" className="grid gap-2 rounded-lg border border-accent/30 bg-accent-soft/40 p-3">
      <input type="hidden" name="id" value={briefId ?? ''} />
      <label className="block">
        <span className="label">Tải file brief / content plan của brand (PDF hoặc ảnh, tối đa 18 MB)</span>
        <input type="file" name="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="block w-full text-[13px] text-ink-2 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-[13px] file:text-ink" />
        <span className="mt-0.5 block text-xs text-ink-3">Brief trên Canva: mở link → Chia sẻ → Tải xuống → PDF, rồi chọn file ở đây. AI đọc được cả chữ trong hình.</span>
      </label>
      <label className="block">
        <span className="label">Hoặc dán nội dung brief (có file thì ô này là ghi chú thêm)</span>
        <textarea name="brief" rows={3} defaultValue={plan ?? ''} placeholder="Dán nội dung brief: sản phẩm, khách hàng mục tiêu, số KOC, ngân sách, thời gian air, điều cấm…" className="input" />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-3">AI chỉ điền, bạn xem lại rồi bấm Lưu. AI cũng gợi ý từ khoá để tìm thêm KOC.</span>
        <button className="btn btn-primary h-8 px-3 text-xs">AI đọc brief</button>
      </div>
    </ActionForm>
  );
}

/** Form yêu cầu của đợt. Brand, sản phẩm chọn từ Danh mục. */
export function BriefForm({ brief, brands, cancel }: { brief?: Partial<MatchBrief>; brands: Brand[]; cancel: string }) {
  const slots = new Map(parseSlots(brief?.slots).map((s) => [s.kl, s]));
  const nd = parseNeeds(brief?.needs);
  const pct = (x: number | null | undefined) => (x == null ? '' : String(+(x * 100).toFixed(2)));
  const lines = (xs?: string[]) => (xs ?? []).join('\n');
  return (
    <ActionForm action={saveBrief} className="grid gap-5">
      <input type="hidden" name="id" value={brief?.id ?? ''} />

      <Part title="1. Thông tin đợt">
        <F label="Tên đợt" wide><input name="name" required defaultValue={brief?.name ?? ''} placeholder="Ziaja – Kem tay – T12/2026" className="input" /></F>
        <F label="Brand">
          <select name="brandId" defaultValue={brief?.brandId ?? ''} className="input">
            <option value="">— Chọn brand —</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </F>
        <F label="Sản phẩm">
          <select name="productId" defaultValue={brief?.productId ?? ''} className="input">
            <option value="">— Chọn sản phẩm —</option>
            {brands.filter((b) => b.products.length).map((b) => (
              <optgroup key={b.id} label={b.name}>{b.products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ''}</option>)}</optgroup>
            ))}
          </select>
        </F>
        <F label="Kênh"><select name="channel" defaultValue={brief?.channel ?? 'TikTok'} className="input">{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></F>
        <F label="Mục tiêu"><select name="objective" defaultValue={brief?.objective ?? 'Convert'} className="input">{OBJECTIVES.map((c) => <option key={c} value={c}>{OBJECTIVE_LABEL[c]}</option>)}</select></F>
        <F label="Tháng air"><input name="airMonth" type="month" defaultValue={brief?.airMonth ?? ''} className="input" /></F>
        <F label="Tuần air">
          <select name="airWeek" defaultValue={brief?.airWeek ?? ''} className="input"><option value="">Chưa rõ</option>{[1, 2, 3, 4, 5].map((w) => <option key={w} value={w}>Tuần {w}</option>)}</select>
        </F>
      </Part>

      <Part title="2. Cần bao nhiêu KOC" note="Điền số KOC cần cho từng cấp. Có điền thì hệ thống chỉ tìm KOC đúng các cấp này.">
        <div className="col-span-full grid gap-2 sm:grid-cols-2">
          {KL_LEVELS.map((kl) => (
            <div key={kl} className="flex items-center gap-2 text-[13px]">
              <span className="w-9 font-medium">{kl}</span>
              <input name={`slot|${kl}`} inputMode="numeric" defaultValue={slots.get(kl)?.count ?? ''} placeholder="Số KOC" aria-label={`Số KOC ${kl}`} className="input h-8 w-24" />
              <input name={`role|${kl}`} defaultValue={slots.get(kl)?.role ?? ''} placeholder="Vai trò (review, seeding…)" aria-label={`Vai trò ${kl}`} className="input h-8 min-w-0 flex-1" />
            </div>
          ))}
        </div>
      </Part>

      <Part title="3. Ngân sách">
        <F label="Tổng ngân sách (₫)"><input name="budget" inputMode="numeric" defaultValue={brief?.budget ?? ''} className="input" /></F>
        <F label="Phí tối đa mỗi KOC (₫)"><input name="feeCap" inputMode="numeric" defaultValue={brief?.feeCap ?? ''} className="input" /></F>
        <F label="Mục tiêu GMV (₫)"><input name="gmvTarget" inputMode="numeric" defaultValue={brief?.gmvTarget ?? ''} className="input" /></F>
      </Part>

      <Part title="4. Yêu cầu nội dung" note="Dùng để tìm thêm KOC theo từ khoá, loại KOC nhắc đối thủ / dùng từ cấm, và để AI gợi ý Tone khớp brand.">
        <F label="Tóm tắt yêu cầu" wide><textarea name="needs_summary" rows={2} defaultValue={nd.summary ?? ''} placeholder="Sản phẩm gì, thông điệp chính, kiểu KOC cần" className="input" /></F>
        <F label="Từ khoá tìm KOC (cách nhau dấu phẩy)" wide><input name="needs_keywords" defaultValue={(nd.keywords ?? []).join(', ')} placeholder="kem chống nắng, da dầu mụn, nâng tông" className="input" /></F>
        <F label="Khách hàng là">
          <select name="needs_targetGender" defaultValue={nd.targetGender ?? ''} className="input"><option value="">Không giới hạn</option><option>Nữ</option><option>Nam</option></select>
        </F>
        <div className="grid grid-cols-2 gap-2">
          <F label="Tuổi từ"><input name="needs_ageMin" inputMode="numeric" defaultValue={nd.ageMin ?? ''} className="input" /></F>
          <F label="đến"><input name="needs_ageMax" inputMode="numeric" defaultValue={nd.ageMax ?? ''} className="input" /></F>
        </div>
        <F label="Tone / phong cách"><input name="needs_tone" defaultValue={nd.tone ?? ''} placeholder="Gần gũi, chân thật" className="input" /></F>
        <F label="Thông điệp chính"><input name="needs_usp" defaultValue={nd.usp ?? ''} className="input" /></F>
        <F label="Đối thủ (mỗi dòng một brand)"><textarea name="needs_competitors" rows={2} defaultValue={lines(nd.competitors)} className="input" /></F>
        <F label="Từ / claim bị cấm (mỗi dòng một từ)"><textarea name="needs_bannedWords" rows={2} defaultValue={lines(nd.bannedWords)} className="input" /></F>
        <F label="Kiểu KOC không muốn (mỗi dòng một ý)" wide><textarea name="needs_exclusions" rows={2} defaultValue={lines(nd.exclusions)} className="input" /></F>
        <input type="hidden" name="needs_regions" value={(nd.regions ?? []).join(', ')} />
        <F label="Nội dung brief gốc" wide><textarea name="plan" rows={3} defaultValue={brief?.plan ?? ''} className="input" /></F>
      </Part>

      <details className="rounded-lg border border-line px-4 py-3">
        <summary className="cursor-pointer text-[13px] font-semibold">Nâng cao (không bắt buộc)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <F label="Giá bán sản phẩm trong đợt (₫)"><input name="dealPrice" inputMode="numeric" defaultValue={brief?.dealPrice ?? ''} className="input" /></F>
          <F label="Giá trị đơn trung bình của gian hàng (₫)"><input name="aov" inputMode="numeric" defaultValue={brief?.aov ?? ''} className="input" /></F>
          <F label="Tỷ lệ chuyển đổi mục tiêu (%)"><input name="crTarget" inputMode="decimal" defaultValue={pct(brief?.crTarget)} className="input" /></F>
          <F label="Tỷ lệ bấm mục tiêu (%)"><input name="ctrTarget" inputMode="decimal" defaultValue={pct(brief?.ctrTarget)} className="input" /></F>
          <F label="Định dạng, thời lượng video" wide><input name="format" defaultValue={brief?.format ?? ''} placeholder="9:16, 45 giây – 2 phút" className="input" /></F>
          <F label="KOC brand chỉ định (mỗi dòng một @ID)"><textarea name="includeHandles" rows={2} defaultValue={brief?.includeHandles?.join('\n') ?? ''} className="input" /></F>
          <F label="KOC brand không muốn (mỗi dòng một @ID)"><textarea name="excludeHandles" rows={2} defaultValue={brief?.excludeHandles?.join('\n') ?? ''} className="input" /></F>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="gmvMax" value="1" defaultChecked={brief?.gmvMax ?? false} />Brand chạy GMV Max (KOC phải cho chạy ads code)</label>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="expertClaim" value="1" defaultChecked={brief?.expertClaim ?? false} />Nội dung nói về chuyên môn (KOC cần chứng chỉ hành nghề)</label>
          <F label="Ghi chú" wide><textarea name="note" rows={2} defaultValue={brief?.note ?? ''} className="input" /></F>
        </div>
      </details>

      <div className="flex justify-end gap-2">
        <Link href={cancel} className="btn">Hủy</Link>
        <button className="btn btn-primary">Lưu</button>
      </div>
    </ActionForm>
  );
}

function Part({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-1 text-[13px] font-semibold">{title}</legend>
      {note && <p className="col-span-full -mt-1 text-xs text-ink-3">{note}</p>}
      {children}
    </fieldset>
  );
}

function F({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`block ${wide ? 'col-span-full' : ''}`}><span className="label">{label}</span>{children}</label>;
}
