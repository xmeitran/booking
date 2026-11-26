import Link from 'next/link';
import { can, type Me } from '@/lib/auth/session';

// Tab "Phân quyền" (theo nhóm "Phân quyền & Định mức" của app b2c, chưa có định mức công việc).
const TABS = [
  { href: '/users', label: 'Người dùng & đăng nhập', admin: true, note: 'Ai được vào Booking Hub và với vai trò gì.' },
  { href: '/users/roles', label: 'Vai trò & quyền', admin: true, note: 'Tick để cấp quyền cho cả vai trò; có hiệu lực ở lần tải trang kế tiếp.' },
  { href: '/users/assign', label: 'Phân công & bàn giao', admin: false, note: 'Ai phụ trách brand nào; bàn giao việc khi đổi người hoặc nghỉ việc.' },
  { href: '/users/integrations', label: 'Tích hợp', admin: true, note: 'Điền thông tin kết nối với hệ thống khác; thiếu thì chức năng đó tạm ẩn.' },
];

export function UsersTabs({ me, active, action }: { me: Me; active: string; action?: React.ReactNode }) {
  const tabs = TABS.filter((t) => (t.admin ? me.role === 'ADMIN' : can(me, 'catalog.edit')));
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Phân quyền</h1>
          <p className="mt-1 text-[13px] text-ink-2">{TABS.find((t) => t.href === active)?.note}</p>
        </div>
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
