import { runOnce } from '@/lib/cronJob';
import { refreshDataSources } from '@/lib/dataSources';

// Tổng hợp tab Dữ liệu từ Trạm dữ liệu. Workflow gọi mỗi giờ nhưng chỉ chạy 6 giờ một lần (~1–2 phút mỗi lần).
export const POST = () => runOnce('data-sources', 360, refreshDataSources);
