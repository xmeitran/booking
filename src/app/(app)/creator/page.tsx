import { redirect } from 'next/navigation';
import { parseHandle } from '@/lib/listing';
import { requireUser } from '@/lib/session';

// Ô "Tra một creator" ở tab Dữ liệu: nhận @username hoặc link TikTok, mở trang hiệu quả của creator.
export default async function FindCreator({ searchParams }: { searchParams: Promise<{ h?: string }> }) {
  await requireUser();
  const h = parseHandle((await searchParams).h ?? '');
  redirect(h ? `/creator/${h}` : '/data?notfound=1');
}
