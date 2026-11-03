import { requireUser } from '@/lib/session';

// ponytail: chờ spec nghiệp vụ Booking từ người dùng.
export default async function BookingPage() {
  await requireUser();
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold">Booking</h1>
      <div className="rounded-lg border border-line bg-surface px-6 py-16 text-center text-ink-3">
        Chưa có dữ liệu. Màn này đang chờ spec nghiệp vụ Booking.
      </div>
    </>
  );
}
