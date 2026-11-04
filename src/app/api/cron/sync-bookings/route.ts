import { syncBookings } from '@/lib/bookingSync';
import { runOnce } from '@/lib/cronJob';

// Gọi mỗi giờ từ GitHub Actions (.github/workflows/sync-bookings.yml).
export const POST = () =>
  runOnce('bookings', 10, async () => {
    const r = await syncBookings();
    return `${r.total} booking · ${r.created} mới · ${r.updated} cập nhật · ${r.removed} xoá · ${r.kocs} KOL mới`;
  });
