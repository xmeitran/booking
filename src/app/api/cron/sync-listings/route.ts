import { AUTO_SYNC_GAP_MIN } from '@/lib/bookingSync';
import { runOnce, scheduledGap } from '@/lib/cronJob';
import { syncListingsJob } from '@/lib/listingSync';

// Đồng bộ "3.1 Listing KOCs" từ Lark Base vào tab Listing. Server DX: crontab gọi đúng :00 mỗi giờ kèm CRON_SECRET
// (ops/cron-dx.sh). Gọi khác: tối đa 1 lần / giờ.
export const POST = (req: Request) => runOnce('listings', scheduledGap(req, AUTO_SYNC_GAP_MIN), syncListingsJob);
