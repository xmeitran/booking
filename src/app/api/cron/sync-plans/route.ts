import { AUTO_SYNC_GAP_MIN } from '@/lib/bookingSync';
import { runOnce } from '@/lib/cronJob';
import { syncPlansJob } from '@/lib/planSync';

// Đồng bộ "4.1 Plan order tổng" từ Lark Base; GitHub Actions gọi 15 phút / lần (.github/workflows/sync-bookings.yml), chạy tối đa 1 lần / giờ.
export const POST = () => runOnce('plans', AUTO_SYNC_GAP_MIN, syncPlansJob);
