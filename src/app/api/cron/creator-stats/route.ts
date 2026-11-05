import { runOnce } from '@/lib/cronJob';
import { refreshCreatorStats } from '@/lib/creatorStats';

// Gọi mỗi giờ từ GitHub Actions, sau sync-bookings. Một lượt tối đa ~10 phút (gọi TikTok cách nhau 25s).
export const POST = () =>
  runOnce('creators', 30, async () => {
    const r = await refreshCreatorStats();
    return `${r.prefilled ? `${r.prefilled} mã creator lấy sẵn từ Trạm · ` : ''}${r.calls} lượt gọi · ${r.updated} KOL cập nhật · ${r.missing} không có trên Marketplace · ${r.failed} lỗi${r.stop ? ` · ${r.stop}` : ''}`;
  });
