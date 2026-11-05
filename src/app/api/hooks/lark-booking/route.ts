import { NextResponse, after } from 'next/server';
import { AUTO_SYNC_GAP_MIN, syncBookingsJob } from '@/lib/bookingSync';
import { runOnce } from '@/lib/cronJob';

// Lark Base automation gọi mỗi giờ (Gửi HTTP request) để đồng bộ "3.2 List duyệt book".
// Trả lời ngay (automation của Lark chờ phản hồi vài giây), đồng bộ chạy nền ~2 phút. runOnce chỉ chạy 1 lần / giờ và
// không chạy chồng; không cần khoá bí mật vì gọi thừa chỉ trả lời "đã nhận", không làm gì thêm.
const handle = () => {
  after(() => runOnce('bookings', AUTO_SYNC_GAP_MIN, syncBookingsJob));
  return NextResponse.json({ ok: true, message: 'Đã nhận, Booking Hub đồng bộ Lark Base ở nền.' }, { status: 202 });
};
export const POST = handle;
export const GET = handle;
