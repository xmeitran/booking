// ĐNTT → Lark Approval (L4) và đọc lại trạng thái duyệt (L5). Mã quy trình và mapping ô form do Admin nhập ở Phân quyền → Tích hợp:
// mỗi quy trình Approval có widget id riêng nên không đoán được, phải lấy từ định nghĩa quy trình (approvalWidgets).
import 'server-only';
import { requireCfg } from '../integrations';
import { larkGet, larkPost, tenantToken } from './lark';

export const FORM_FIELDS = { code: 'Mã ĐNTT', amount: 'Tổng giá net', gross: 'Tổng kèm thuế TNCN', jobs: 'Danh sách job', koc: 'KOC', bank: 'Thông tin chuyển khoản', note: 'Ghi chú', creator: 'Người tạo' } as const;
export type FormValues = Record<keyof typeof FORM_FIELDS, string | number>;
type Widget = { id: string; name: string; type: string };

/** Các ô trong form của quy trình duyệt (để Admin biết widget id khi điền mapping). */
export async function approvalWidgets(): Promise<Widget[]> {
  const { LARK_APPROVAL_CODE } = await requireCfg('approval', 'LARK_APPROVAL_CODE');
  const data = await larkGet(`/open-apis/approval/v4/approvals/${encodeURIComponent(LARK_APPROVAL_CODE)}`, await tenantToken());
  return (JSON.parse(data.form ?? '[]') as Widget[]).map(({ id, name, type }) => ({ id, name, type }));
}

/** Tạo đơn duyệt đứng tên người gửi. Trả instance_code. */
export async function sendApproval(larkUserId: string, values: FormValues): Promise<string> {
  const c = await requireCfg('approval', 'LARK_APPROVAL_CODE', 'LARK_APPROVAL_FORM_MAP');
  const map = JSON.parse(c.LARK_APPROVAL_FORM_MAP) as Record<string, string>;
  const widgets = new Map((await approvalWidgets()).map((w) => [w.id, w]));
  const form = Object.entries(map).map(([id, field]) => {
    const w = widgets.get(id);
    if (!w) throw new Error(`Mapping form Approval: quy trình không có ô "${id}".`);
    if (!(field in FORM_FIELDS)) throw new Error(`Mapping form Approval: trường "${field}" không hợp lệ (dùng: ${Object.keys(FORM_FIELDS).join(', ')}).`);
    const v = values[field as keyof FormValues];
    return { id, type: w.type, value: w.type === 'number' || w.type === 'amount' ? Number(v) || 0 : String(v ?? '') };
  });
  const who = larkUserId.startsWith('ou_') ? { open_id: larkUserId } : { user_id: larkUserId };
  const { data } = await larkPost('/open-apis/approval/v4/instances', { approval_code: c.LARK_APPROVAL_CODE, ...who, form: JSON.stringify(form) }, await tenantToken());
  return data.instance_code;
}

/** PENDING / APPROVED / REJECTED / CANCELED / DELETED. */
export async function approvalStatus(instanceCode: string): Promise<string> {
  return (await larkGet(`/open-apis/approval/v4/instances/${encodeURIComponent(instanceCode)}`, await tenantToken())).status;
}
