import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { larkConfigured } from '@/lib/lark';

const ERRORS: Record<string, string> = {
  not_configured: 'Chưa cấu hình LARK_APP_ID / LARK_APP_SECRET.',
  state: 'Phiên đăng nhập hết hạn. Thử lại.',
  lark: 'Lark từ chối xác thực. Thử lại hoặc báo Admin.',
  tenant: 'Tài khoản Lark không thuộc tổ chức được phép.',
  disabled: 'Tài khoản đã bị khóa. Liên hệ Admin.',
  not_allowed: 'Tài khoản Lark chưa được cấp quyền. Gửi Lark User ID bên dưới cho Admin.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect('/');
  const { error } = await searchParams;
  let info: { name: string; userId: string | null; openId: string } | null = null;
  try {
    info = JSON.parse((await cookies()).get('lark_info')?.value ?? 'null');
  } catch {}

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-line bg-surface p-8">
        <h1 className="text-xl font-semibold">Booking Hub</h1>
        <p className="mt-1 text-ink-3">Đăng nhập bằng tài khoản Lark công ty.</p>

        {error && (
          <div role="alert" className="mt-5 rounded-md bg-critical-soft px-3 py-2.5 text-critical">
            {ERRORS[error] ?? 'Đăng nhập thất bại.'}
          </div>
        )}

        {error === 'not_allowed' && info && (
          <dl className="mt-3 space-y-1.5 rounded-md bg-sunken px-3 py-2.5 text-[13px]">
            <div><dt className="inline text-ink-3">Tên: </dt><dd className="inline">{info.name}</dd></div>
            <div>
              <dt className="inline text-ink-3">Lark User ID: </dt>
              <dd className="inline font-mono select-all">{info.userId ?? info.openId}</dd>
            </div>
            {!info.userId && <p className="text-xs text-ink-3">Lark app chưa bật quyền lấy User ID nên hiển thị Open ID. Admin thêm Open ID này cũng được.</p>}
          </dl>
        )}

        {/* <a> thường, không dùng <Link>: route handler redirect sang Lark, không được prefetch. */}
        <a href="/api/auth/lark/login" className="btn btn-primary mt-6 h-11 w-full" aria-disabled={!larkConfigured()}>
          Đăng nhập bằng Lark
        </a>

        {process.env.NODE_ENV === 'development' && (
          <form action="/api/auth/dev" method="post" className="mt-6 border-t border-line pt-4">
            <label className="label" htmlFor="dev-id">Dev: đăng nhập bằng Lark User ID (không gọi Lark)</label>
            <div className="flex gap-2">
              <input id="dev-id" name="id" required className="input font-mono" />
              <button className="btn">Vào</button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
