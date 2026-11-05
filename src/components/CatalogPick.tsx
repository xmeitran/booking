// Chọn brand · gian hàng · sản phẩm từ Danh mục (thay ô gõ tự do, để Listing / Job khớp đúng brand).
type Brand = { id: string; name: string; stores: { id: string; name: string }[]; products: { id: string; name: string }[] };

/** Khoá mặc định từ tên brand / gian hàng đã lưu (đợt listing cũ lưu bằng tên). */
export function placeKey(brands: Brand[], brand: string | null, store: string | null) {
  const n = (s: string | null) => (s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const b = brands.find((x) => n(x.name) === n(brand));
  if (!b) return '';
  const s = b.stores.find((x) => n(x.name) === n(store));
  return s ? `s:${s.id}` : `b:${b.id}`;
}

export function CatalogPick({ brands, place = '', productId = '', productText = '' }: { brands: Brand[]; place?: string; productId?: string; productText?: string }) {
  if (!brands.length) {
    return (
      <p className="col-span-full rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning">
        Danh mục chưa có brand. Vào Danh mục bấm &quot;Lấy brand từ booking Lark&quot; hoặc thêm brand trước.
      </p>
    );
  }
  return (
    <>
      <label className="col-span-full block">
        <span className="label">Brand · gian hàng (từ Danh mục)</span>
        <select name="place" required defaultValue={place} className="input">
          <option value="">— Chọn brand / gian hàng —</option>
          {brands.map((b) => (
            <optgroup key={b.id} label={b.name}>
              <option value={`b:${b.id}`}>{b.name} · chưa chọn gian hàng</option>
              {b.stores.map((s) => <option key={s.id} value={`s:${s.id}`}>{b.name} · {s.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Sản phẩm (từ Danh mục)</span>
        <select name="productId" defaultValue={productId} className="input">
          <option value="">—</option>
          {brands.filter((b) => b.products.length).map((b) => (
            <optgroup key={b.id} label={b.name}>{b.products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">hoặc tên sản phẩm (chưa có trong Danh mục)</span>
        <input name="product" defaultValue={productText} className="input" />
      </label>
    </>
  );
}
