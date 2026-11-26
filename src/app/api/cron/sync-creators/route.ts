import { runOnce, scheduledGap } from '@/lib/cronJob';
import { runInChild } from '@/lib/jobProcess';

// Số liệu creator từ kho dữ liệu (qua Metabase) cho Creator matching. Mỗi ngày một lượt sau khi kol-connector chạy (01:00).
export const POST = (req: Request) => runOnce('warehouse-creators', scheduledGap(req, 360), () => runInChild('sync-creators'));
