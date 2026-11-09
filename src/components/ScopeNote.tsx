import type { Scope } from '@/lib/scope';

/** Nhắc người bị giới hạn phạm vi (Phân quyền → "Xem dữ liệu mọi brand" tắt) rằng danh sách chỉ gồm brand được giao. */
export function ScopeNote({ scope, className = 'mt-1' }: { scope: Scope; className?: string }) {
  if (!scope) return null;
  return (
    <p className={`${className} text-xs text-warning`}>
      {scope.brandIds.length
        ? `Đang xem ${scope.brandIds.length} brand bạn được giao và việc bạn phụ trách.`
        : 'Bạn chưa được giao brand nào nên chỉ thấy việc mình phụ trách. Nhờ Leader / Admin giao brand ở Phân quyền → Phân công.'}
    </p>
  );
}
