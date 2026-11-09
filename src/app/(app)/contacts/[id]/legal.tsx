// Hồ sơ pháp lý của KOC (KocLegalProfilesSection + LegalProfileFormModal của b2c). Số CCCD / MST / số TK chỉ hiện đủ với quyền
// "Xem số tài khoản, CCCD"; sửa cần thêm quyền "Sửa danh bạ KOC". Hồ sơ mặc định được dùng cho ĐNTT, listing, job.
import Link from 'next/link';
import { ActionForm, Dialog, Menu } from '@/components/ui';
import { fmtDate } from '@/lib/format';
import {
  CONTRACT_STATUS, contractReadiness, DEFAULT_SIGN_ROLE, DEFAULT_TAX_ACCOUNT, DEFAULT_VAT, LEGAL_FORM_LABEL, LEGAL_TYPE_LABEL, LEGAL_TYPES, mask, profileCode,
  SIGN_ROLES, TAX_ACCOUNT_OPTIONS, VAT_OPTIONS, type LegalProfileView, type LegalType,
} from '@/lib/kocDirectory';
import { deleteLegalProfile, saveLegalProfile, setDefaultLegalProfile } from '../actions';

type Full = LegalProfileView & {
  signRole?: string | null; representativeName?: string | null; authorizationNumber?: string | null; authorizationDate?: string | null; vatRatePercent?: number | null;
  contactEmail?: string | null; notes?: string | null; contractCode?: string | null; contractSignedAt?: Date | null; contractUrl?: string | null;
};
type Koc = { id: string; name: string; phone: string | null; address: string | null };

const contractLabel = (s?: string | null) => (s === 'ĐÃ_KÝ' ? 'Đã có file HĐNT ký' : s === 'ĐANG_TRÌNH_KÝ' ? 'Đang trình ký' : s === 'HẾT_HẠN' ? 'HĐNT hết hạn' : 'Chưa có file HĐNT ký');

