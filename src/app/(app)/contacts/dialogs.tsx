// Hộp thoại thao tác từng dòng của Danh bạ KOC / KOL (theo bản chốt b2c), mở bằng query (?channels=, ?book=, ?contact=, ?review=).
import Link from 'next/link';
import { ActionForm, Dialog } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import {
  ALL_BRANDS_SCOPE, channelSummary, CONTACT_CHANNELS, CONTACT_STATUS, OTHER_PLATFORMS, READINESS_OPTIONS, ratingSummary, REVIEW_REASONS, reviewSummary,
  TIKTOK_ROLES, VERDICTS,
} from '@/lib/koc/kocDirectory';
import { PRICE_TYPES } from '@/lib/booking/listing';
import { addKocs } from '../listing/actions';
import { deleteReview, logContact, saveChannels, saveReview } from './actions';

type Base = { close: string; next: string };
// id ô chọn kết luận (không dùng "_": Tailwind đổi "_" thành dấu cách trong selector group-has-[...]).
const VERDICT_ID: Record<string, string> = { SUITABLE: 'v-ok', CAUTION: 'v-caution', NOT_SUITABLE: 'v-no' };
const brandName = (b: string) => (b === ALL_BRANDS_SCOPE ? 'Mọi brand' : b);
const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh' });

