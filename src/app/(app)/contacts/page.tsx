import Link from 'next/link';
import { pageOf, Pager } from '@/components/Pager';
import { ActionForm, Avatar, Dialog, Menu } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtVnd, fmtVndShort } from '@/lib/format';
import { gmvLabel } from '@/lib/kocInsights';
import {
  channelSummary, CONTACT_FILTERS, contactLabel, contractReadiness, directory, EXTRA_FLAGS, ISSUES, isCoop, KOC_CATEGORIES, LEGAL_FILTER_LABEL, legalOf,
  mask, picOf, PLATFORM_FILTERS, ratingSummary, READINESS, readinessOf, reviewSummary, salaryOf, UNCATEGORIZED, type DirFilters, type DirKoc,
} from '@/lib/kocDirectory';
import { dupKey } from '@/lib/listing';
import { listingScope, scopeOf } from '@/lib/scope';
import { can, requireUser } from '@/lib/session';
import { deleteKoc, refreshFromTikTok, saveKoc } from './actions';
import { BookDialog, ChannelsDialog, ContactDialog, ReviewDialog } from './dialogs';
import { boHandles, loadDirectory } from './directory';
import { KL_LEVELS, PLATFORMS } from './platforms';

// Danh bạ KOC / KOL theo bản chốt trên app b2c (KocMasterDataView): 2 bảng "KOC đã hợp tác" / "KOC mới / tiềm năng"
// (tab Khám phá b2c ẩn trên production), mỗi trang 20 dòng. Bộ lọc riêng của Booking Hub nằm trong "Thêm bộ lọc".
const PER_PAGE = 20;
const compact = new Intl.NumberFormat('vi-VN', { notation: 'compact', maximumFractionDigits: 1 });
const vnd = new Intl.NumberFormat('vi-VN');
const PARAMS = ['tab', 'q', 'pic', 'niche', 'category', 'kl', 'legal', 'platform', 'issue', 'readiness', 'contact', 'flag', 'tag', 'owner', 'sort'] as const;
type Search = Partial<Record<(typeof PARAMS)[number] | 'edit' | 'channels' | 'book' | 'contact_koc' | 'review' | 'verdict' | 'brand' | 'page', string>>;

