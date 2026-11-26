import { runOnce } from '@/lib/cronJob';
import { runInChild } from '@/lib/jobProcess';

// Tổng hợp tab Dữ liệu từ kho dữ liệu UpBase. Crontab gọi mỗi giờ nhưng chỉ chạy 6 giờ một lần (~3 phút mỗi lần).
export const POST = () => runOnce('data-sources', 360, () => runInChild('data-sources'));
