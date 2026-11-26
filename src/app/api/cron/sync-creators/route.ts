import { runOnce, scheduledGap } from '@/lib/cronJob';
import { syncWarehouseCreators } from '@/lib/warehouse/creatorSync';

// Số liệu creator từ kho dữ liệu (ClickHouse) cho Creator matching. Mỗi ngày một lượt sau khi kol-connector chạy (01:00).
export const POST = (req: Request) => runOnce('warehouse-creators', scheduledGap(req, 360), syncWarehouseCreators);
