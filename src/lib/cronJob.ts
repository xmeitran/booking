import { NextResponse } from 'next/server';
import { db } from './db';

/**
 * Chạy job nền gọi từ GitHub Actions. Không cần khoá bí mật: mỗi `gapMin` phút chỉ chạy được 1 lần
 * (khoá bằng một dòng SyncState), nên ai gọi bừa cũng không gây tải. Kết quả ghi vào SyncState.message.
 */
/**
 * Lượt theo lịch :00 mỗi giờ (crontab trên server gửi header x-cron-secret = CRON_SECRET) luôn chạy, kể cả khi vừa có lượt
 * bấm tay / webhook Lark; chỉ chặn chạy chồng (2 phút). Gọi không có khoá vẫn giới hạn gapMin như cũ.
 */
export const scheduledGap = (req: Request, gapMin: number) =>
  process.env.CRON_SECRET && req.headers.get('x-cron-secret') === process.env.CRON_SECRET ? 2 : gapMin;

export async function runOnce(id: string, gapMin: number, job: () => Promise<string>) {
  await db.syncState.createMany({ data: [{ id }], skipDuplicates: true });
  const ago = (min: number) => new Date(Date.now() - min * 60_000);
  const started = new Date();
  // Chạy khi: chưa từng chạy; hoặc đã quá gapMin VÀ lượt trước đã xong (không chạy chồng khi Lark automation gọi dồn);
  // hoặc lượt trước bắt đầu quá 30 phút mà chưa xong (bị ngắt giữa chừng do deploy / Render khởi động lại).
  const { count } = await db.syncState.updateMany({
    where: {
      id,
      OR: [
        { startedAt: null },
        { startedAt: { lt: ago(gapMin) }, finishedAt: { not: null } },
        { startedAt: { lt: ago(Math.max(gapMin, 30)) } },
      ],
    },
    data: { startedAt: started, finishedAt: null },
  });
  if (!count) return NextResponse.json({ skipped: `Vừa chạy hoặc đang chạy, thử lại sau ${gapMin} phút.` }, { status: 429 });

  let message: string;
  try {
    message = await job();
  } catch (e) {
    console.error(`[${id}]`, e);
    message = `Lỗi: ${e instanceof Error ? e.message : String(e)}`;
  }
  await db.syncState.updateMany({ where: { id, startedAt: started }, data: { finishedAt: new Date(), message } });
  const failed = message.startsWith('Lỗi');
  return NextResponse.json({ message: failed ? 'Lỗi, xem trạng thái đồng bộ trong app' : message }, { status: failed ? 500 : 200 });
}