export function LegalSection({ koc, profiles, reveal, canSee, canEdit, base }: { koc: Koc; profiles: Full[]; reveal: boolean; canSee: boolean; canEdit: boolean; base: string }) {
  const show = (v?: string | null) => (!v ? '—' : canSee && reveal ? v : mask(v));
  const href = (q: string) => `${base}?${q}#ho-so-phap-ly`;
  return (
    <section id="ho-so-phap-ly" className="mb-4 scroll-mt-4 rounded-lg border border-line bg-surface px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Hồ sơ pháp lý ({profiles.length})</h2>
        <div className="flex flex-wrap gap-2">
          {canSee && profiles.length > 0 && <Link href={reveal ? `${base}#ho-so-phap-ly` : href('reveal=1')} className="btn h-8 text-xs">{reveal ? 'Ẩn số CCCD' : 'Hiện số CCCD'}</Link>}
          {canEdit && <Link href={href('lp=new')} className="btn btn-primary h-8 text-xs">Thêm hồ sơ pháp lý</Link>}
        </div>
      </div>
      {!profiles.length ? (
        <div className="grid justify-items-center gap-2 py-6 text-[13px] text-ink-3">
          <p>KOC chưa có hồ sơ pháp lý</p>
          {canEdit && <Link href={href('lp=new')} className="btn">Thêm hồ sơ pháp lý đầu tiên</Link>}
        </div>
      ) : (
        <div className="grid gap-3">
          {profiles.map((p) => {
            const r = contractReadiness(p, koc);
            const individual = p.legalType === 'INDIVIDUAL';
            return (
              <article key={p.code} className="rounded-md border border-line p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-ink-2">{p.code}</span>
                  <span className="font-semibold">{p.holderName || '—'}</span>
                  <span className="pill bg-sunken text-ink-2">{LEGAL_TYPE_LABEL[p.legalType]}</span>
                  {p.isDefault && <span className="pill bg-accent-soft text-accent">Mặc định</span>}
                  <span className={`pill ${r.ready ? 'bg-positive-soft text-positive' : 'bg-warning-soft text-warning'}`} title={r.missing.length ? `Thiếu: ${r.missing.join(', ')}` : undefined}>
                    {r.ready ? `Đủ thông tin ký HĐ (${r.filled}/${r.total})` : `Thiếu ${r.missing.length} trường HĐ`}
                  </span>
                  {!p.id && <span className="text-xs text-ink-3">Dựng từ CCCD / số TK đồng bộ Lark, chưa lưu hồ sơ</span>}
                  {canEdit && (
                    <span className="ml-auto flex items-center gap-2">
                      <Link href={href(`lp=${p.id ?? 'legacy'}`)} className="btn h-8 text-xs">Sửa hồ sơ</Link>
                      {p.id && (profiles.length > 1) && (
                        <Menu label={`Thao tác với ${p.code}`}>
                          {!p.isDefault && (
                            <form action={setDefaultLegalProfile}>
                              <input type="hidden" name="id" value={p.id} />
                              <input type="hidden" name="next" value={`${base}#ho-so-phap-ly`} />
                              <button className="item">Đặt làm hồ sơ mặc định</button>
                            </form>
                          )}
                          <form action={deleteLegalProfile}>
                            <input type="hidden" name="id" value={p.id} />
                            <input type="hidden" name="next" value={`${base}#ho-so-phap-ly`} />
                            <button className="item text-critical">Xóa hồ sơ pháp lý này</button>
                          </form>
                        </Menu>
                      )}
                    </span>
                  )}
                </div>
                <div className="grid gap-4 text-[13px] md:grid-cols-2">
                  <dl className="grid grid-cols-[150px_1fr] gap-x-3 gap-y-1">
                    <dt className="col-span-full mb-1 text-xs font-semibold text-ink-2">Định danh pháp nhân & thuế</dt>
                    <dt className="text-ink-3">Chế độ thuế</dt><dd>{p.taxAccountType ?? '—'}</dd>
                    {individual && <><dt className="text-ink-3">Số CCCD</dt><dd className="font-mono text-xs">{show(p.cccd)}</dd></>}
                    <dt className="text-ink-3">{individual ? 'MST cá nhân' : 'Mã số thuế / ĐKKD'}</dt><dd className="font-mono text-xs">{show(p.taxCode ?? p.businessLicenseNo)}</dd>
                    {!individual && <><dt className="text-ink-3">Người đại diện</dt><dd>{[p.representativeName, p.representativeTitle].filter(Boolean).join(' · ') || '—'}</dd></>}
                    {individual && <><dt className="text-ink-3">Ngày & nơi cấp</dt><dd>{[p.cccdIssueDate, p.cccdIssuePlace].filter(Boolean).join(' · ') || '—'}</dd></>}
                    <dt className="text-ink-3">{individual ? 'Địa chỉ thường trú' : 'Địa chỉ đăng ký'}</dt><dd>{p.address ?? '—'}</dd>
                    <dt className="text-ink-3">Liên hệ hợp đồng</dt><dd>{p.contactPhone ? show(p.contactPhone) : '—'}</dd>
                    <dt className="text-ink-3">Ngân hàng</dt><dd>{p.bankName ?? '—'}</dd>
                    <dt className="text-ink-3">Số tài khoản</dt><dd className="font-mono text-xs">{show(p.bankAccount)}</dd>
                    <dt className="text-ink-3">Chủ tài khoản</dt><dd>{p.bankHolderName ?? '—'}</dd>
                  </dl>
                  <dl className="grid content-start grid-cols-[150px_1fr] gap-x-3 gap-y-1">
                    <dt className="col-span-full mb-1 text-xs font-semibold text-ink-2">Hợp đồng nguyên tắc (HĐNT)</dt>
                    <dt className="text-ink-3">Trạng thái HĐNT</dt>
                    <dd><span className={`pill ${p.contractStatus === 'ĐÃ_KÝ' ? 'bg-positive-soft text-positive' : p.contractStatus === 'ĐANG_TRÌNH_KÝ' ? 'bg-warning-soft text-warning' : 'bg-sunken text-ink-3'}`}>{contractLabel(p.contractStatus)}</span></dd>
                    {p.contractCode && <><dt className="text-ink-3">Mã HĐNT</dt><dd>{p.contractCode}</dd></>}
                    {p.contractSignedAt && <><dt className="text-ink-3">Ngày ký</dt><dd>{fmtDate(p.contractSignedAt)}</dd></>}
                    {p.contractUrl && <><dt className="text-ink-3">File</dt><dd><a href={p.contractUrl} target="_blank" rel="noreferrer" className="link">Mở file HĐNT đã ký</a></dd></>}
                    {p.notes && <><dt className="text-ink-3">Ghi chú</dt><dd className="whitespace-pre-line">{p.notes}</dd></>}
                  </dl>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Form thêm / sửa hồ sơ. Đổi loại pháp nhân bằng link (?type=) để danh sách chế độ thuế, VAT, nhãn trường đổi theo, không cần JS. */
export function LegalDialog({ koc, profile, type, nextNo, banks, base }: { koc: Koc; profile: Full | null; type?: string; nextNo: number; banks: string[]; base: string }) {
  const legalType = (LEGAL_TYPES.includes(type as LegalType) ? type : profile?.legalType ?? 'INDIVIDUAL') as LegalType;
  const sameType = profile?.legalType === legalType;
  const v = (k: keyof Full) => (sameType || ['holderName', 'contactPhone', 'contactEmail', 'address', 'bankName', 'bankAccount', 'bankHolderName', 'notes'].includes(k) ? profile?.[k] ?? '' : '') as string;
  const individual = legalType === 'INDIVIDUAL';
  const close = `${base}#ho-so-phap-ly`;
  const editing = profile?.id ? profile : null;
  const lpParam = profile?.id ?? (profile ? 'legacy' : 'new');
  const vat = editing && sameType && editing.vatRatePercent != null ? editing.vatRatePercent : DEFAULT_VAT[legalType];
  return (
    <Dialog title={profile ? `Sửa hồ sơ pháp lý ${profile.code} — ${koc.name}` : `Thêm hồ sơ pháp lý mới (${profileCode(nextNo)}) — ${koc.name}`} closeHref={close} wide>
      <div className="mb-4">
        <p className="label">Loại hình pháp nhân</p>
        <div className="flex flex-wrap gap-2">
          {LEGAL_TYPES.map((t) => (
            <Link key={t} href={`${base}?lp=${lpParam}&type=${t}#ho-so-phap-ly`} aria-current={t === legalType ? 'true' : undefined}
              className={`pill px-3 py-1.5 text-[13px] ${t === legalType ? 'bg-ink text-white' : 'bg-surface text-ink-2 ring-1 ring-line'}`}>{LEGAL_FORM_LABEL[t]}</Link>
          ))}
        </div>
      </div>
      <ActionForm action={saveLegalProfile} className="grid gap-4 text-[13px] sm:grid-cols-2">
        <input type="hidden" name="kocId" value={koc.id} />
        <input type="hidden" name="id" value={editing?.id ?? ''} />
        <input type="hidden" name="fromLegacy" value={profile && !profile.id ? '1' : ''} />
        <input type="hidden" name="legalType" value={legalType} />
        <input type="hidden" name="next" value={close} />
        <F label="Chế độ khấu trừ thuế" id="taxAccountType">
          <select id="taxAccountType" name="taxAccountType" defaultValue={TAX_ACCOUNT_OPTIONS[legalType].includes(v('taxAccountType')) ? v('taxAccountType') : DEFAULT_TAX_ACCOUNT[legalType]} className="input">
            {[...new Set([DEFAULT_TAX_ACCOUNT[legalType], ...TAX_ACCOUNT_OPTIONS[legalType]])].map((o) => <option key={o}>{o}</option>)}
          </select>
        </F>
        <F label="Vai trò ký kết" id="signRole">
          <select id="signRole" name="signRole" defaultValue={v('signRole') || DEFAULT_SIGN_ROLE[legalType]} className="input">
            {SIGN_ROLES.map((o) => <option key={o}>{o}</option>)}
          </select>
        </F>
        <F label={individual ? 'Họ và tên cá nhân đứng tên Hợp đồng *' : 'Tên pháp nhân Công ty / Hộ kinh doanh *'} id="holderName">
          <input id="holderName" name="holderName" required defaultValue={v('holderName')} className="input" />
        </F>
        <F label={individual ? 'Mã số thuế TNCN (nếu có)' : 'Mã số thuế / Mã số ĐKKD *'} id="taxCode">
          <input id="taxCode" name="taxCode" defaultValue={v('taxCode')} className="input" />
        </F>
        {individual ? (
          <>
            <F label="Số CCCD (đủ 12 chữ số) *" id="cccd"><input id="cccd" name="cccd" inputMode="numeric" maxLength={12} defaultValue={v('cccd')} className="input" /></F>
            <F label="Ngày cấp CCCD (DD/MM/YYYY) *" id="cccdIssueDate"><input id="cccdIssueDate" name="cccdIssueDate" placeholder="15/05/2022" defaultValue={v('cccdIssueDate')} className="input" /></F>
            <F label="Nơi cấp CCCD (phải là chữ) *" id="cccdIssuePlace" wide><input id="cccdIssuePlace" name="cccdIssuePlace" placeholder="Cục Cảnh sát QLHC về TTXH" defaultValue={v('cccdIssuePlace')} className="input" /></F>
          </>
        ) : (
          <>
            <F label="Số Giấy phép ĐKKD / Hộ kinh doanh" id="businessLicenseNo"><input id="businessLicenseNo" name="businessLicenseNo" defaultValue={v('businessLicenseNo')} className="input" /></F>
            <F label="Thuế suất VAT áp dụng (%)" id="vatRatePercent">
              <select id="vatRatePercent" name="vatRatePercent" defaultValue={String(vat)} className="input">
                {VAT_OPTIONS[legalType].map(([n, l]) => <option key={n} value={n}>{l}</option>)}
              </select>
            </F>
          </>
        )}
        <F label="Người đại diện ký hợp đồng" id="representativeName"><input id="representativeName" name="representativeName" defaultValue={v('representativeName')} className="input" /></F>
        <F label="Chức vụ đại diện" id="representativeTitle"><input id="representativeTitle" name="representativeTitle" defaultValue={v('representativeTitle') || (legalType === 'COMPANY' ? 'Giám đốc' : legalType === 'HOUSEHOLD' ? 'Chủ hộ kinh doanh' : '')} className="input" /></F>
        <F label="Số văn bản ủy quyền" id="authorizationNumber"><input id="authorizationNumber" name="authorizationNumber" defaultValue={v('authorizationNumber')} className="input" /></F>
        <F label="Ngày văn bản ủy quyền" id="authorizationDate"><input id="authorizationDate" name="authorizationDate" placeholder="DD/MM/YYYY" defaultValue={v('authorizationDate')} className="input" /></F>
        <F label="Số điện thoại liên hệ trên Hợp đồng" id="contactPhone"><input id="contactPhone" name="contactPhone" type="tel" defaultValue={v('contactPhone')} className="input" /></F>
        <F label="Email nhận thông báo & ký số" id="contactEmail"><input id="contactEmail" name="contactEmail" type="email" defaultValue={v('contactEmail')} className="input" /></F>
        <F label={individual ? 'Địa chỉ thường trú trên CCCD' : 'Địa chỉ trụ sở đăng ký kinh doanh'} id="address" wide><input id="address" name="address" defaultValue={v('address')} className="input" /></F>
        <F label="Tên ngân hàng" id="bankName">
          <input id="bankName" name="bankName" list="bank-list" defaultValue={v('bankName')} className="input" />
          <datalist id="bank-list">{banks.map((b) => <option key={b} value={b} />)}</datalist>
        </F>
        <F label="Số tài khoản ngân hàng" id="bankAccount"><input id="bankAccount" name="bankAccount" defaultValue={v('bankAccount')} className="input" /></F>
        <F label="Tên chủ tài khoản (IN HOA KHÔNG DẤU)" id="bankHolderName" wide>
          <input id="bankHolderName" name="bankHolderName" defaultValue={v('bankHolderName')} placeholder="Để trống: lấy theo tên đứng tên hợp đồng" className="input uppercase" />
        </F>
        <p className="col-span-full -mb-1 border-t border-line pt-3 text-xs font-semibold text-ink-2">Hợp đồng nguyên tắc (HĐNT) · Booking Hub chưa có phân hệ hợp đồng nên cập nhật tay</p>
        <F label="Trạng thái HĐNT" id="contractStatus">
          <select id="contractStatus" name="contractStatus" defaultValue={editing?.contractStatus ?? 'CHƯA_KÝ'} className="input">
            {Object.entries(CONTRACT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </F>
        <F label="Mã HĐNT" id="contractCode"><input id="contractCode" name="contractCode" placeholder="HDNT-2026-0028" defaultValue={editing?.contractCode ?? ''} className="input" /></F>
        <F label="Ngày ký" id="contractSignedAt">
          <input id="contractSignedAt" name="contractSignedAt" type="date" defaultValue={editing?.contractSignedAt ? editing.contractSignedAt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) : ''} className="input" />
        </F>
        <F label="Link file HĐNT đã ký" id="contractUrl"><input id="contractUrl" name="contractUrl" type="url" defaultValue={editing?.contractUrl ?? ''} className="input" /></F>
        <F label="Ghi chú vận hành / Ủy quyền thanh toán (nếu có)" id="notes" wide><textarea id="notes" name="notes" rows={2} defaultValue={v('notes')} className="input" /></F>
        <label className="col-span-full flex items-center gap-2">
          <input type="checkbox" name="isDefault" defaultChecked={profile ? profile.isDefault : nextNo === 1} className="size-4" />
          Đặt làm hồ sơ pháp lý mặc định (dùng cho ĐNTT, listing, job)
        </label>
        <div className="col-span-full flex justify-end gap-2">
          <Link href={close} className="btn">Hủy</Link>
          <button className="btn btn-primary">{profile ? 'Lưu thay đổi' : 'Thêm hồ sơ pháp lý'}</button>
        </div>
      </ActionForm>
    </Dialog>
  );
}

function F({ label, id, wide, children }: { label: string; id: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'col-span-full' : undefined}>
      <label className="label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
