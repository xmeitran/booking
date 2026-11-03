import Link from 'next/link';
import { Role } from '@prisma/client';
import { ActionForm, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { requireUser, ROLE_LABEL } from '@/lib/session';
import { saveUser } from './actions';

const ROLE_TONE: Record<Role, string> = { ADMIN: 'bg-accent-soft text-accent', LEADER: 'bg-positive-soft text-positive', STAFF: 'bg-sunken text-ink-2' };
const fmtTime = (d: Date | null) => (d ? d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }) : '—');

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const me = await requireUser('ADMIN');
  const { edit } = await searchParams;
  const users = await db.user.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'asc' }] });
  const editing = edit && edit !== 'new' ? users.find((u) => u.id === edit) : undefined;
  const isSelf = editing?.id === me.id;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">User</h1>
        <Link href="?edit=new" className="btn btn-primary">Thêm user</Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="tbl">
          <thead>
            <tr><th>Tên</th><th>Lark User ID</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th /></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.name ?? '—'}{u.id === me.id && <span className="ml-1.5 text-xs font-normal text-ink-3">(bạn)</span>}</td>
                <td className="font-mono">{u.larkUserId}</td>
                <td>{u.email ?? '—'}</td>
                <td><span className={`pill ${ROLE_TONE[u.role]}`}>{ROLE_LABEL[u.role]}</span></td>
                <td>{u.active ? <span className="pill bg-positive-soft text-positive">Hoạt động</span> : <span className="pill bg-critical-soft text-critical">Đã khóa</span>}</td>
                <td>{u.lastLoginAt ? fmtTime(u.lastLoginAt) : <span className="text-ink-3">Chưa đăng nhập</span>}</td>
                <td className="text-right"><Link href={`?edit=${u.id}`} className="link">Sửa</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(edit === 'new' || editing) && (
        <Dialog title={editing ? 'Sửa user' : 'Thêm user'} closeHref="/users">
          <ActionForm action={saveUser} className="grid gap-4">
            <input type="hidden" name="id" value={editing?.id ?? ''} />
            <div>
              <label className="label" htmlFor="larkUserId">Lark User ID</label>
              <input id="larkUserId" name="larkUserId" required readOnly={isSelf} defaultValue={editing?.larkUserId} className="input font-mono read-only:bg-sunken" />
              <p className="mt-1 text-xs text-ink-3">Người chưa được thêm khi bấm đăng nhập sẽ thấy ID của mình ở trang login để gửi Admin.</p>
            </div>
            <div>
              <label className="label" htmlFor="name">Tên</label>
              <input id="name" name="name" defaultValue={editing?.name ?? ''} placeholder="Để trống thì lấy tên Lark khi đăng nhập" className="input" />
            </div>
            <div>
              <label className="label" htmlFor="role">Vai trò</label>
              <select id="role" name="role" defaultValue={editing?.role ?? 'STAFF'} disabled={isSelf} className="input">
                {Object.values(Role).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              {/* select disabled không gửi giá trị; action bỏ qua role khi tự sửa nên gửi giá trị cũ cho qua validate. */}
              {isSelf && <input type="hidden" name="role" value={editing.role} />}
            </div>
            {editing && !isSelf && (
              <label className="flex items-center gap-2">
                <input type="checkbox" name="active" defaultChecked={editing.active} className="size-4" />
                Cho phép đăng nhập
              </label>
            )}
            {isSelf && <p className="text-xs text-ink-3">Bạn không thể tự đổi ID, vai trò hay khóa tài khoản của mình.</p>}
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
