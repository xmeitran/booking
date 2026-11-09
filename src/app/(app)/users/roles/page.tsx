import { ActionForm } from '@/components/ui';
import { ALL_PERMS, EDITABLE_ROLES, PERMS, readPolicy } from '@/lib/access';
import { db } from '@/lib/db';
import { requireUser, ROLE_LABEL } from '@/lib/session';
import { savePerms } from '../actions';
import { UsersTabs } from '../Tabs';

const ROLE_HINT = { ADMIN: 'Mọi quyền, quản lý user và phân quyền.', LEADER: 'Trưởng nhóm.', STAFF: 'Booking PIC / Support.' };

// Ma trận vai trò × quyền (như "Ma trận chức năng" của app b2c, nhưng mọi ô đều được kiểm tra thật trên server).
export default async function RolesPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const me = await requireUser('ADMIN');
  const { saved } = await searchParams;
  const [policy, counts] = await Promise.all([readPolicy(), db.user.groupBy({ by: ['role'], where: { active: true }, _count: true })]);
  const count = Object.fromEntries(counts.map((c) => [c.role, c._count]));

  return (
    <>
      <UsersTabs me={me} active="/users/roles" />
      <p className="mb-3 text-[13px] text-ink-2">
        Tick để cấp quyền cho cả vai trò; đổi vai trò từng người ở tab Người dùng. Quyền có hiệu lực ngay ở lần tải trang kế tiếp của người đó.
      </p>
      {saved && <p role="status" className="mb-3 rounded-md bg-positive-soft px-3 py-2 text-positive">Đã lưu ma trận quyền.</p>}
      <ActionForm action={savePerms} className="grid gap-3">
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="tbl">
            <thead>
              <tr>
                <th>Quyền</th>
                {(['ADMIN', ...EDITABLE_ROLES] as const).map((r) => (
                  <th key={r} className="w-32 text-center">
                    <div>{ROLE_LABEL[r]}</div>
                    <div className="text-xs font-normal text-ink-3">{count[r] ?? 0} user · {ROLE_HINT[r]}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_PERMS.map((p) => (
                <tr key={p}>
                  <td>
                    <div className="font-medium">{PERMS[p].label}</div>
                    {PERMS[p].hint && <div className="text-xs text-ink-3">{PERMS[p].hint}</div>}
                  </td>
                  <td className="text-center"><input type="checkbox" checked disabled className="size-4" aria-label={`Admin: ${PERMS[p].label}`} /></td>
                  {EDITABLE_ROLES.map((r) => (
                    <td key={r} className="text-center">
                      <input type="checkbox" name={`${r}|${p}`} defaultChecked={policy.perms[r].includes(p)} className="size-4" aria-label={`${ROLE_LABEL[r]}: ${PERMS[p].label}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-3">
          Luôn mở cho mọi người: xem Danh bạ KOC, Dữ liệu, Danh mục, Creator matching; tạo listing, job, ĐNTT trong phạm vi được xem. Chỉ Admin: quản lý user, phân quyền, xoá brand.
        </p>
        <div className="flex justify-end"><button className="btn btn-primary">Lưu ma trận quyền</button></div>
      </ActionForm>
    </>
  );
}
