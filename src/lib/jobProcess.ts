// Job nặng (gộp kho dữ liệu) chạy trong tiến trình con: chạy trong next-server thì Prisma + buffer giữ lại ~1–2 GB RAM sau khi
// xong (đo trên server DX 26/11/2026); tiến trình con thoát là trả hết. Tiến trình con kế thừa env (heap tối đa 1 GB).
import { execFile } from 'node:child_process';

export type JobName = 'data-sources' | 'sync-creators';

/** Chạy src/jobs/run.ts <name>, trả dòng kết quả cuối; lỗi thì ném 3 dòng cuối stderr. */
export const runInChild = (name: JobName) =>
  new Promise<string>((resolve, reject) =>
    execFile('node_modules/.bin/tsx', ['src/jobs/run.ts', name], { cwd: process.cwd(), timeout: 30 * 60_000, maxBuffer: 10 << 20 }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim().split('\n').slice(-3).join(' ').slice(0, 500))) : resolve(stdout.trim().split('\n').pop() ?? '')));
