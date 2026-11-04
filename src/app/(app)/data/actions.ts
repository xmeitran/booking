'use server';
import { after } from 'next/server';
import { runOnce } from '@/lib/cronJob';
import { refreshDataSources } from '@/lib/dataSources';
import { requireUser } from '@/lib/session';

// Chạy sau khi trả trang (mất 1–2 phút); runOnce chặn bấm dồn trong 5 phút.
export async function refreshData() {
  await requireUser();
  after(() => runOnce('data-sources', 5, refreshDataSources));
}
