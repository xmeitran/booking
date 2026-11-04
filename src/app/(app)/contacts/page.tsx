import Link from 'next/link';
import type { Prisma } from '@prisma/client';
import { pageOf, Pager } from '@/components/Pager';
import { ActionForm, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { fmtDate } from '@/lib/format';
import { requireUser } from '@/lib/session';
import { deleteKoc, saveKoc } from './actions';
import { FLAGS, kocBase, kocWhere } from './filters';
import { KL_LEVELS, PLATFORMS } from './platforms';

const PER_PAGE = 50;
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const vnd = new Intl.NumberFormat('vi-VN');

type Search = { q?: string; platform?: string; niche?: string; kl?: string; flag?: string; sort?: string; edit?: string; page?: string };

// Sắp xếp; KOL chưa có số liệu dồn xuống cuối.
const SORTS: Record<string, { label: string; orderBy: Prisma.KocOrderByWithRelationInput }> = {
  '': { label: 'Mới cập nhật', orderBy: { updatedAt: 'desc' } },
  followers: { label: 'Follower nhiều nhất', orderBy: { followers: { sort: 'desc', nulls: 'last' } } },
  units: { label: 'Bán nhiều món nhất (30 ngày)', orderBy: { unitsSold: { sort: 'desc', nulls: 'last' } } },
  views: { label: 'Lượt xem TB cao nhất', orderBy: { avgViews: { sort: 'desc', nulls: 'last' } } },
  bookings: { label: 'Nhiều booking nhất', orderBy: { bookingCount: 'desc' } },
  recent: { label: 'Book gần nhất', orderBy: { lastBookingAt: { sort: 'desc', nulls: 'last' } } },
};
const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

export default async function ContactsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser();
  const canEdit = me.role !== 'STAFF';
  const sp = await searchParams;
  const { q = '', platform = '', niche = '', kl = '', edit } = sp;
  const flag = sp.flag && FLAGS[sp.flag] ? sp.flag : '';
  const sort = sp.sort && SORTS[sp.sort] ? sp.sort : '';
  const page = pageOf(sp.page);

  const base = kocBase({ q, platform, niche, kl });
  const where = kocWhere({ q, platform, niche, kl, flag });

  const [kocs, total, niches, users, editing, statsRun, withStats, kls, allCount, flagCounts] = await Promise.all([
    db.koc.findMany({ where, include: { pic: true }, orderBy: SORTS[sort].orderBy, skip: (page - 1) * PER_PAGE, take: PER_PAGE }),
    db.koc.count({ where }),
    db.koc.findMany({ where: { niche: { not: null } }, distinct: ['niche'], select: { niche: true }, orderBy: { niche: 'asc' } }),
    canEdit ? db.user.findMany({ where: { active: true }, orderBy: { name: 'asc' } }) : [],
    canEdit && edit && edit !== 'new' ? db.koc.findUnique({ where: { id: edit } }) : null,
    db.syncState.findUnique({ where: { id: 'creators' } }),
    db.koc.count({ where: { statsAt: { not: null } } }),
    db.koc.findMany({ where: { klAuto: { not: null } }, distinct: ['klAuto'], select: { klAuto: true } }),
    db.koc.count({ where: { AND: base } }),
    Promise.all(Object.keys(FLAGS).map(async (k) => [k, await db.koc.count({ where: { AND: [...base, FLAGS[k].where()] } })] as const)),
  ]);
  const klOptions = [...new Set([...KL_LEVELS, ...kls.map((r) => r.klAuto!)])];

  const filters = new URLSearchParams(Object.entries({ q, platform, niche, kl, flag, sort }).filter(([, v]) => v));
  const withFlag = (f: string) => {
    const p = new URLSearchParams(filters);
    if (f) p.set('flag', f); else p.delete('flag');
    return p.size ? `/contacts?${p}` : '/contacts';
  };
  const ret = filters.size ? `?${filters}` : '';
  const withEdit = (id: string) => `?${new URLSearchParams([...filters, ['edit', id]])}`;
  const dialogOpen = canEdit && (edit === 'new' || editing);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold">Danh bạ KOC</h1>
          <p className="text-xs text-ink-3">
            Chỉ số TikTok Shop: {vnd.format(withStats)} KOL có số liệu{statsRun?.finishedAt && <> · lượt gần nhất {fmtTime(statsRun.finishedAt)} · {statsRun.message}</>}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`/contacts/export${filters.size ? `?${filters}` : ''}`} className="btn">Tải Excel</a>
          {canEdit && <Link href={withEdit('new')} className="btn btn-primary">Thêm KOC</Link>}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href={withFlag('')} className={`pill px-2.5 py-1 ${!flag ? 'bg-ink text-white' : 'bg-surface text-ink-2 ring-1 ring-line'}`}>Tất cả · {vnd.format(allCount)}</Link>
        {flagCounts.map(([k, n]) => (
          <Link key={k} href={withFlag(flag === k ? '' : k)} className={`pill px-2.5 py-1 ${flag === k ? 'bg-ink text-white' : k === 'followUp' && n ? 'bg-critical-soft text-critical' : 'bg-surface text-ink-2 ring-1 ring-line'}`}>
            {FLAGS[k].label} · {vnd.format(n)}
          </Link>
        ))}
      </div>

      <form className="mb-3 flex flex-wrap gap-2">
        {flag && <input type="hidden" name="flag" value={flag} />}
        <input name="q" defaultValue={q} placeholder="Tìm tên, ID kênh, SĐT, Zalo, email" aria-label="Tìm kiếm" className="input max-w-xs" />
        <select name="platform" defaultValue={platform} aria-label="Nền tảng" className="input w-auto">
          <option value="">Mọi nền tảng</option>
          {PLATFORMS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select name="niche" defaultValue={niche} aria-label="Tệp kênh" className="input w-auto">
          <option value="">Mọi tệp kênh</option>
          {niches.map(({ niche: n }) => <option key={n}>{n}</option>)}
        </select>
        <select name="kl" defaultValue={kl} aria-label="Cấp KOL" className="input w-auto">
          <option value="">Mọi cấp KOL</option>
          {klOptions.map((l) => <option key={l}>{l}</option>)}
        </select>
        <select name="sort" defaultValue={sort} aria-label="Sắp xếp" className="input w-auto">
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button className="btn">Lọc</button>
        {ret && <Link href="/contacts" className="btn border-transparent text-ink-3">Xóa lọc</Link>}
      </form>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr><th>Kênh</th><th className="text-right">Follower</th><th>Hiệu quả 30 ngày</th><th>Liên hệ</th><th className="text-right">Giá tham khảo</th><th>PIC</th>{canEdit && <th />}</tr>
          </thead>
          <tbody>
            {kocs.map((k) => (
              <tr key={k.id}>
                <td>
                  <Link href={`/contacts/${k.id}`} className="font-medium hover:text-accent hover:underline">{k.nickname ?? k.name}</Link>
                  <div className="text-xs text-ink-3">
                    {k.platform} · {k.channelUrl ? <a href={k.channelUrl} target="_blank" rel="noreferrer" className="link">@{k.handle}</a> : `@${k.handle}`}
                    {k.niche && ` · ${k.niche}`}
                  </div>
                  {(k.kl ?? k.klAuto ?? k.bookingCount > 0) && (
                    <div className="mt-0.5 flex gap-1.5 text-xs text-ink-3">
                      {(k.kl ?? k.klAuto) && <span className="pill bg-accent-soft text-accent">{k.kl ?? k.klAuto}</span>}
                      {k.bookingCount > 0 && <span>{k.bookingCount} booking{k.lastBookingAt && ` · gần nhất ${fmtDate(k.lastBookingAt)}`}</span>}
                    </div>
                  )}
                  {k.note && <div className="mt-0.5 max-w-xs truncate text-xs text-ink-3" title={k.note}>{k.note}</div>}
                </td>
                <td className="text-right">{k.followers == null ? '—' : compact.format(k.followers)}</td>
                <td className="text-xs whitespace-nowrap">
                  {k.statsAt ? (
                    <div title={`TikTok Shop, cập nhật ${fmtTime(k.statsAt)}`}>
                      <div>{k.avgViews == null ? '—' : vnd.format(k.avgViews)} view TB/video{k.avgLiveViews ? ` · ${compact.format(k.avgLiveViews)} view/live` : ''}</div>
                      <div>{k.unitsSold == null ? '—' : vnd.format(k.unitsSold)} món{k.gmvRange && ` · GMV ${k.gmvRange}`}</div>
                    </div>
                  ) : <span className="text-ink-3">{k.ttsCheckedAt ? 'Không có trên Marketplace' : 'Chưa tra'}</span>}
                </td>
                <td className="text-xs">
                  {[k.phone, k.zalo && `Zalo ${k.zalo}`, k.email].filter(Boolean).map((c) => <div key={c as string}>{c}</div>)}
                  {!k.phone && !k.zalo && !k.email && '—'}
                </td>
                <td className="text-right">{k.rateCard == null ? '—' : vnd.format(k.rateCard)}</td>
                <td>{k.pic?.name ?? '—'}</td>
                {canEdit && <td className="text-right"><Link href={withEdit(k.id)} className="link">Sửa</Link></td>}
              </tr>
            ))}
            {!kocs.length && (
              <tr><td colSpan={7} className="py-12 text-center text-ink-3">{ret ? 'Không có KOC khớp bộ lọc.' : 'Danh bạ trống.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager params={filters} page={page} perPage={PER_PAGE} total={total} />

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
            <Field label="Cấp KOL" id="kl">
              <select id="kl" name="kl" defaultValue={editing?.kl ?? ''} className="input">
                <option value="">Theo booking gần nhất</option>
                {KL_LEVELS.map((l) => <option key={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Ghi chú" id="note" wide>
              <textarea id="note" name="note" rows={3} defaultValue={editing?.note ?? ''} className="input" />
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
            <p className="col-span-full -mb-1 border-t border-line pt-3 text-xs font-semibold text-ink-2">Thanh toán (chỉ Admin, Leader xem)</p>
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
