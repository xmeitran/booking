import { AUTO_SYNC_GAP_MIN, syncBookingsJob } from '@/lib/bookingSync';
import { runOnce, scheduledGap } from '@/lib/cronJob';

// Server DX: crontab gọi đúng :00 mỗi giờ kèm CRON_SECRET (ops/cron-dx.sh). Render / gọi khác: tối đa 1 lần / giờ.
export const POST = (req: Request) => runOnce('bookings', scheduledGap(req, AUTO_SYNC_GAP_MIN), syncBookingsJob);
