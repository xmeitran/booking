// Mail mời hợp tác KOC (L6) qua SMTP (Lark Mail: smtp.larksuite.com:465, mật khẩu ứng dụng của hộp thư).
import 'server-only';
import nodemailer from 'nodemailer';
import { cfg, requireCfg } from './integrations';

export const DEFAULT_SUBJECT = '[{{thuong_hieu}} x UpBase] Lời mời hợp tác Booking tháng {{thang_chien_dich}} — Kênh {{ten_koc}} ({{id_kenh}})';
// Mẫu TPL-PAID-01 của bản b2c, bỏ các dòng Booking Hub chưa có dữ liệu (SĐT PIC, content tag).
export const DEFAULT_BODY = `Chào bạn {{ten_koc}},

Mình là {{ten_pic}} — Đại diện bộ phận Booking Thương hiệu {{thuong_hieu}} ({{gian_hang}}) thuộc hệ sinh thái UpBase Vietnam.

Qua quá trình theo dõi kênh {{id_kenh}} ({{link_kenh}}), nhãn hàng {{thuong_hieu}} rất ấn tượng với phong cách sáng tạo nội dung và tệp khán giả của bạn. Chúng mình trân trọng gửi lời mời bạn hợp tác trong chiến dịch tháng {{thang_chien_dich}} với thông tin như sau:

1. Thông tin chiến dịch & Sản phẩm:
- Nhãn hàng: {{thuong_hieu}} ({{gian_hang}})
- Sản phẩm trọng tâm: {{san_pham}}
- Hình thức: {{loai_gia}}
- Thời gian lên sóng dự kiến: {{ngay_air_du_kien}}

2. Quyền lợi & Ngân sách hợp tác:
- Chi phí đề xuất: {{muc_cat_xe}}
- Hỗ trợ sản phẩm chính hãng gửi tận nơi để trải nghiệm và quay dựng.
{{ghi_chu_rieng}}

3. Bước tiếp theo:
Nếu bạn quan tâm, bạn vui lòng phản hồi lại email này để mình gửi Brief chi tiết và xác nhận địa chỉ nhận sản phẩm mẫu nhé.

Phụ trách Booking: {{ten_pic}} — {{email_pic}}

Rất mong được hợp tác cùng bạn {{ten_koc}}!

Trân trọng,
Phòng Phát Triển Đối Tác KOC/KOL Khối B2C — UpBase Vietnam`;

/** Thay {{khoa}} bằng giá trị; khoá không có giá trị thành chuỗi rỗng, 3+ dòng trống gom còn 2. */
export const render = (tpl: string, vars: Record<string, string | null | undefined>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '').replace(/\n{3,}/g, '\n\n');

export async function inviteTemplate() {
  return { subject: (await cfg('MAIL_INVITE_SUBJECT')) || DEFAULT_SUBJECT, body: (await cfg('MAIL_INVITE_BODY')) || DEFAULT_BODY };
}

/** Trả hàm gửi dùng chung một kết nối SMTP cho cả lượt. */
export async function mailer() {
  const c = await requireCfg('mail', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS');
  const port = Number(await cfg('SMTP_PORT')) || 465;
  const from = { name: (await cfg('MAIL_FROM_NAME')) || 'UpBase Booking', address: c.SMTP_USER };
  const t = nodemailer.createTransport({ host: c.SMTP_HOST, port, secure: port === 465, auth: { user: c.SMTP_USER, pass: c.SMTP_PASS } });
  return (to: string, subject: string, text: string, replyTo?: string | null) => t.sendMail({ from, to, subject, text, replyTo: replyTo ?? undefined });
}
