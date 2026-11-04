'use client';

/** Ô sửa nhanh trong bảng: chọn xong (select) hoặc rời ô / Enter (input) là lưu bằng server action. */
export function InlineField({ action, id, field, label, value, options, type = 'text', placeholder }: {
  action: (fd: FormData) => Promise<void>;
  id: string;
  field: string;
  label: string;
  value: string;
  options?: string[];
  type?: 'text' | 'number' | 'date';
  placeholder?: string;
}) {
  const submit = (el: HTMLInputElement | HTMLSelectElement) => {
    if (el.value !== value) el.form?.requestSubmit();
  };
  const cls = 'input h-7 px-1.5 text-xs';
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="field" value={field} />
      {options ? (
        <select name="value" defaultValue={value} aria-label={label} onChange={(e) => submit(e.currentTarget)} className={`${cls} min-w-28`}>
          <option value="">—</option>
          {options.map((o) => <option key={o}>{o}</option>)}
        </select>
      ) : (
        <input
          name="value" type={type} defaultValue={value} placeholder={placeholder} aria-label={label} onBlur={(e) => submit(e.currentTarget)}
          {...(type === 'number' ? { min: 0, step: field === 'price' ? 1000 : 1 } : {})}
          className={`${cls} ${type === 'text' ? 'min-w-44' : 'w-28'}`}
        />
      )}
    </form>
  );
}
