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
   - `contact:contact.base:readonly`, `contact:user.base:readonly`, `contact:user.email:readonly`, `contact:user.department:readonly`, `contact:department.base:readonly`: để tab User tự lấy tên, avatar, email, phòng ban, chức danh khi Admin thêm user (và cập nhật lại mỗi lần người đó đăng nhập).
   - Phạm vi dữ liệu danh bạ đi theo **Availability** của app: khi tạo phiên bản, chọn All members (hoặc các phòng ban cần dùng), nếu không Lark chỉ trả dữ liệu của người tạo app.
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

## Đồng bộ booking từ Lark Base

- Nguồn: base **B2C_Quản lý Booking**, bảng **3.2 List duyệt book** (`W6vRbbuOVar3qtsV18dlan1xgXb` / `tbluWrjJd9Pt9uzb`). App Lark "Booking" phải được thêm vào base (… > Add application) và có quyền đọc Base.
- `POST /api/cron/sync-bookings` đọc lướt cả bảng (~1,5 phút), chỉ ghi bản ghi mới / vừa sửa, xoá bản ghi đã xoá trên Lark. 10 phút chỉ chạy được 1 lần.
- Lịch mỗi giờ: `.github/workflows/sync-bookings.yml` (GitHub Actions). Repo public không có commit trong 60 ngày thì GitHub tắt lịch, vào tab Actions bật lại.
- Kênh mới trong booking được tự thêm vào Danh bạ KOC (TikTok). KOL đã có thì không ghi đè.
- Tab Booking chỉ đọc; sửa dữ liệu trên Lark.

## Chỉ số KOL từ TikTok Shop

- Follower, lượt xem TB / video và / LIVE bán hàng, số món bán, GMV, GPM (30 ngày) từ TikTok Shop Creator Marketplace (`/affiliate_seller/202608/marketplace_creators/search` + `/202508/marketplace_creators/{open_id}`).
- Gọi qua **Trạm dữ liệu TikTok** (`Data-tiktok`, https://mcn.mindtheoperation.com, `POST /api/console`) bằng token shop VN nó đang giữ. Booking Hub không giữ token TikTok: làm mới token ở 2 nơi sẽ làm token bên kia mất hiệu lực. Cần `DATA_TIKTOK_URL`, `DATA_TIKTOK_USER`, `DATA_TIKTOK_PASSWORD`.
- `POST /api/cron/creator-stats` mỗi giờ (sau đồng bộ booking), tối đa ~10 phút: tra `creator_open_id` cho KOL chưa tra (ưu tiên KOL có booking gần đây), cập nhật chỉ số KOL cũ quá 7 ngày. KOL không có trên Marketplace thì 30 ngày tra lại.
- Hạn mức tần suất tính chung với Trạm dữ liệu: gọi cách nhau 25s, bị chặn thì chờ 60s thử lại.
- TikTok chỉ trả GMV dạng khoảng cho creator VN (vd "1M₫+"); GPM tính bằng USD.
