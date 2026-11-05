import { NextResponse, after } from 'next/server';
import { AUTO_SYNC_GAP_MIN, syncBookingsJob } from '@/lib/bookingSync';
import { runOnce } from '@/lib/cronJob';

// Webhook cho Lark Base automation (Gửi HTTP request) đồng bộ "3.2 List duyệt book". 05/11/2026 đã tắt automation vì
// mỗi dòng bị sửa tốn 1 lượt hạn mức Lark; hiện đồng bộ bằng nút "Đồng bộ ngay" (tab Booking) và lịch GitHub.
// Trả lời ngay (automation của Lark chờ phản hồi vài giây), đồng bộ chạy nền ~2 phút. runOnce chỉ chạy 1 lần / giờ và
// không chạy chồng; không cần khoá bí mật vì gọi thừa chỉ trả lời "đã nhận", không làm gì thêm.
const handle = () => {
  after(() => runOnce('bookings', AUTO_SYNC_GAP_MIN, syncBookingsJob));
  return NextResponse.json({ ok: true, message: 'Đã nhận, Booking Hub đồng bộ Lark Base ở nền.' }, { status: 202 });
};
export const POST = handle;
export const GET = handle;
