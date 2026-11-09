import Link from 'next/link';
import { Role } from '@prisma/client';
import { JOB_ROLES } from '@/lib/catalog';
import { ActionForm, Avatar, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { readPolicy } from '@/lib/access';
import { requireUser, ROLE_LABEL } from '@/lib/session';
import { saveLoginDepts, saveUser } from './actions';
import { UsersTabs } from './Tabs';

const ROLE_TONE: Record<Role, string> = { ADMIN: 'bg-accent-soft text-accent', LEADER: 'bg-positive-soft text-positive', STAFF: 'bg-sunken text-ink-2' };
const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' });

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const me = await requireUser('ADMIN');
  const { edit } = await searchParams;
  const [users, policy] = await Promise.all([db.user.findMany({ orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }] }), readPolicy()]);
  // Gợi ý tên phòng ban Lark đang có (cột phòng ban của user ghép nhiều phòng bằng dấu phẩy).
  const depts = [...new Set(users.flatMap((u) => u.department?.split(', ') ?? []))].sort();
  const editing = edit && edit !== 'new' ? users.find((u) => u.id === edit && u.id !== me.id) : undefined;

  return (
    <>
      <UsersTabs me={me} active="/users" action={<Link href="?edit=new" className="btn btn-primary">Thêm user</Link>} />

      <section className="mb-4 rounded-lg border border-line bg-surface px-5 py-4">
        <h2 className="text-base font-semibold">Cổng đăng nhập Lark</h2>
        <p className="mt-1 text-[13px] text-ink-2">
          Người có trong danh sách dưới (và chưa bị khoá) đăng nhập được. Người chưa có mà thuộc phòng ban Lark khai báo ở đây sẽ tự được tạo user Nhân viên ở lần đăng nhập đầu;
          phòng khác bị chặn, Admin thêm tay từng người. Team Booking trên Lark Base (6.2 Nhân sự Booking) vẫn được tạo tự động mỗi lượt đồng bộ.
        </p>
        <ActionForm action={saveLoginDepts} className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className="label" htmlFor="depts">Phòng ban tự cho đăng nhập (mỗi dòng một tên, khớp nếu tên phòng ban Lark có chứa)</label>
            <textarea id="depts" name="depts" rows={3} defaultValue={policy.loginDepts.join('\n')} placeholder={'Booking\nMarketing B2C'} className="input" />
            {depts.length > 0 && <p className="mt-1 text-xs text-ink-3">Phòng ban của user hiện có: {depts.join(' · ')}</p>}
          </div>
          <button className="btn btn-primary">Lưu cổng đăng nhập</button>
        </ActionForm>
        {!policy.loginDepts.length && <p className="mt-2 text-xs text-warning">Chưa khai báo phòng ban: chỉ người Admin thêm / đồng bộ từ Lark Base mới đăng nhập được.</p>}
      </section>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr><th>Người dùng</th><th>Phòng ban</th><th>Lark User ID</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.active ? undefined : 'opacity-60'}>
                <td>
                  <div className="flex items-center gap-3">
                    <Avatar src={u.avatarUrl} name={u.name} size={36} />
                    <div className="min-w-0">
                      <div className="font-medium">
                        {u.name ?? <span className="font-normal text-ink-3">Chưa có thông tin Lark</span>}
                        {u.id === me.id && <span className="ml-1.5 text-xs font-normal text-ink-3">(bạn)</span>}
                      </div>
                      {u.email && <div className="text-xs text-ink-3">{u.email}</div>}
                    </div>
                  </div>
                </td>
                <td>
                  <div>{u.department ?? '—'}</div>
                  {u.jobTitle && <div className="text-xs text-ink-3">{u.jobTitle}</div>}
                </td>
                <td className="font-mono text-xs">{u.larkUserId}</td>
                <td>
                  <span className={`pill ${ROLE_TONE[u.role]}`}>{ROLE_LABEL[u.role]}</span>
                  {u.jobRole && <div className="mt-0.5 text-xs text-ink-3">{u.jobRole}</div>}
                </td>
                <td>{u.active ? <span className="pill bg-positive-soft text-positive">Hoạt động</span> : <span className="pill bg-critical-soft text-critical">Đã khóa</span>}</td>
                <td>{u.lastLoginAt ? fmtTime(u.lastLoginAt) : <span className="text-ink-3">Chưa đăng nhập</span>}</td>
                <td className="text-right">{u.id !== me.id && <Link href={`?edit=${u.id}`} className="link">Sửa</Link>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(edit === 'new' || editing) && (
        <Dialog title={editing ? `Sửa ${editing.name ?? editing.larkUserId}` : 'Thêm user'} closeHref="/users">
          <ActionForm action={saveUser} className="grid gap-4">
            <input type="hidden" name="id" value={editing?.id ?? ''} />
            <div>
              <label className="label" htmlFor="larkUserId">Lark User ID</label>
              <input id="larkUserId" name="larkUserId" required defaultValue={editing?.larkUserId} placeholder="VD: HN001 hoặc ou_..." className="input font-mono" />
              <p className="mt-1 text-xs text-ink-3">Tên, email, avatar, phòng ban tự lấy từ Lark khi lưu.</p>
            </div>
            <div>
              <label className="label" htmlFor="role">Quyền trong app</label>
              <select id="role" name="role" defaultValue={editing?.role ?? 'STAFF'} className="input">
                {Object.values(Role).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="jobRole">Vai trò nghiệp vụ</label>
              <select id="jobRole" name="jobRole" defaultValue={editing?.jobRole ?? ''} className="input">
                <option value="">—</option>
                {JOB_ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
              <p className="mt-1 text-xs text-ink-3">Quyền trong app theo ô ở trên (chi tiết ở tab Vai trò &amp; quyền); brand phụ trách gán ở tab Phân công.</p>
            </div>
            {editing && (
              <label className="flex items-center gap-2">
                <input type="checkbox" name="active" defaultChecked={editing.active} className="size-4" />
                Cho phép đăng nhập
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Link href="/users" className="btn">Hủy</Link>
              <button className="btn btn-primary">Lưu</button>
            </div>
          </ActionForm>
        </Dialog>
      )}
    </>
  );
}