const SORTS: Record<string, { label: string; cmp?: (a: DirKoc, b: DirKoc) => number }> = {
  '': { label: 'Mới cập nhật' },
  followers: { label: 'Follower nhiều nhất', cmp: (a, b) => (b.followers ?? -1) - (a.followers ?? -1) },
  units: { label: 'Bán nhiều món nhất (30 ngày)', cmp: (a, b) => (b.unitsSold ?? -1) - (a.unitsSold ?? -1) },
  views: { label: 'Lượt xem TB cao nhất', cmp: (a, b) => (b.avgViews ?? -1) - (a.avgViews ?? -1) },
  bookings: { label: 'Nhiều booking nhất', cmp: (a, b) => b.bookingCount - a.bookingCount },
  recent: { label: 'Book gần nhất', cmp: (a, b) => +(b.lastBookingAt ?? 0) - +(a.lastBookingAt ?? 0) },
};
const chip = (on: boolean) => `pill px-2.5 py-1 ${on ? 'bg-ink text-white' : 'bg-surface text-ink-2 ring-1 ring-line'}`;
const pick = <T extends string>(v: string | undefined, allowed: readonly T[] | Record<T, unknown>) =>
  (v && (Array.isArray(allowed) ? allowed.includes(v as T) : Object.hasOwn(allowed, v)) ? v : '') as T | '';

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser();
  const canEdit = can(me, 'koc.edit');
  const bank = can(me, 'koc.bank');
  const sp = await searchParams;
  const f: DirFilters & { sort: string } = {
    tab: sp.tab === 'new' ? 'new' : '',
    q: sp.q ?? '', pic: sp.pic ?? '', niche: sp.niche ?? '', category: sp.category ?? '', kl: sp.kl ?? '', tag: sp.tag ?? '', owner: sp.owner ?? '',
    legal: pick(sp.legal, LEGAL_FILTER_LABEL), platform: pick(sp.platform, PLATFORM_FILTERS), issue: pick(sp.issue, ISSUES),
    readiness: pick(sp.readiness, READINESS), contact: pick(sp.contact, CONTACT_FILTERS), flag: pick(sp.flag, EXTRA_FLAGS), sort: pick(sp.sort, SORTS),
  };
  const coopTab = f.tab !== 'new';
  const page = pageOf(sp.page);

  const [all, bo] = await Promise.all([loadDirectory(), boHandles(f.q ?? '')]);
  const d = directory(all, f, dupKey, bo);
  const sorted = SORTS[f.sort].cmp ? [...d.rows].sort(SORTS[f.sort].cmp) : d.rows;
  const rows = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const byId = new Map(all.map((k) => [k.id, k]));
  // Ô trống ở tab này nhưng tab kia có KOC khớp (vd. link "Hẹn liên hệ KOL" từ Tổng quan): gợi ý chuyển tab.
  const otherTab = !d.rows.length ? directory(all, { ...f, tab: coopTab ? 'new' : '', issue: '', legal: '', readiness: '', contact: '' }, dupKey, bo).rows.length : 0;

  const id = (k: string) => (sp[k as keyof Search] ? byId.get(sp[k as keyof Search]!) : undefined);
  const [editKoc, chKoc, bookKoc, contactKoc, reviewKoc] = [id('edit'), id('channels'), id('book'), id('contact_koc'), id('review')];
  const [users, editing, niches, tagRows, listingInfo, batches, notes, reviews, brands, statsRun] = await Promise.all([
    canEdit && sp.edit ? db.user.findMany({ where: { active: true }, orderBy: { name: 'asc' } }) : [],
    canEdit && editKoc ? db.koc.findUnique({ where: { id: editKoc.id } }) : null,
    db.koc.findMany({ where: { niche: { not: null } }, distinct: ['niche'], select: { niche: true }, orderBy: { niche: 'asc' } }),
    db.$queryRaw<{ tag: string }[]>`select distinct unnest(tags) tag from "Koc" order by 1`,
    // KOC mới: gian hàng đề xuất / số lần được đề xuất lấy từ các đợt listing có KOC này.
    !coopTab && rows.length
      ? db.listingItem.findMany({ where: { kocId: { in: rows.map((k) => k.id) } }, orderBy: { createdAt: 'desc' }, select: { kocId: true, batch: { select: { name: true, brand: true, store: true } } } })
      : [],
    bookKoc ? db.listingBatch.findMany({ where: { AND: [listingScope(await scopeOf(me)), { NOT: { id: { startsWith: 'lark-' } } }] }, orderBy: [{ month: 'desc' }, { createdAt: 'desc' }], take: 50, select: { id: true, name: true, month: true, brand: true } }) : [],
    contactKoc ? db.kocNote.findMany({ where: { kocId: contactKoc.id }, include: { author: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 30 }) : [],
    reviewKoc ? db.kocReview.findMany({ where: { kocId: reviewKoc.id }, include: { reviewer: { select: { name: true } } } }) : [],
    reviewKoc ? db.brand.findMany({ select: { name: true }, orderBy: { name: 'asc' } }) : [],
    db.syncState.findUnique({ where: { id: 'creators' } }),
  ]);
  const listed = new Map<string, { n: number; first: (typeof listingInfo)[number]['batch'] }>();
  for (const li of listingInfo) {
    const cur = listed.get(li.kocId);
    if (cur) cur.n++;
    else listed.set(li.kocId, { n: 1, first: li.batch });
  }
  const allTags = tagRows.map((r) => r.tag);
  const klOptions = [...new Set([...KL_LEVELS, ...d.options.kl])];

  const filters = new URLSearchParams(PARAMS.map((k) => [k, String(f[k] ?? '')] as [string, string]).filter(([, v]) => v));
  const ret = filters.size ? `?${filters}` : '';
  const listHref = `/contacts${ret}`;
  const withParam = (key: string, value: string) => {
    const p = new URLSearchParams(filters);
    if (value) p.set(key, value); else p.delete(key);
    p.delete('page');
    return p.size ? `/contacts?${p}` : '/contacts';
  };
  const dlg = (key: string, kocId: string, extra: Record<string, string> = {}) => `?${new URLSearchParams([...filters, ['page', String(page)], [key, kocId], ...Object.entries(extra)])}`;
  const back = `?${new URLSearchParams([...filters, ['page', String(page)]])}`;
  const moreCount = [f.kl, coopTab ? f.platform : '', coopTab ? f.legal : f.contact, f.flag, f.tag, f.sort].filter(Boolean).length;
  const isFiltered = Boolean(f.q || f.pic || f.niche || f.category || moreCount || f.issue || f.readiness || f.owner);
  const ownerKoc = f.owner ? byId.get(f.owner) : undefined;
  const dialogOpen = canEdit && (sp.edit === 'new' || editing);
  const editSaved = editKoc?.saved.length ?? 0;

  const menu = (k: DirKoc) => {
    const rs = reviewSummary(k.reviews);
    const v = rs?.latest.verdict;
    return (
      <Menu label={`Thao tác với ${k.name}`}>
        {canEdit && <Link href={dlg('edit', k.id)}>Chỉnh sửa thông tin KOC</Link>}
        {canEdit && <Link href={dlg('channels', k.id)}>Quản lý kênh & TikTok phụ</Link>}
        {k.platform === 'TikTok' && <Link href={dlg('book', k.id)}>Tạo booking (Đẩy vào Listing)</Link>}
        {!isCoop(k) && <Link href={dlg('contact_koc', k.id)}>Ghi lịch sử liên hệ / Chốt hợp tác</Link>}
        <Link href={dlg('review', k.id)}>{rs ? `Đánh giá KOC (${v === 'SUITABLE' ? 'Phù hợp' : v === 'NOT_SUITABLE' ? 'Không phù hợp' : 'Cần cân nhắc'})` : 'Đánh giá KOC theo Brand'}</Link>
        <Link href={dlg('review', k.id, { verdict: 'SUITABLE' })}>Đánh giá Phù hợp (theo Brand)</Link>
        <Link href={dlg('review', k.id, { verdict: 'NOT_SUITABLE' })}>Đánh giá Không phù hợp (theo Brand)</Link>
        {rs && <Link href={`${dlg('review', k.id)}#lich-su`}>Lịch sử đánh giá kênh ({rs.total})</Link>}
        <Link href={`/contacts/${k.id}`}>Đánh giá lịch sử & rủi ro</Link>
        <form action={refreshFromTikTok}>
          <input type="hidden" name="id" value={k.id} />
          <button className="item">Cập nhật chỉ số</button>
        </form>
      </Menu>
    );
  };
  const kocCode = <span className="inline-block rounded bg-sunken px-1.5 py-0.5 text-[11px] font-medium text-ink-3" title="Lưu nội bộ B2C, chưa đồng bộ lên KOC Hub">Lưu nội bộ</span>;
  const realName = (k: DirKoc) => { const p = legalOf(k)[0]; return p?.legalType === 'INDIVIDUAL' && p.holderName && p.holderName !== k.name ? p.holderName : null; };
  const kocCell = (k: DirKoc, sub?: React.ReactNode) => (
    <div className="flex min-w-0 max-w-[260px] items-center gap-3">
      <Avatar src={k.avatarUrl} name={k.nickname ?? k.name} size={32} />
      <div className="min-w-0 leading-snug">
        <Link href={`/contacts/${k.id}`} className="block truncate font-medium hover:text-accent hover:underline">{k.nickname ?? k.name}</Link>
        <span className="block truncate text-xs text-ink-3" title={[realName(k), k.email, k.phone ? mask(k.phone.trim()) : ''].filter(Boolean).join(' · ') || undefined}>
          {channelSummary(k.handle, k.channels)}{realName(k) && ` · ${realName(k)}`}
        </span>
        {sub}
        {(k.blacklisted || k.tags.length > 0) && (
          <span className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
            {k.blacklisted && <span className="pill bg-critical-soft text-critical">Blacklist</span>}
            {k.tags.map((t) => <span key={t} className="pill bg-sunken text-ink-2">{t}</span>)}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold">Danh bạ KOC / KOL</h1>
          {statsRun?.finishedAt && <p className="text-xs text-ink-3">Chỉ số TikTok Shop cập nhật {statsRun.finishedAt.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' })}</p>}
        </div>
        <div className="flex gap-2">
          {can(me, 'data.export') && <a href={`/contacts/export${ret}`} className="btn">Tải Excel</a>}
          {canEdit && <Link href={`?${new URLSearchParams([...filters, ['edit', 'new']])}`} className="btn btn-primary">+ Thêm KOC</Link>}
        </div>
      </div>

      <nav aria-label="Bảng dữ liệu KOC" className="mb-4 flex gap-6 border-b border-line text-[13px]">
        {([['', 'KOC đã hợp tác', d.counts.coop], ['new', 'KOC mới / tiềm năng', d.counts.new]] as const).map(([k, label, n]) => (
          <Link key={k} href={k ? '/contacts?tab=new' : '/contacts'} aria-current={(f.tab ?? '') === k ? 'page' : undefined}
            className={`-mb-px border-b-2 pb-2.5 ${(f.tab ?? '') === k ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
            {label} <span className="ml-1 text-xs font-normal text-ink-3">{vnd.format(n)}</span>
          </Link>
        ))}
      </nav>

      <section className="rounded-lg border border-line bg-surface">
        <div className="grid gap-3 border-b border-line px-4 pt-4 pb-3">
          <h2 className="text-[15px] font-semibold">{coopTab ? 'KOC đã hợp tác' : 'KOC mới / tiềm năng'}</h2>
          <form className="flex flex-wrap items-start gap-2">
            {f.tab && <input type="hidden" name="tab" value={f.tab} />}
            {f.issue && <input type="hidden" name="issue" value={f.issue} />}
            {f.readiness && <input type="hidden" name="readiness" value={f.readiness} />}
            {f.owner && <input type="hidden" name="owner" value={f.owner} />}
            <input name="q" defaultValue={f.q} aria-label="Tìm kiếm" className="input max-w-sm"
              placeholder={coopTab ? 'Tên kênh, @handle, chủ TK, CCCD, MST, mã BO' : 'Tên kênh, @handle, gian hàng, SĐT, Email'} />
            <select name="pic" defaultValue={f.pic} aria-label="PIC phụ trách" className="input w-auto">
              <option value="">Mọi PIC</option>
              {d.options.pic.map((v) => <option key={v}>{v}</option>)}
            </select>
            <select name="niche" defaultValue={f.niche} aria-label="Tệp kênh" className="input w-auto">
              <option value="">Mọi tệp kênh</option>
              {d.options.niche.map((v) => <option key={v}>{v}</option>)}
            </select>
            <select name="category" defaultValue={f.category} aria-label="Ngành hàng" className="input w-auto">
              <option value="">Mọi ngành hàng</option>
              {d.options.category.map((v) => <option key={v}>{v}</option>)}
            </select>
            <details open={moreCount > 0} className="contents [&[open]>div]:basis-full">
              <summary className="btn cursor-pointer list-none">Thêm bộ lọc{moreCount > 0 && ` (${moreCount})`}</summary>
              <div className="flex flex-wrap gap-2">
                {coopTab ? (
                  <select name="legal" defaultValue={f.legal} aria-label="Loại hồ sơ pháp lý" className="input w-auto">
                    <option value="">Mọi loại hồ sơ</option>
                    {d.legalOptions.map((o) => <option key={o.key} value={o.key}>{o.label} ({vnd.format(o.count)})</option>)}
                  </select>
                ) : (
                  <select name="contact" defaultValue={f.contact} aria-label="Tiếp cận" className="input w-auto">
                    <option value="">Mọi trạng thái tiếp cận</option>
                    {d.contactOptions.map((o) => <option key={o.key} value={o.key}>{o.label} ({vnd.format(o.count)})</option>)}
                  </select>
                )}
                <select name="kl" defaultValue={f.kl} aria-label="Khung lương" className="input w-auto">
                  <option value="">Mọi khung lương</option>
                  {klOptions.map((v) => <option key={v}>{v}</option>)}
                </select>
                {coopTab && (
                  <select name="platform" defaultValue={f.platform} aria-label="Nền tảng" className="input w-auto">
                    <option value="">Mọi nền tảng</option>
                    {PLATFORM_FILTERS.map((p) => <option key={p} value={p}>Có {p}</option>)}
                  </select>
                )}
                <select name="flag" defaultValue={f.flag} aria-label="Lọc thêm" className="input w-auto">
                  <option value="">Lọc thêm: tất cả</option>
                  {Object.entries(EXTRA_FLAGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                {allTags.length > 0 && (
                  <select name="tag" defaultValue={f.tag} aria-label="Tag" className="input w-auto">
                    <option value="">Mọi tag</option>
                    {allTags.map((t) => <option key={t}>{t}</option>)}
                  </select>
                )}
                <select name="sort" defaultValue={f.sort} aria-label="Sắp xếp" className="input w-auto">
                  {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            </details>
            <button className="btn">Lọc</button>
            {isFiltered && <Link href={coopTab ? '/contacts' : '/contacts?tab=new'} className="btn border-transparent text-ink-3">Xóa lọc</Link>}
          </form>

          <div className="flex flex-wrap gap-1.5 text-xs">
            {coopTab ? (
              <>
                <Link href={withParam('issue', '')} className={chip(!f.issue)}>Tất cả <b className="font-medium">{vnd.format(d.issueAll)}</b></Link>
                {d.issueChips.map((c) => (
                  <Link key={c.key} href={withParam('issue', f.issue === c.key ? '' : c.key)} className={chip(f.issue === c.key)}>{c.label} <b className="font-medium">{vnd.format(c.count)}</b></Link>
                ))}
              </>
            ) : d.readinessChips.map((c) => (
              <Link key={c.key} href={withParam('readiness', c.key)} className={chip((f.readiness ?? '') === c.key)}>{c.label} <b className="font-medium">{vnd.format(c.count)}</b></Link>
            ))}
          </div>
          {f.owner && (
            <p className="flex flex-wrap items-center gap-2 rounded-md bg-accent-soft px-3 py-2 text-[13px] text-accent">
              Các kênh chung chủ / MCN với <b>{ownerKoc ? `${ownerKoc.name} (@${ownerKoc.handle})` : 'KOC đã chọn'}</b> (trùng SĐT, email, CCCD / MST).
              <Link href={withParam('owner', '')} className="link">Bỏ lọc</Link>
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="tbl">
            {coopTab ? (
              <>
                <thead><tr><th>Mã KOC</th><th>KOC</th><th>Hợp tác</th><th className="text-right">Đơn giá</th><th>Hồ sơ pháp lý</th><th>Đánh giá</th><th>Phân loại & Tệp kênh</th><th /></tr></thead>
                <tbody>
                  {rows.map((k) => {
                    const lk = k.lark;
                    const pic = picOf(k);
                    const rate = k.rateCard ?? lk?.lastVideo ?? lk?.lastCost ?? null;
                    const onlyFoc = !(rate && rate > 1) && (lk?.foc ?? 0) > 0 && !lk?.paid;
                    const profiles = legalOf(k);
                    const def = profiles[0];
                    const ready = def ? contractReadiness(def, k) : null;
                    const twins = [...(d.dups.get(k.id)?.entries() ?? [])];
                    const dupNames = twins.filter(([, fl]) => fl.includes('kênh')).map(([o]) => byId.get(o)?.name ?? '');
                    const shared = twins.filter(([, fl]) => fl.some((x) => x !== 'kênh')).length;
                    const legal = !profiles.length ? { label: 'Chưa có hồ sơ', tone: 'bg-warning-soft text-warning' }
                      : dupNames.length ? { label: 'Trùng kênh', tone: 'bg-warning-soft text-warning' }
                      : def.contractStatus === 'ĐÃ_KÝ' ? { label: 'Đã ký HĐNT', tone: 'bg-positive-soft text-positive' }
                      : !ready?.ready ? { label: 'Chưa đủ hồ sơ', tone: 'bg-warning-soft text-warning' }
                      : { label: 'Đủ hồ sơ', tone: 'bg-positive-soft text-positive' };
                    const legalTip = [
                      dupNames.length ? `Trùng kênh: ${dupNames.join(', ')}` : '',
                      ready && !ready.ready && def.contractStatus !== 'ĐÃ_KÝ' ? `Thiếu trường ký HĐ: ${ready.missing.join(', ')}` : '',
                      profiles.map((p) => `${p.code}: ${p.holderName}`).join('\n'),
                      shared ? `Chung chủ / MCN với ${shared} kênh` : '',
                    ].filter(Boolean).join('\n');
                    const r = ratingSummary(k.ratings);
                    return (
                      <tr key={k.id}>
                        <td>{kocCode}</td>
                        <td>{kocCell(k)}</td>
                        <td className="text-xs">
                          <div className="max-w-[210px] leading-snug" title={[lk?.paid != null ? `${lk.paid} Paid` : '', lk?.foc ? `${lk.foc} FOC` : '', lk?.code ? `BO gần nhất ${lk.code}` : '', lk?.pics ? `PIC từng làm: ${lk.pics}` : ''].filter(Boolean).join('\n') || undefined}>
                            <span className="block truncate text-[13px] text-ink">
                              <span className="font-medium">{k.bookingCount ? `${vnd.format(k.bookingCount)} đợt` : k.jobs ? `${k.jobs} job` : '—'}</span>
                              {lk?.brand && <span className="text-ink-2"> · {lk.brand}{lk.brands > 1 && ` +${lk.brands - 1}`}</span>}
                            </span>
                            <span className="block truncate text-ink-3">{pic ?? 'Chưa gán PIC'}{lk?.month && ` · ${lk.month}`}</span>
                          </div>
                        </td>
                        <td className="text-right text-xs whitespace-nowrap" title={[lk?.minCost && lk.maxCost && lk.maxCost > lk.minCost ? `Biên độ giá: ${fmtVndShort(lk.minCost)} – ${fmtVndShort(lk.maxCost)}` : '', k.gmvRange ? 'GMV kênh: doanh thu cả kênh trên TikTok Shop, không riêng booking Upbase' : ''].filter(Boolean).join('\n') || undefined}>
                          <span className="block text-[13px] text-ink">{rate && rate > 1 ? fmtVndShort(rate) : onlyFoc ? 'Chỉ FOC' : '—'}</span>
                          <span className="block text-ink-3">{k.gmvRange ? `GMV kênh ${gmvLabel(k.gmvRange)}` : '—'}</span>
                        </td>
                        <td className="text-xs">
                          <div className="grid max-w-[180px] justify-items-start gap-0.5" title={legalTip || undefined}>
                            <span className={`pill ${legal.tone}`}>{legal.label}</span>
                            {def && <span className="block w-full truncate text-ink-3">{def.holderName || '—'}{profiles.length > 1 && ` · +${profiles.length - 1} hồ sơ`}</span>}
                          </div>
                        </td>
                        <td className="text-xs">
                          {r.count ? (
                            <div title={r.negativeTags.length ? `Hay gặp: ${r.negativeTags.join(', ')}` : undefined}>
                              <span className={`text-[13px] font-medium ${r.isLow ? 'text-critical' : 'text-ink'}`}>{r.average.toLocaleString('vi-VN')} sao</span>
                              <span className="block text-ink-3">{r.isLow && 'Điểm thấp · '}{r.count} lượt</span>
                            </div>
                          ) : <span className="text-ink-3">—</span>}
                        </td>
                        <td className="text-xs">
                          <div className="max-w-[175px] leading-snug">
                            <span className="block truncate text-[13px] font-medium text-ink">{k.niche ?? 'Chưa phân tệp kênh'}</span>
                            <span className="block truncate text-ink-3">{[k.category, salaryOf(k)].filter(Boolean).join(' · ') || '—'}</span>
                          </div>
                        </td>
                        <td className="text-right">{menu(k)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            ) : (
              <>
                <thead><tr><th>Mã KOC</th><th>KOC & nguồn</th><th className="text-right">Chỉ số kênh</th><th>Tệp kênh & báo giá</th><th>Gian hàng & PIC</th><th>Sẵn sàng & liên hệ</th><th /></tr></thead>
                <tbody>
                  {rows.map((k) => {
                    const li = listed.get(k.id);
                    const rd = READINESS[readinessOf(k)];
                    const contacted = k.contactStatus === 'ĐÃ_LIÊN_HỆ' || k.contactStatus === 'ĐANG_THƯƠNG_LƯỢNG';
                    return (
                      <tr key={k.id}>
                        <td>{kocCode}</td>
                        <td>{kocCell(k, <span className="block truncate text-xs text-accent">{li ? `Listing ${li.first.name}` : 'Danh bạ'}{li && li.n > 1 && ` · Đề xuất ${li.n} lần`}</span>)}</td>
                        <td className="text-right text-xs whitespace-nowrap">
                          <div className="font-semibold text-ink">{k.followers == null ? '—' : compact.format(k.followers)} flw · {k.avgViews == null ? '—' : compact.format(k.avgViews)} view TB</div>
                          <div className="text-ink-3">GMV 30 ngày {k.gmvRange ? gmvLabel(k.gmvRange) : '—'}</div>
                        </td>
                        <td className="text-xs">
                          <div className="max-w-[175px] leading-snug">
                            <span className="block truncate font-medium text-ink">{k.niche ?? 'Chưa phân tệp kênh'}</span>
                            <span className="block truncate text-ink-2">{[k.category, salaryOf(k) ? `Khung ${salaryOf(k)}` : ''].filter(Boolean).join(' · ') || '—'}</span>
                            <span className="block truncate font-semibold text-ink">{k.rateCard ? `Báo giá: ${fmtVnd(k.rateCard)}` : 'Chưa có báo giá'}</span>
                          </div>
                        </td>
                        <td className="text-xs">
                          <div className="max-w-[170px] leading-snug">
                            <span className="block truncate font-medium text-ink">{li?.first.store ?? li?.first.brand ?? 'Chưa gán gian hàng'}</span>
                            <span className="block truncate text-ink-3">PIC đề xuất: <b className="text-ink-2">{picOf(k) ?? 'Chưa phân công'}</b></span>
                          </div>
                        </td>
                        <td className="text-xs">
                          <div className="grid max-w-[190px] justify-items-start gap-1">
                            <div className="flex flex-wrap gap-1">
                              <span className={`pill ${rd.tone}`}>{rd.label}</span>
                              <span className={`pill ${contacted ? 'bg-positive-soft text-positive' : 'bg-sunken text-ink-3'}`}>{contactLabel(k.contactStatus)}</span>
                            </div>
                            <span className="w-full truncate text-ink-2">{k.phone || k.email ? [k.phone ? mask(k.phone.trim()) : '', k.email].filter(Boolean).join(' · ') : 'Chưa có SĐT / Email'}</span>
                          </div>
                        </td>
                        <td className="text-right whitespace-nowrap">
                          <Link href={dlg('contact_koc', k.id)} className="btn mr-1.5 h-8 text-xs">Liên hệ</Link>
                          {menu(k)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </>
            )}
          </table>
          {!rows.length && (
            <div className="grid justify-items-center gap-3 py-12 text-center text-[13px] text-ink-3">
              <p>{(coopTab ? d.counts.coop : d.counts.new) ? 'Không có KOC khớp bộ lọc' : 'Chưa có KOC nào trong bảng này'}</p>
              {otherTab > 0 && <Link href={coopTab ? `/contacts?${new URLSearchParams([...filters, ['tab', 'new']])}` : withParam('tab', '')} className="link">{vnd.format(otherTab)} KOC khớp ở bảng {coopTab ? 'KOC mới / tiềm năng' : 'KOC đã hợp tác'}</Link>}
              {(coopTab ? d.counts.coop : d.counts.new) ? <Link href={coopTab ? '/contacts' : '/contacts?tab=new'} className="btn">Xóa bộ lọc</Link>
                : canEdit && <Link href={`?${new URLSearchParams([...filters, ['edit', 'new']])}`} className="btn btn-primary">+ Thêm KOC</Link>}
            </div>
          )}
        </div>
        <div className="border-t border-line px-4 pb-3">
          <Pager params={filters} page={page} perPage={PER_PAGE} total={d.rows.length} />
        </div>
      </section>

      {chKoc && canEdit && <ChannelsDialog koc={chKoc} channels={chKoc.channels} close={`/contacts${back}`} next={back} />}
      {bookKoc && <BookDialog koc={bookKoc} ratings={bookKoc.ratings} batches={batches} close={`/contacts${back}`} />}
      {contactKoc && <ContactDialog koc={{ ...contactKoc, rateCard: contactKoc.rateCard }} notes={notes} coop={isCoop(contactKoc)} close={`/contacts${back}`} next={back} />}
      {reviewKoc && (
        <ReviewDialog koc={reviewKoc} reviews={reviews} brands={brands.map((b) => b.name)} verdict={sp.verdict && ['SUITABLE', 'CAUTION', 'NOT_SUITABLE'].includes(sp.verdict) ? sp.verdict : 'NOT_SUITABLE'}
          brand={sp.brand ?? brands[0]?.name ?? ''} meId={me.id} canManage={canEdit} close={`/contacts${back}`} next={dlg('review', reviewKoc.id)} />
      )}

      {dialogOpen && (
        <Dialog title={editing ? 'Sửa KOC' : 'Thêm KOC'} closeHref={`/contacts${ret}`}>
          <ActionForm action={saveKoc} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="id" value={editing?.id ?? ''} />
            <input type="hidden" name="ret" value={ret} />
            <Field label="Nền tảng" id="platform">
              <select id="platform" name="platform" defaultValue={editing?.platform ?? 'TikTok'} className="input">
                {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="ID kênh" id="handle">
              <input id="handle" name="handle" required defaultValue={editing?.handle} placeholder="@username" className="input" />
            </Field>
            <Field label="Tên kênh" id="name">
              <input id="name" name="name" required defaultValue={editing?.name} className="input" />
            </Field>
            <Field label="Link kênh" id="channelUrl">
              <input id="channelUrl" name="channelUrl" type="url" defaultValue={editing?.channelUrl ?? ''} className="input" />
            </Field>
            <Field label="Follower" id="followers">
              <input id="followers" name="followers" type="number" min={0} defaultValue={editing?.followers ?? ''} className="input" />
            </Field>
            <Field label="Tệp kênh" id="niche">
              <input id="niche" name="niche" list="niche-list" defaultValue={editing?.niche ?? ''} className="input" />
              <datalist id="niche-list">{niches.map(({ niche: n }) => <option key={n} value={n!} />)}</datalist>
            </Field>
            <Field label="SĐT" id="phone">
              <input id="phone" name="phone" type="tel" defaultValue={editing?.phone ?? ''} className="input" />
            </Field>
            <Field label="Zalo" id="zalo">
              <input id="zalo" name="zalo" defaultValue={editing?.zalo ?? ''} className="input" />
            </Field>
            <Field label="Email" id="email">
              <input id="email" name="email" type="email" defaultValue={editing?.email ?? ''} className="input" />
            </Field>
            <Field label="Giá tham khảo / video (VND)" id="rateCard">
              <input id="rateCard" name="rateCard" type="number" min={0} step={1000} defaultValue={editing?.rateCard ?? ''} className="input" />
            </Field>
            <Field label="PIC" id="picId">
              <select id="picId" name="picId" defaultValue={editing?.picId ?? ''} className="input">
                <option value="">—</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name ?? u.larkUserId}</option>)}
              </select>
            </Field>
            <Field label="Ngành hàng (Category)" id="category">
              <select id="category" name="category" defaultValue={editing?.category ?? ''} className="input">
                <option value="">{UNCATEGORIZED}</option>
                {KOC_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="Khung lương (KL)" id="kl">
              <select id="kl" name="kl" defaultValue={editing?.kl ?? ''} className="input">
                <option value="">Theo booking gần nhất</option>
                {KL_LEVELS.map((l) => <option key={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Ghi chú" id="note" wide>
              <textarea id="note" name="note" rows={3} defaultValue={editing?.note ?? ''} className="input" />
            </Field>
            <Field label="Tag (cách nhau dấu phẩy)" id="tags" wide>
              <input id="tags" name="tags" list="tag-list" defaultValue={editing?.tags.join(', ') ?? ''} placeholder="VD: Giao hàng chậm, Hợp mẹ bé" className="input" />
              <datalist id="tag-list">{allTags.map((t) => <option key={t} value={t} />)}</datalist>
            </Field>
            <label className="col-span-full flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="blacklisted" defaultChecked={editing?.blacklisted} className="size-4" />
              Blacklist: không book nữa (ẩn khỏi Creator matching, cảnh báo ở Listing)
            </label>
            <Field label="Lý do blacklist (bắt buộc nếu tick)" id="blacklistReason" wide>
              <input id="blacklistReason" name="blacklistReason" defaultValue={editing?.blacklistReason ?? ''} className="input" />
            </Field>
            <p className="col-span-full -mb-1 border-t border-line pt-3 text-xs font-semibold text-ink-2">Nhận hàng mẫu</p>
            <Field label="Người nhận" id="receiverName">
              <input id="receiverName" name="receiverName" defaultValue={editing?.receiverName ?? ''} className="input" />
            </Field>
            <Field label="SĐT nhận hàng" id="receiverPhone">
              <input id="receiverPhone" name="receiverPhone" type="tel" defaultValue={editing?.receiverPhone ?? ''} className="input" />
            </Field>
            <Field label="Địa chỉ nhận hàng" id="address" wide>
              <input id="address" name="address" defaultValue={editing?.address ?? ''} className="input" />
            </Field>
            {bank && !editSaved ? (
              <>
                <input type="hidden" name="bankSection" value="1" />
                <p className="col-span-full -mb-1 border-t border-line pt-3 text-xs font-semibold text-ink-2">Hồ sơ pháp lý & thanh toán (HSPL-01)</p>
                <Field label="Chủ tài khoản" id="bankHolder">
                  <input id="bankHolder" name="bankHolder" defaultValue={editing?.bankHolder ?? ''} className="input" />
                </Field>
                <Field label="Số tài khoản" id="bankAccount">
                  <input id="bankAccount" name="bankAccount" defaultValue={editing?.bankAccount ?? ''} className="input" />
                </Field>
                <Field label="Ngân hàng" id="bankName">
                  <input id="bankName" name="bankName" defaultValue={editing?.bankName ?? ''} className="input" />
                </Field>
                <Field label="CCCD / MST" id="idNumber">
                  <input id="idNumber" name="idNumber" defaultValue={editing?.idNumber ?? ''} className="input" />
                </Field>
              </>
            ) : editing && (
              <p className="col-span-full border-t border-line pt-3 text-xs text-ink-3">
                {editSaved ? <>KOC có {editSaved} hồ sơ pháp lý: sửa ở <Link href={`/contacts/${editing.id}#ho-so-phap-ly`} className="link">trang KOC → Hồ sơ pháp lý</Link>.</> : 'CCCD, số tài khoản chỉ người có quyền "Xem số tài khoản, CCCD" mới xem và sửa được.'}
              </p>
            )}
            <div className="col-span-full flex justify-end gap-2">
              <Link href={`/contacts${ret}`} className="btn">Hủy</Link>
              <button className="btn btn-primary">Lưu</button>
            </div>
          </ActionForm>
          {editing && (
            <form action={deleteKoc} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="id" value={editing.id} />
              <input type="hidden" name="ret" value={ret} />
              <button className="btn btn-danger">Xóa KOC này</button>
            </form>
          )}
        </Dialog>
      )}
    </>
  );
}

function Field({ label, id, wide, children }: { label: string; id: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? 'col-span-full' : undefined}>
      <label className="label" htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}
