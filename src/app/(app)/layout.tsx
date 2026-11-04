import { Avatar, BrandLogo, NavLink } from '@/components/ui';
import { requireUser, ROLE_LABEL } from '@/lib/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-screen md:w-56 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex h-14 items-center px-4"><BrandLogo size={20} /></div>
        <nav className="flex gap-0.5 overflow-x-auto px-2 pb-2 md:flex-col">
          <NavLink href="/booking">Booking</NavLink>
          <NavLink href="/listing">Listing</NavLink>
          <NavLink href="/contacts">Danh bạ KOC</NavLink>
          <NavLink href="/data">Dữ liệu</NavLink>
          {user.role === 'ADMIN' && <NavLink href="/users">User</NavLink>}
        </nav>
        <div className="flex items-center gap-3 border-t border-line px-4 py-3 md:mt-auto">
          <Avatar src={user.avatarUrl} name={user.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{user.name ?? user.larkUserId}</div>
            <div className="truncate text-xs text-ink-3">{[ROLE_LABEL[user.role], user.department].filter(Boolean).join(' · ')}</div>
          </div>
          <form action="/api/auth/logout" method="post">
            <button className="text-xs text-ink-3 hover:text-critical">Đăng xuất</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 md:px-6">{children}</main>
    </div>
  );
}
