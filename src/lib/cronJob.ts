import { NextResponse } from 'next/server';
import { db } from './db';

/**
 * Chạy job nền gọi từ GitHub Actions. Không cần khoá bí mật: mỗi `gapMin` phút chỉ chạy được 1 lần
 * (khoá bằng một dòng SyncState), nên ai gọi bừa cũng không gây tải. Kết quả ghi vào SyncState.message.
 */
export async function runOnce(id: string, gapMin: number, job: () => Promise<string>) {
  await db.syncState.createMany({ data: [{ id }], skipDuplicates: true });
  const { count } = await db.syncState.updateMany({
    where: { id, OR: [{ startedAt: null }, { startedAt: { lt: new Date(Date.now() - gapMin * 60_000) } }] },
    data: { startedAt: new Date(), finishedAt: null },
  });
  if (!count) return NextResponse.json({ skipped: `Vừa chạy hoặc đang chạy, thử lại sau ${gapMin} phút.` }, { status: 429 });

  let message: string;
  try {
    message = await job();
  } catch (e) {
    console.error(`[${id}]`, e);
    message = `Lỗi: ${e instanceof Error ? e.message : String(e)}`;
  }
  await db.syncState.update({ where: { id }, data: { finishedAt: new Date(), message } });
  return NextResponse.json({ message }, { status: message.startsWith('Lỗi') ? 500 : 200 });
}
