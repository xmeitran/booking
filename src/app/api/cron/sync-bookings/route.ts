import { syncBookingsJob } from '@/lib/bookingSync';
import { runOnce } from '@/lib/cronJob';

// Gọi 15 phút / lần từ GitHub Actions (.github/workflows/sync-bookings.yml); chạy tối đa 10 phút / lần.
export const POST = () => runOnce('bookings', 10, syncBookingsJob);
