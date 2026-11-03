import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Avatar, BrandLogo, CopyButton } from '@/components/ui';
import { getCurrentUser } from '@/lib/session';

const ERRORS: Record<string, string> = {
  not_configured: 'Chưa cấu hình LARK_APP_ID / LARK_APP_SECRET.',
  state: 'Phiên đăng nhập hết hạn. Bấm đăng nhập lại.',
  lark: 'Lark từ chối xác thực. Thử lại hoặc báo Admin.',
  tenant: 'Tài khoản Lark không thuộc tổ chức được phép.',
  disabled: 'Tài khoản của bạn đã bị khóa. Liên hệ Admin.',
  not_allowed: 'Tài khoản chưa được cấp quyền vào Booking Hub.',
};

const FACTS = ['Đăng nhập bằng tài khoản Lark công ty', 'Danh bạ KOC dùng chung cho cả team', 'Admin phân quyền Admin, Leader, Nhân viên'];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect('/');
  const { error } = await searchParams;
  let info: { name: string; userId: string | null; openId: string } | null = null;
  try {
    info = JSON.parse((await cookies()).get('lark_info')?.value ?? 'null');
  } catch {}
  const larkId = info && (info.userId ?? info.openId);

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="flex flex-col bg-surface px-6 py-8 sm:px-12">
        <BrandLogo />

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Đăng nhập</h1>
          <p className="mt-2 text-ink-2">Dùng tài khoản Lark công ty để vào Booking Hub.</p>

          {error && (
            <div role="alert" className="mt-6 flex gap-2.5 rounded-md bg-critical-soft px-3.5 py-3 text-critical">
              <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 size-4 shrink-0" aria-hidden>
                <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-11.25a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 1.5 0v-4.5ZM10 14.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              <span>{ERRORS[error] ?? 'Đăng nhập thất bại.'}</span>
            </div>
          )}

          {error === 'not_allowed' && info && larkId && (
            <div className="mt-3 rounded-md border border-line p-4">
              <div className="flex items-center gap-3">
                <Avatar name={info.name} size={36} />
                <div className="min-w-0">
                  <div className="font-medium">{info.name}</div>
                  <div className="text-xs text-ink-3">Gửi Lark User ID này cho Admin để được cấp quyền</div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2 rounded-md bg-sunken py-1.5 pr-1.5 pl-3">
                <code className="min-w-0 flex-1 truncate font-mono text-[13px] select-all">{larkId}</code>
                <CopyButton text={larkId} />
              </div>
            </div>
          )}

          {/* <a> thường, không dùng <Link>: route handler redirect sang Lark, không được prefetch. */}
          <a href="/api/auth/lark/login" className="btn btn-primary mt-8 h-12 w-full text-[15px]">
            Đăng nhập bằng Lark
            <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
              <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.64l-3.97-3.97a.75.75 0 1 1 1.06-1.06l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 1 1-1.06-1.06l3.97-3.97H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
            </svg>
          </a>
        </div>

        <footer className="text-xs text-ink-3">© {new Date().getFullYear()} UpBase · Marketing B2C</footer>
      </section>

      <aside className="hidden flex-col justify-center bg-primary px-16 text-white lg:flex">
        <p className="text-sm font-medium tracking-wide text-white/50 uppercase">Marketing B2C</p>
        <h2 className="mt-4 max-w-md text-[40px] leading-[1.15] font-semibold tracking-tight">Booking Hub</h2>
        <p className="mt-4 max-w-md text-lg text-white/70">Quản lý booking và danh bạ KOC cho team Marketing B2C.</p>
        <ul className="mt-12 space-y-4">
          {FACTS.map((f) => (
            <li key={f} className="flex items-center gap-3 text-white/85">
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-5 shrink-0 text-white/40" aria-hidden>
                <path fillRule="evenodd" d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.58l7.3-7.3a1 1 0 0 1 1.4 0Z" clipRule="evenodd" />
              </svg>
              {f}
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
