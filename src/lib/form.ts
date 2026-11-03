import { Prisma } from '@prisma/client';

export const str = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();

/** '' → null; số nguyên ≥ 0 → number; còn lại → NaN để báo lỗi. */
export function optInt(fd: FormData, key: string): number | null {
  const s = str(fd, key).replace(/[.,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

export const isUniqueError = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
