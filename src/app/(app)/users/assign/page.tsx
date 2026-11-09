import Link from 'next/link';
import { ActionForm, Avatar, Dialog } from '@/components/ui';
import { handoverWhere } from '@/lib/access';
import { BRAND_ROLES } from '@/lib/catalog';
import { db } from '@/lib/db';
import { requirePerm, ROLE_LABEL } from '@/lib/session';
import { assignBrand, handover, unassignBrand } from '../actions';
import { UsersTabs } from '../Tabs';

const SHORT: Record<string, string> = { 'Booking PIC': 'PIC', 'Booking Support': 'Support', 'Brand Manager': 'BM' };

// Phân công & bàn giao gian hàng (như màn cùng tên của app b2c): ai phụ trách brand nào, việc đang giữ, bàn giao khi đổi người / nghỉ việc.
export default async function AssignPage({ searchParams }: { searchParams: Promise<{ assign?: string; from?: string; done?: string }> }) {
  const me = await requirePerm('catalog.edit');
  const sp = await searchParams;
  const w = handoverWhere();
  const [users, jobs, lines, kocs] = await Promise.all([
    db.user.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { brandMembers: { include: { brand: { select: { id: true, name: true } } }, orderBy: { brand: { name: 'asc' } } } },
    }),
    db.job.groupBy({ by: ['picId'], where: w.jobs, _count: true }),
    db.planLine.groupBy({ by: ['picId'], where: w.lines, _count: true }),
    db.koc.groupBy({ by: ['picId'], where: w.kocs, _count: true }),
  ]);
  const n = (rows: { picId: string | null; _count: number }[]) => new Map(rows.map((r) => [r.picId, r._count]));
  const [jobN, lineN, kocN] = [n(jobs), n(lines), n(kocs)];
  const work = (id: string) => (jobN.get(id) ?? 0) + (lineN.get(id) ?? 0) + (kocN.get(id) ?? 0);
  // User đã khoá chỉ hiện khi còn giữ brand / việc (cần bàn giao).
  const shown = users.filter((u) => u.active || u.brandMembers.length || work(u.id));
  const assignTo = shown.find((u) => u.id === sp.assign && u.active);
  const from = shown.find((u) => u.id === sp.from);
  const brands = assignTo ? await db.brand.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }) : [];
  const staffNoBrand = shown.filter((u) => u.active && u.role === 'STAFF' && !u.brandMembers.length).length;

  return (
    <>
      <UsersTabs me={me} active="/users/assign" />
      <p className="mb-3 text-[13px] text-ink-2">
        Brand phụ trách quyết định Nhân viên thấy dữ liệu nào (khi vai trò không có quyền &quot;Xem dữ liệu mọi brand&quot;). Lượt đồng bộ Lark Base tự thêm phân công
        theo cột &quot;Người phụ trách&quot; của 5.1 Stores, không xoá phân công sửa ở đây.
      </p>
      {sp.done && <p role="status" className="mb-3 rounded-md bg-positive-soft px-3 py-2 text-positive">{sp.done}</p>}
      {staffNoBrand > 0 && <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-[13px] text-warning">{staffNoBrand} nhân viên chưa được giao brand nào: họ chỉ thấy việc mình là PIC / người tạo.</p>}

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr><th>Người dùng</th><th>Brand phụ trách</th><th className="text-right">Job đang chạy</th><th className="text-right">Dòng plan từ tháng này</th><th className="text-right">KOC phụ trách</th><th /></tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} id={`u-${u.id}`} className={u.active ? undefined : 'opacity-60'}>
                <td>
                  <div className="flex items-center gap-3">
                    <Avatar src={u.avatarUrl} name={u.name} size={32} />
                    <div className="min-w-0">
                      <div className="font-medium">{u.name ?? u.larkUserId}</div>
                      <div className="text-xs text-ink-3">{[ROLE_LABEL[u.role], u.jobTitle, !u.active && 'Đã khoá'].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                </td>
                <td className="max-w-md">
                  <div className="flex flex-wrap gap-1">
                    {u.brandMembers.map((m) => (
                      <form key={`${m.brandId}|${m.role}`} action={unassignBrand} className="pill inline-flex items-center gap-1 bg-sunken text-ink-2">
                        <input type="hidden" name="brandId" value={m.brandId} />
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="role" value={m.role} />
                        <Link href={`/catalog/${m.brandId}`} className="hover:underline">{m.brand.name}</Link>
                        <span className="text-ink-3">{SHORT[m.role] ?? m.role}</span>
                        <button className="text-ink-3 hover:text-critical" aria-label={`Bỏ ${m.brand.name} khỏi ${u.name ?? ''}`}>×</button>
                      </form>
                    ))}
                    {!u.brandMembers.length && <span className="text-xs text-ink-3">Chưa giao brand</span>}
                  </div>
                </td>
                <td className="text-right">{jobN.get(u.id) ?? 0}</td>
                <td className="text-right">{lineN.get(u.id) ?? 0}</td>
                <td className="text-right">{kocN.get(u.id) ?? 0}</td>
                <td className="whitespace-nowrap text-right">
                  {u.active && <Link href={`?assign=${u.id}`} className="link">Giao brand</Link>}
                  {(u.brandMembers.length > 0 || work(u.id) > 0) && <Link href={`?from=${u.id}`} className="link ml-3">Bàn giao</Link>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {assignTo && (
        <Dialog title={`Giao brand cho ${assignTo.name ?? assignTo.larkUserId}`} closeHref="/users/assign">
          <ActionForm action={assignBrand} className="grid gap-4">
            <input type="hidden" name="userId" value={assignTo.id} />
            <div>
              <label className="label" htmlFor="brandId">Brand</label>
              <select id="brandId" name="brandId" required className="input">
                <option value="">— Chọn brand —</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="role">Vai trò với brand</label>
              <select id="role" name="role" defaultValue="Booking PIC" className="input">
                {BRAND_ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Link href="/users/assign" className="btn">Hủy</Link>
              <button className="btn btn-primary">Giao</button>
            </div>
          </ActionForm>
        </Dialog>
      )}

      {from && (
        <Dialog title={`Bàn giao việc của ${from.name ?? from.larkUserId}`} closeHref="/users/assign">
          <ActionForm action={handover} className="grid gap-4">
            <input type="hidden" name="fromId" value={from.id} />
            <div>
              <label className="label" htmlFor="toId">Người nhận</label>
              <select id="toId" name="toId" required className="input">
                <option value="">— Chọn người nhận —</option>
                {users.filter((u) => u.active && u.id !== from.id).map((u) => <option key={u.id} value={u.id}>{u.name ?? u.larkUserId}{u.jobTitle ? ` · ${u.jobTitle}` : ''}</option>)}
              </select>
            </div>
            <fieldset className="grid gap-2">
              <legend className="label">Chuyển sang người nhận</legend>
              {([
                ['brands', `Phân công ${from.brandMembers.length} brand (giữ vai trò PIC / Support)`],
                ['jobs', `${jobN.get(from.id) ?? 0} job đang chạy (chưa vào ĐNTT)`],
                ['lines', `${lineN.get(from.id) ?? 0} dòng plan từ tháng này`],
                ['kocs', `${kocN.get(from.id) ?? 0} KOC phụ trách trong Danh bạ`],
              ] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2"><input type="checkbox" name="part" value={k} defaultChecked className="size-4" />{label}</label>
              ))}
            </fieldset>
            {me.role === 'ADMIN' && from.active && from.id !== me.id && (
              <label className="flex items-center gap-2"><input type="checkbox" name="lock" className="size-4" />Khoá tài khoản (nghỉ việc / chuyển bộ phận)</label>
            )}
            <p className="text-xs text-ink-3">
              Gian hàng và plan đồng bộ từ Lark Base: nếu người cũ vẫn hoạt động, đổi &quot;Người phụ trách&quot; / &quot;Booking PIC&quot; trên Lark, không thì lượt đồng bộ sau gán lại dòng plan Lark cho người cũ.
              Người đã khoá thì đồng bộ bỏ qua, dòng plan Lark về Booking PIC hiện tại của brand.
            </p>
            <div className="flex justify-end gap-2">
              <Link href="/users/assign" className="btn">Hủy</Link>
              <button className="btn btn-primary">Bàn giao</button>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </>
  );
}
