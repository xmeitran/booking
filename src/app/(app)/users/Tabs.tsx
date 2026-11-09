import Link from 'next/link';
import { can, type Me } from '@/lib/session';

// Tab "Phân quyền" (theo nhóm "Phân quyền & Định mức" của app b2c, chưa có định mức công việc).
const TABS = [
  { href: '/users', label: 'Người dùng & đăng nhập', admin: true },
  { href: '/users/roles', label: 'Vai trò & quyền', admin: true },
  { href: '/users/assign', label: 'Phân công & bàn giao', admin: false },
];

export function UsersTabs({ me, active, action }: { me: Me; active: string; action?: React.ReactNode }) {
  const tabs = TABS.filter((t) => (t.admin ? me.role === 'ADMIN' : can(me, 'catalog.edit')));
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Phân quyền</h1>
        {action}
      </div>
      <nav className="mt-3 flex gap-1 overflow-x-auto border-b border-line text-[13px]">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={t.href === active ? 'page' : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 ${t.href === active ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-3 hover:text-ink'}`}>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
