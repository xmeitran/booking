import { ActionForm } from '@/components/ui';
import { requireUser } from '@/lib/auth/session';
import { checklist } from '@/lib/integrations';
import { saveIntegration } from '../actions';
import { approvalWidgets } from '@/lib/lark/approval';
import { UsersTabs } from '../Tabs';

// Checklist tích hợp theo tài liệu giải pháp B2C-Ops Phase 1: thứ còn thiếu để từng tích hợp chạy được, Admin bổ sung tại đây.
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const me = await requireUser('ADMIN');
  const { saved } = await searchParams;
  const list = await checklist();
  const missing = list.reduce((s, i) => s + i.missing, 0);
  // Ô form của quy trình duyệt: Admin cần widget id để điền mapping. Chưa có mã / Lark từ chối thì ghi lý do.
  const approval = list.find((i) => i.id === 'approval')!;
  const widgets = approval.items[0].source ? await approvalWidgets().catch((e) => String(e instanceof Error ? e.message : e)) : null;

  return (
    <>
      <UsersTabs me={me} active="/users/integrations" />
      <p className="mb-3 text-[13px] text-ink-2">
        {missing ? `Còn thiếu ${missing} mục bắt buộc ở ${list.filter((i) => i.missing).length} tích hợp.` : 'Đã đủ cấu hình cho các tích hợp đang mở.'}{' '}
        Tích hợp chưa đủ cấu hình thì chức năng tương ứng không hiện trong app. Giá trị đặt trong .env trên server được ưu tiên và không sửa được ở đây.
      </p>
      {saved && <p role="status" className="mb-3 rounded-md bg-positive-soft px-3 py-2 text-positive">Đã lưu cấu hình {list.find((i) => i.id === saved)?.name ?? ''}.</p>}
      <div className="grid gap-4">
        {list.map((i) => (
          <section key={i.id} id={i.id} className="rounded-lg border border-line bg-surface p-4">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{i.name}</h2>
              <span className="pill bg-sunken text-ink-3">{i.code}</span>
              <span className={`pill ${!i.items.length ? 'bg-sunken text-ink-3' : i.missing ? 'bg-warning-soft text-warning' : 'bg-positive-soft text-positive'}`}>{!i.items.length ? 'Đã đóng, chờ thông tin' : i.missing ? `Thiếu ${i.missing} mục` : 'Đủ cấu hình'}</span>
            </div>
            <p className="mb-3 text-xs text-ink-3">{i.what}</p>
            {i.items.length > 0 && <ActionForm action={saveIntegration} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="integration" value={i.id} />
              {i.items.map((x) => (
                <label key={x.key} className={`block ${x.long ? 'col-span-full' : ''}`}>
                  <span className="label">
                    {x.label}{x.optional && <span className="text-ink-3"> (không bắt buộc)</span>}{' '}
                    <span className={`pill ${x.source ? 'bg-positive-soft text-positive' : x.optional ? 'bg-sunken text-ink-3' : 'bg-warning-soft text-warning'}`}>
                      {x.source === 'env' ? 'Đã có (.env)' : x.source === 'db' ? 'Đã nhập' : 'Chưa có'}
                    </span>
                  </span>
                  {x.long
                    ? <textarea name={x.key} rows={3} disabled={x.source === 'env'} placeholder={x.preview || x.hint} className="input font-mono text-xs" />
                    : <input name={x.key} type={x.secret ? 'password' : 'text'} autoComplete="off" disabled={x.source === 'env'} placeholder={x.preview || x.hint} className="input" />}
                  {x.hint && x.preview && <span className="mt-0.5 block text-xs text-ink-3">{x.hint}</span>}
                </label>
              ))}
              <div className="col-span-full flex items-center justify-between gap-3">
                <span className="text-xs text-ink-3">Ô để trống giữ nguyên giá trị cũ; nhập &quot;-&quot; để xoá giá trị đã nhập.</span>
                <button className="btn btn-primary">Lưu</button>
              </div>
            </ActionForm>}
            {i.id === 'approval' && widgets && (
              <div className="mt-3 border-t border-line pt-3 text-xs">
                <p className="mb-1 font-medium text-ink-2">Ô trong form của quy trình duyệt</p>
                {typeof widgets === 'string' ? <p className="text-critical">{widgets}</p> : (
                  <ul className="grid gap-0.5 font-mono">{widgets.map((w) => <li key={w.id}>{w.id} <span className="font-sans text-ink-3">· {w.name} · {w.type}</span></li>)}</ul>
                )}
              </div>
            )}
            {i.todo && (
              <div className="mt-3 border-t border-line pt-3 text-xs">
                <p className="mb-1 font-medium text-ink-2">Cần bổ sung (chưa làm, không đoán)</p>
                <ul className="grid list-disc gap-0.5 pl-4 text-ink-2">{i.todo.map((t) => <li key={t}>{t}</li>)}</ul>
              </div>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
