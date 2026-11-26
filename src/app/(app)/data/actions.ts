'use server';
import { after } from 'next/server';
import { runOnce } from '@/lib/cronJob';
import { runInChild } from '@/lib/jobProcess';
import { requireUser } from '@/lib/auth/session';

// Chạy sau khi trả trang (~3 phút, trong tiến trình con); runOnce chặn bấm dồn trong 5 phút.
export async function refreshData() {
  await requireUser();
  after(() => runOnce('data-sources', 5, () => runInChild('data-sources')));
}
