# Booking Hub

Tách từ `upbaseoperation-droid/b2c`, viết lại từ đầu: đăng nhập Lark, tab User (phân quyền), Danh bạ KOC. Tab Booking đang chờ spec.

Next.js 16 · Prisma · Postgres (Supabase).

## Chạy local

```bash
cp .env.example .env        # điền DATABASE_URL, AUTH_SECRET, LARK_*
npm install
npm run db:push             # tạo bảng
npm run dev
```

Postgres local nhanh: `docker run -d --name booking-hub-db -e POSTGRES_USER=booking -e POSTGRES_PASSWORD=booking -e POSTGRES_DB=booking_hub -p 127.0.0.1:5441:5432 postgres:17-alpine`

## Cấu hình Lark

1. Lark Developer Console → app → **Security settings → Redirect URLs**: thêm `http://localhost:3000/api/auth/lark/callback` và `https://<domain>/api/auth/lark/callback`.
2. **Permissions & Scopes**, rồi tạo và phát hành phiên bản mới:
   - `contact:user.employee_id:readonly`: lấy User ID (HN001...). Thiếu quyền này Lark chỉ trả Open ID (`ou_...`) và user được thêm bằng User ID sẽ không đăng nhập được.
   - `contact:contact.base:readonly`, `contact:user.base:readonly`, `contact:user.email:readonly`, `contact:user.department:readonly`, `contact:department.base:readonly`: để tab User lấy tên, avatar, email, phòng ban, chức danh (nút **Đồng bộ Lark**).
   - Phạm vi dữ liệu danh bạ (contacts range) của app phải bao gồm các phòng ban cần dùng.
3. Điền `LARK_APP_ID`, `LARK_APP_SECRET` vào `.env`.

## Admin đầu tiên

Đặt `ADMIN_LARK_IDS=<lark user id của bạn>` trong `.env`. Lần đăng nhập đầu, ID này được tạo thành Admin. Sau đó Admin thêm người khác ở tab User.

Người chưa được thêm bấm đăng nhập sẽ thấy Lark User ID của mình trên trang login để gửi Admin.

## Vai trò

| | Booking | Danh bạ KOC | User |
|---|---|---|---|
| Admin | toàn quyền | thêm / sửa / xóa | quản lý |
| Leader | sửa mọi booking | thêm / sửa / xóa | — |
| Nhân viên | sửa booking mình phụ trách | xem | — |

Khóa user hoặc đổi vai trò có hiệu lực ngay ở request kế tiếp (phiên chỉ lưu id, quyền đọc lại từ DB).
