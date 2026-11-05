import { AUTO_SYNC_GAP_MIN, syncBookingsJob } from '@/lib/bookingSync';
import { runOnce } from '@/lib/cronJob';

// Dự phòng cho Lark automation: GitHub Actions gọi 15 phút / lần (.github/workflows/sync-bookings.yml), chạy tối đa 1 lần / giờ.
export const POST = () => runOnce('bookings', AUTO_SYNC_GAP_MIN, syncBookingsJob);
