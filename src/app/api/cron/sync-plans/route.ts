import { AUTO_SYNC_GAP_MIN } from '@/lib/bookingSync';
import { runOnce, scheduledGap } from '@/lib/cronJob';
import { syncPlansJob } from '@/lib/planSync';

// Đồng bộ master data + "4.1 Plan order tổng" từ Lark Base. Server DX: crontab gọi đúng :00 mỗi giờ kèm CRON_SECRET
// (ops/cron-dx.sh). Render / gọi khác: tối đa 1 lần / giờ.
export const POST = (req: Request) => runOnce('plans', scheduledGap(req, AUTO_SYNC_GAP_MIN), syncPlansJob);
