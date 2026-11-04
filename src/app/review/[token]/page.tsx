import type { Metadata } from 'next';
import { BrandLogo } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtNum, fmtPct, fmtShort } from '@/lib/format';
import { BRAND_CHOICE, loadListing } from '@/lib/listing';
import { submitReview } from '../actions';

export const metadata: Metadata = { title: 'Duyệt KOC · UpBase', robots: { index: false, follow: false } };

// Trang Brand mở bằng link, không đăng nhập. Chỉ hiện cột được phép gửi Brand: không SĐT, địa chỉ, ngân hàng, CCCD.
export default async function ReviewPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { token } = await params;
  const { saved } = await searchParams;
  const b = await db.listingBatch.findFirst({ where: { shareToken: token }, select: { id: true } });
  const data = b ? await loadListing(b.id) : null;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="border-b border-line bg-surface px-4 py-3 md:px-6"><BrandLogo size={20} /></header>
      <main className="mx-auto max-w-7xl px-4 py-5 md:px-6">
        {!data ? (
          <p className="py-16 text-center text-ink-2">Link không còn hiệu lực. Vui lòng liên hệ UpBase để nhận link mới.</p>
        ) : (
          <>
            <h1 className="text-xl font-semibold">{data.batch.name}</h1>
            <p className="mt-1 text-[13px] text-ink-2">
              {[data.batch.brand, data.batch.store, data.batch.product].filter(Boolean).join(' · ')} · {data.rows.length} KOC đề xuất.
              Chọn Yes / No / Cân nhắc cho từng KOC, ghi lý do nếu từ chối, rồi bấm Gửi phản hồi.
            </p>
            {saved !== undefined && (
              <p role="status" className="mt-3 rounded-md bg-positive-soft px-3 py-2 text-positive">Đã ghi nhận phản hồi ({saved} KOC thay đổi). Cảm ơn bạn!</p>
            )}
            <form action={submitReview} className="mt-4">
              <input type="hidden" name="token" value={token} />
              <div className="overflow-x-auto rounded-lg border border-line bg-surface">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>KOC</th><th className="text-right">Follower</th><th>Hiệu quả 30 ngày</th><th>Khán giả</th>
                      <th className="text-right">Chi phí (kèm thuế TNCN)</th><th className="text-right">Dự báo</th><th>UpBase đề xuất</th><th>Brand chọn</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.item.id} className="align-top">
                        <td>
                          <a href={r.koc.channelUrl ?? `https://www.tiktok.com/@${r.koc.handle}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">{r.koc.nickname ?? r.koc.name}</a>
                          <div className="text-xs text-ink-3">@{r.koc.handle}{r.kl && ` · ${r.kl}`}{r.koc.niche && ` · ${r.koc.niche}`}</div>
                        </td>
                        <td className="text-right">{fmtShort(r.koc.followers)}</td>
                        <td className="text-xs whitespace-nowrap">
                          <div>{fmtNum(r.koc.avgViews)} view TB / video</div>
                          <div className="text-ink-3">{fmtNum(r.koc.unitsSold)} món · GMV {r.koc.gmvRange ?? '—'}</div>
                        </td>
                        <td className="text-xs whitespace-nowrap">
                          {r.p.female != null ? <>Nữ {fmtPct(r.p.female, 0)} · 18–24 {fmtPct(r.p.age18_24, 0)} · 25–34 {fmtPct(r.p.age25_34, 0)}</> : '—'}
                        </td>
                        <td className="text-right text-xs whitespace-nowrap">
                          <div>{fmtNum(r.f.fee)}</div>
                          <div className="text-ink-3">{r.item.priceType}</div>
                        </td>
                        <td className="text-right text-xs whitespace-nowrap">
                          <div>GMV {fmtShort(r.f.gmvTarget)}</div>
                          <div className="text-ink-3">View {fmtShort(r.viewTarget)}</div>
                        </td>
                        <td className="max-w-56 text-xs">
                          {r.item.recommendation && <div className="font-medium">{r.item.recommendation}</div>}
                          {r.item.contentNote && <div className="text-ink-3">{r.item.contentNote}</div>}
                        </td>
                        <td className="min-w-48">
                          <select name={`c_${r.item.id}`} defaultValue={r.item.brandChoice ?? ''} aria-label={`Brand chọn @${r.koc.handle}`} className="input h-8 text-xs">
                            <option value="">Chưa chọn</option>
                            {BRAND_CHOICE.map((c) => <option key={c}>{c}</option>)}
                          </select>
                          <input name={`r_${r.item.id}`} defaultValue={r.item.rejectReason ?? ''} placeholder="Lý do (nếu No / Cân nhắc)" aria-label={`Lý do @${r.koc.handle}`} className="input mt-1 h-8 text-xs" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex justify-end"><button className="btn btn-primary">Gửi phản hồi</button></div>
            </form>
            <p className="mt-3 text-xs text-ink-3">Số liệu 30 ngày từ TikTok Shop. Dự báo GMV = View Target × GPM / 1000.</p>
          </>
        )}
      </main>
    </div>
  );
}
