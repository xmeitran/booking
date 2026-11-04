import Link from 'next/link';

const vn = new Intl.NumberFormat('vi-VN');

/** Phân trang qua ?page=, giữ nguyên các tham số lọc khác. */
export function Pager({ params, page, perPage, total }: { params: URLSearchParams; page: number; perPage: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const href = (p: number) => {
    const q = new URLSearchParams(params);
    if (p > 1) q.set('page', String(p));
    else q.delete('page');
    return q.size ? `?${q}` : '?';
  };
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-ink-3">
      <span>
        {total && page <= pages ? `${vn.format((page - 1) * perPage + 1)}–${vn.format(Math.min(page * perPage, total))}` : 0} / {vn.format(total)}
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 ? <Link href={href(page - 1)} className="btn h-8">Trước</Link> : <span className="btn h-8 opacity-40">Trước</span>}
          <span>Trang {page}/{pages}</span>
          {page < pages ? <Link href={href(page + 1)} className="btn h-8">Sau</Link> : <span className="btn h-8 opacity-40">Sau</span>}
        </div>
      )}
    </div>
  );
}

export const pageOf = (v: string | undefined) => Math.max(1, Number.parseInt(v ?? '1', 10) || 1);
