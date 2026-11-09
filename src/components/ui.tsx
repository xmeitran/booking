'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { startTransition, useActionState, useState } from 'react';

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
export function Dialog({ title, closeHref, wide, children }: { title: string; closeHref: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-10">
      <div role="dialog" aria-modal="true" aria-labelledby="dlg-title" className={`w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} rounded-lg bg-surface shadow-lg`}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="dlg-title" className="text-base font-semibold">{title}</h2>
          <Link href={closeHref} className="text-ink-3 hover:text-ink" aria-label="Đóng">✕</Link>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** Menu thao tác "⋯" của một dòng: mục là Link / form; bấm một mục hoặc ra ngoài thì đóng. */
export function Menu({ label = 'Thao tác', children }: { label?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block text-left" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)} className="btn h-8 w-8 justify-center px-0">⋯</button>
      {open && (
        <div role="menu" onClick={() => setTimeout(() => setOpen(false))} className="absolute right-0 z-30 mt-1 grid w-72 gap-0.5 rounded-lg border border-line bg-surface p-1 text-[13px] shadow-lg [&_a]:block [&_a]:rounded-md [&_a]:px-3 [&_a]:py-2 [&_a:hover]:bg-canvas [&_button.item]:w-full [&_button.item]:rounded-md [&_button.item]:px-3 [&_button.item]:py-2 [&_button.item]:text-left [&_button.item:hover]:bg-canvas">
          {children}
        </div>
      )}
    </div>
  );
}

/** Logo Upbase + tên sản phẩm (logo PNG 180×48 lấy từ repo b2c). */
export function BrandLogo({ size = 24 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <img src="/upbase-logo.png" alt="Upbase" style={{ height: size, width: 'auto' }} />
      <span className="border-l border-line pl-2.5 text-[13px] leading-tight font-semibold">Booking Hub</span>
    </span>
  );
}

// Chỉ lấy chữ cái (tên kênh hay có emoji / ký tự trang trí; cắt theo UTF-16 sẽ vỡ ký tự và lệch hydrate).
const initials = (name: string) => {
  const w = name.split(/\s+/).map((x) => x.match(/\p{L}/u)?.[0]).filter(Boolean);
  return ((w[0] ?? '') + (w.length > 1 ? w[w.length - 1] : '')).toUpperCase() || '?';
};

export function Avatar({ src, name, size = 32 }: { src?: string | null; name?: string | null; size?: number }) {
  const style = { width: size, height: size };
  if (src) return <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover" />;
  return (
    <span style={{ ...style, fontSize: size * 0.38 }} className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent">
      {name ? initials(name) : '?'}
    </span>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn h-8 px-2.5 text-xs"
      onClick={() => navigator.clipboard.writeText(text).then(() => setDone(true))}
    >
      {done ? 'Đã chép' : 'Chép'}
    </button>
  );
}