/** Quản lý tài khoản & kênh kết nối (KocSocialChannelsModal). Kênh TikTok chính khớp booking Lark nên không đổi ở đây. */
export function ChannelsDialog({ koc, channels, close, next }: Base & { koc: { id: string; name: string; handle: string }; channels: { platform: string; handle: string; role: string | null }[] }) {
  const tiktok = channels.filter((c) => c.platform === 'TikTok');
  const total = channels.length + 1;
  const platforms = 1 + OTHER_PLATFORMS.filter((p) => channels.some((c) => c.platform === p.key)).length;
  return (
    <Dialog title={`Kênh của ${koc.name}`} closeHref={close} wide>
      <ActionForm action={saveChannels} className="grid gap-5 text-[13px]">
        <input type="hidden" name="kocId" value={koc.id} />
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="pill bg-sunken text-ink-2">{total} tài khoản</span>
          <span className="pill bg-sunken text-ink-2">{platforms}/5 nền tảng</span>
        </div>

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="font-semibold">Kênh TikTok ({tiktok.length + 1})</h3>
            <span className="text-xs text-ink-3">{tiktok.length ? `1 kênh chính · ${tiktok.length} kênh phụ` : 'Chưa có kênh phụ'}</span>
          </div>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2">
              <span className="font-medium">@{koc.handle}</span>
              <span className="pill bg-accent-soft text-accent">Kênh TikTok chính</span>
              <span className="text-xs text-ink-3">Đổi kênh chính ở "Sửa thông tin KOC".</span>
            </div>
            {tiktok.map((c) => (
              <div key={c.handle} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2">
                <input type="hidden" name="tt" value={c.handle} />
                <a href={`https://www.tiktok.com/@${c.handle}`} target="_blank" rel="noreferrer" className="link font-medium">@{c.handle}</a>
                <select name={`role-${c.handle}`} defaultValue={c.role ?? TIKTOK_ROLES[0][0]} aria-label={`Vai trò kênh @${c.handle}`} className="input h-8 w-auto py-0 text-xs">
                  {TIKTOK_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <label className="ml-auto flex items-center gap-1.5 text-xs text-critical">
                  <input type="checkbox" name={`rm-${c.handle}`} className="size-4" /> Gỡ
                </label>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <input name="newTt" placeholder="Thêm kênh phụ: @tenkenh hoặc link TikTok" aria-label="Thêm kênh TikTok phụ" className="input max-w-xs" />
              <select name="newRole" aria-label="Vai trò kênh mới" className="input w-auto">
                {TIKTOK_ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-2 font-semibold">Nền tảng khác</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {OTHER_PLATFORMS.map((p) => {
              const value = channels.filter((c) => c.platform === p.key).map((c) => c.handle).join(', ');
              return (
                <div key={p.key}>
                  <label className="label flex items-center justify-between" htmlFor={`ch-${p.key}`}>
                    {p.label}
                    <span className={`pill ${value ? 'bg-positive-soft text-positive' : 'bg-sunken text-ink-3'}`}>{value ? 'Đã có' : 'Chưa có'}</span>
                  </label>
                  <input id={`ch-${p.key}`} name={p.key} defaultValue={value} placeholder={p.placeholder} className="input" />
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-xs text-ink-3">Nhiều tài khoản cùng nền tảng: cách nhau dấu phẩy.</p>
        </section>

        <div className="flex justify-end gap-2">
          <Link href={close} className="btn">Đóng</Link>
          <button className="btn btn-primary">Lưu kênh</button>
        </div>
      </ActionForm>
    </Dialog>
  );
}

/** Tạo booking (Đẩy vào Listing): thêm KOC vào một đợt listing; KOC bị chấm điểm thấp thì hỏi lại như b2c. */
export function BookDialog({ koc, ratings, batches, close }: Omit<Base, 'next'> & {
  koc: { name: string; handle: string; channels: { platform: string }[] };
  ratings: { stars: number; tags: string[] }[];
  batches: { id: string; name: string; month: string; brand: string | null }[];
}) {
  const r = ratingSummary(ratings);
  return (
    <Dialog title={`Thêm vào listing · ${koc.name}`} closeHref={close}>
      {r.isLow && (
        <div role="alert" className="mb-4 rounded-md bg-critical-soft px-3 py-2.5 text-[13px] text-critical">
          <p className="font-semibold">KOC có đánh giá thấp</p>
          <p className="mt-1">
            {koc.name} bị chấm {r.average.toLocaleString('vi-VN')} sao ({r.count} lượt{r.negativeTags.length ? `; hay bị nhắc: ${r.negativeTags.join(', ')}` : ''}). Vẫn thêm vào listing?
          </p>
        </div>
      )}
      {batches.length ? (
        <ActionForm action={addKocs} className="grid gap-4">
          <input type="hidden" name="ids" value={koc.handle} />
          <p className="text-[13px] text-ink-2">{channelSummary(koc.handle, koc.channels)} sẽ vào đợt listing bạn chọn để brand duyệt.</p>
          <div>
            <label className="label" htmlFor="batchId">Đợt listing</label>
            <select id="batchId" name="batchId" required className="input">
              {batches.map((b) => <option key={b.id} value={b.id}>{b.month} · {b.name}{b.brand ? ` · ${b.brand}` : ''}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="priceType">Hình thức</label>
            <select id="priceType" name="priceType" defaultValue="Video" className="input">
              {PRICE_TYPES.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Link href={close} className="btn">Hủy</Link>
            <button className={`btn ${r.isLow ? 'btn-danger' : 'btn-primary'}`}>{r.isLow ? 'Vẫn thêm vào listing' : 'Thêm vào listing'}</button>
          </div>
        </ActionForm>
      ) : (
        <p className="text-[13px] text-ink-2">Chưa có đợt listing nào bạn xem được. <Link href="/listing" className="link">Tạo đợt listing</Link> rồi quay lại.</p>
      )}
    </Dialog>
  );
}

/** Ghi lịch sử liên hệ & Tiếp cận KOC mới (KocOutreachModal). Lịch sử liên hệ dùng chung với Ghi chú ở trang KOC. */
export function ContactDialog({ koc, notes, coop, close, next }: Base & {
  koc: { id: string; handle: string; contactStatus: string | null; readiness: string | null; phone: string | null; zalo: string | null; email: string | null; rateCard: number | null; address: string | null };
  notes: { id: string; body: string; channel: string | null; createdAt: Date; author: { name: string | null } | null }[];
  coop: boolean;
}) {
  return (
    <Dialog title={`Ghi liên hệ · @${koc.handle}`} closeHref={close} wide>
      <ActionForm action={logContact} className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="kocId" value={koc.id} />
        <input type="hidden" name="next" value={next} />
        <div>
          <label className="label" htmlFor="contactStatus">Trạng thái liên hệ</label>
          <select id="contactStatus" name="contactStatus" defaultValue={koc.contactStatus ?? 'ĐÃ_LIÊN_HỆ'} className="input">
            {CONTACT_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="readiness">Mức sẵn sàng booking</label>
          <select id="readiness" name="readiness" defaultValue={koc.readiness ?? 'TIẾP_CẬN_BỔ_SUNG_PHÁP_LÝ'} className="input">
            {READINESS_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="channel">Liên hệ qua</label>
          <select id="channel" name="channel" className="input">
            {CONTACT_CHANNELS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="phone">SĐT / Zalo</label>
          <input id="phone" name="phone" type="tel" defaultValue={koc.phone ?? koc.zalo ?? ''} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" defaultValue={koc.email ?? ''} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="rateCard">Giá KOC báo / 1 video (₫)</label>
          <input id="rateCard" name="rateCard" type="number" min={0} step={1000} defaultValue={koc.rateCard ?? ''} className="input" />
        </div>
        <div className="col-span-full">
          <label className="label" htmlFor="address">Địa chỉ nhận hàng mẫu (nếu có)</label>
          <input id="address" name="address" defaultValue={koc.address ?? ''} className="input" />
        </div>
        <div className="col-span-full">
          <label className="label" htmlFor="note">Ghi chú lần liên hệ này</label>
          <textarea id="note" name="note" rows={3} className="input" />
        </div>
        {!coop && (
          <label className="col-span-full flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="close" className="size-4" />
            Chốt hợp tác: chuyển KOC sang tab "KOC đã hợp tác"
          </label>
        )}
        <div className="col-span-full">
          <p className="mb-1.5 text-xs font-semibold text-ink-2">Các lần liên hệ trước ({notes.length})</p>
          {notes.length ? (
            <ul className="grid max-h-48 gap-1.5 overflow-y-auto text-xs">
              {notes.map((n) => (
                <li key={n.id} className="rounded-md bg-sunken px-2.5 py-1.5">
                  <span className="text-ink-3">{fmtTime(n.createdAt)} · {n.author?.name ?? '—'}{n.channel && ` · ${n.channel}`}</span>
                  <p className="mt-0.5 whitespace-pre-line text-ink">{n.body}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-ink-3">Chưa có lần liên hệ nào.</p>}
        </div>
        <div className="col-span-full flex justify-end gap-2">
          <Link href={close} className="btn">Hủy</Link>
          <button className="btn btn-primary">Lưu liên hệ</button>
        </div>
      </ActionForm>
    </Dialog>
  );
}

/** Đánh giá Kênh & Lịch sử đánh giá (KocChannelReviewModal): lý do và gợi ý ý kiến đổi theo kết luận đang chọn (CSS :has, không cần JS). */
export function ReviewDialog({ koc, reviews, brands, verdict, brand, meId, canManage, close, next }: Base & {
  koc: { id: string; handle: string; name: string };
  reviews: { id: string; verdict: string; brand: string; reasons: string[]; note: string; source: string; createdAt: Date; reviewerId: string | null; reviewer: { name: string | null } | null }[];
  brands: string[]; verdict: string; brand: string; meId: string; canManage: boolean;
}) {
  const summary = reviewSummary(reviews);
  const sorted = [...reviews].sort((a, b) => +b.createdAt - +a.createdAt);
  const keys = Object.keys(VERDICTS);
  return (
    <Dialog title={`Đánh giá KOC · @${koc.handle}`} closeHref={close} wide>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ActionForm action={saveReview} className="group/rv grid content-start gap-4 text-[13px]">
          <input type="hidden" name="kocId" value={koc.id} />
          <input type="hidden" name="next" value={next} />
          <h3 className="font-semibold">Đánh giá mới</h3>
          <div>
            <label className="label" htmlFor="rv-brand">Brand *</label>
            <select id="rv-brand" name="brand" defaultValue={brand} className="input">
              <option value={ALL_BRANDS_SCOPE}>{brandName(ALL_BRANDS_SCOPE)}</option>
              {brands.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
          <fieldset>
            <legend className="label">Kết luận *</legend>
            <div className="flex flex-wrap gap-2">
              {keys.map((v) => (
                <label key={v} className={`pill cursor-pointer px-3 py-1.5 ring-1 ring-line has-[:checked]:ring-2 has-[:checked]:ring-ink ${VERDICTS[v].tone}`}>
                  <input type="radio" name="verdict" value={v} defaultChecked={v === verdict} className="sr-only" id={VERDICT_ID[v]} />
                  {VERDICTS[v].button}
                </label>
              ))}
            </div>
          </fieldset>
          {keys.map((v) => (
            <div key={v} className={`hidden gap-4 ${v === 'SUITABLE' ? 'group-has-[#v-ok:checked]/rv:grid' : v === 'CAUTION' ? 'group-has-[#v-caution:checked]/rv:grid' : 'group-has-[#v-no:checked]/rv:grid'}`}>
              <div>
                <label className="label" htmlFor={`note-${v}`}>Nhận xét</label>
                <textarea id={`note-${v}`} name={`note-${v}`} rows={3} placeholder={VERDICTS[v].placeholder} className="input text-xs" />
              </div>
              <fieldset>
                <legend className="label">Lý do (chọn một hoặc nhiều)</legend>
                <div className="flex flex-wrap gap-1.5">
                  {REVIEW_REASONS[v].map((r, i) => (
                    <label key={r} className="pill cursor-pointer bg-surface px-2.5 py-1 text-xs text-ink-2 ring-1 ring-line has-[:checked]:bg-accent-soft has-[:checked]:text-accent">
                      <input type="checkbox" name={`reason-${v}`} value={r} defaultChecked={i === 0} className="sr-only" />
                      {r}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          ))}
          <div className="flex justify-end gap-2">
            <Link href={close} className="btn">Đóng</Link>
            <button className="btn btn-primary">Lưu đánh giá</button>
          </div>
        </ActionForm>

        <section id="lich-su" className="grid content-start gap-3 text-[13px]">
          <h3 className="font-semibold">Lịch sử đánh giá{summary && ` (${summary.total})`}</h3>
          {summary ? (
            <>
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="tbl text-xs">
                  <thead><tr><th>Brand</th><th>Kết luận gần nhất</th><th>Nhận xét</th><th>Người đánh giá</th></tr></thead>
                  <tbody>
                    {summary.byBrand.map((b) => (
                      <tr key={b.brand}>
                        <td>{brandName(b.brand)}{b.count > 1 && <span className="text-ink-3"> · {b.count} lượt</span>}</td>
                        <td><span className={`pill ${VERDICTS[b.latest.verdict]?.tone}`}>{VERDICTS[b.latest.verdict]?.short}</span></td>
                        <td className="max-w-[220px]"><span className="line-clamp-2" title={b.latest.note}>{b.latest.note}</span></td>
                        <td className="whitespace-nowrap text-ink-3">{b.latest.reviewer?.name ?? '—'}<br />{fmtDate(b.latest.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="grid max-h-80 gap-2 overflow-y-auto">
                {sorted.map((r) => (
                  <li key={r.id} className="rounded-md border border-line px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`pill ${VERDICTS[r.verdict]?.tone}`}>{VERDICTS[r.verdict]?.label}</span>
                      <span className="font-medium">{brandName(r.brand)}</span>
                      <span className="text-ink-3">{r.reviewer?.name ?? '—'} · {fmtTime(r.createdAt)}</span>
                      {(r.reviewerId === meId || canManage) && (
                        <form action={deleteReview} className="ml-auto">
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="next" value={next} />
                          <button className="text-critical hover:underline" title="Xóa lượt đánh giá này">Xóa</button>
                        </form>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-line">{r.note}</p>
                    {r.reasons.length > 0 && <p className="mt-1 text-xs text-ink-3">{r.reasons.join(' · ')}</p>}
                    <p className="mt-0.5 text-[11px] text-ink-3">Ghi từ: {r.source}</p>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="text-ink-3">Chưa có đánh giá nào.</p>}
        </section>
      </div>
    </Dialog>
  );
}
