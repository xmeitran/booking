'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { startTransition, useActionState } from 'react';

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const active = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`flex h-8 items-center rounded-md px-3 whitespace-nowrap ${active ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-canvas'}`}
    >
      {children}
    </Link>
  );
}

/** Form gọi server action trả về lỗi (string) hoặc redirect. Không reset ô nhập khi lỗi. */
export function ActionForm({
  action,
  className,
  children,
}: {
  action: (prev: string | null, fd: FormData) => Promise<string | null>;
  className?: string;
  children: React.ReactNode;
}) {
  const [error, run, pending] = useActionState(action, null);
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => run(fd));
      }}
    >
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {error && (
        <p role="alert" className="col-span-full rounded-md bg-critical-soft px-3 py-2 text-critical">
          {error}
        </p>
      )}
    </form>
  );
}

/** Hộp thoại mở bằng query (?edit=...), đóng bằng link về closeHref. Không cần state phía client. */
export function Dialog({ title, closeHref, children }: { title: string; closeHref: string; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-10">
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title" className="w-full max-w-xl rounded-lg bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="dlg-title" className="text-base font-semibold">{title}</h2>
          <Link href={closeHref} className="text-ink-3 hover:text-ink" aria-label="Đóng">✕</Link>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
