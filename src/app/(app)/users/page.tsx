import Link from 'next/link';
import { Role } from '@prisma/client';
import { ActionForm, Avatar, Dialog } from '@/components/ui';
import { db } from '@/lib/db';
import { requireUser, ROLE_LABEL } from '@/lib/session';
import { saveUser, syncLark } from './actions';

const ROLE_TONE: Record<Role, string> = { ADMIN: 'bg-accent-soft text-accent', LEADER: 'bg-positive-soft text-positive', STAFF: 'bg-sunken text-ink-2' };
const fmtTime = (d: Date) => d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' });

type Search = { edit?: string; synced?: string; missing?: string; sync_error?: string };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const me = await requireUser('ADMIN');
  const { edit, synced, missing, sync_error } = await searchParams;
  const users = await db.user.findMany({ orderBy: [{ active: 'desc' }, { role: 'asc' }, { name: 'asc' }] });
  const editing = edit && edit !== 'new' ? users.find((u) => u.id === edit && u.id !== me.id) : undefined;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">User</h1>
        <div className="flex gap-2">
          <form action={syncLark}>
            <button className="btn">Đồng bộ Lark</button>
          </form>
          <Link href="?edit=new" className="btn btn-primary">Thêm user</Link>
        </div>
      </div>

      {synced && (
        <div role="status" className={`mb-3 rounded-md px-3 py-2.5 ${missing ? 'bg-warning-soft text-warning' : 'bg-positive-soft text-positive'}`}>
          Đã cập nhật {synced} user từ Lark.{missing && <> Không tìm thấy trên Lark: <span className="font-mono">{missing.replaceAll(',', ', ')}</span></>}
        </div>
      )}
      {sync_error && (
        <div role="alert" className="mb-3 rounded-md bg-critical-soft px-3 py-2.5 text-critical">
          {sync_error.includes('99991672') ? 'Lark app chưa có quyền đọc danh bạ. Bật quyền trong Lark Developer Console rồi phát hành phiên bản mới.' : 'Không đồng bộ được từ Lark.'}
          <div className="mt-1 font-mono text-xs opacity-80">{sync_error}</div>
        </div>
      )}

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
                <td><span className={`pill ${ROLE_TONE[u.role]}`}>{ROLE_LABEL[u.role]}</span></td>
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
            </div>
            <div>
              <label className="label" htmlFor="role">Vai trò</label>
              <select id="role" name="role" defaultValue={editing?.role ?? 'STAFF'} className="input">
                {Object.values(Role).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
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
