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

## Tổng quan

Trang đầu sau đăng nhập (`/overview`): **Việc của bạn** (booking trễ air, air 7 ngày tới, đã air thiếu link, hẹn liên hệ KOL đến hạn,
listing chờ Brand chọn), hàng đợi cả team, KPI theo Tháng plan (booking, chi phí, đã air, Done, view / GMV 30 ngày) theo brand
và người phụ trách. "Của bạn" = tên Lark của bạn là người phụ trách hoặc có trong Booking PIC / Account PIC / Leader
(tab Booking lọc bằng `?person=`).

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

## Hồ sơ KOC (KOC 360)

`/contacts/[id]`: chỉ số TikTok 30 ngày, tỷ trọng GMV video / LIVE / thẻ sản phẩm và theo ngành, chân dung follower (giới tính, tuổi, tỉnh thành), lịch sử hợp tác với UpBase (booking trên Lark), liên hệ & nhận hàng, thanh toán (chỉ Admin / Leader). Nút "Cập nhật từ TikTok" tra ngay một KOC. Độ đầy đủ hồ sơ tính theo 5 nhóm: số TikTok, cấp KOL, liên hệ, nhận hàng, thanh toán.

- Mỗi lần tra Creator Marketplace thành công lưu một dòng `KocSnapshot` → mục "Lịch sử chỉ số" (tăng / giảm so với lần trước).
- Nhật ký chăm sóc (`KocNote`): ghi chú + ngày hẹn liên hệ lại; mọi vai trò ghi được. Danh bạ có lọc nhanh "Đến hẹn liên hệ",
  "Chưa có PIC", "Chưa có số TikTok", "Thiếu liên hệ / địa chỉ / thanh toán" kèm số đếm, lọc theo cấp KOL (nhập tay, trống thì theo booking).

## Listing

Thay file "Excel Listing" theo sheet *[Booking] - Requirement Excel Listing (UpAI)*:
- Đợt listing (Brand · Store · Sản phẩm · Tháng, CR và AOV sản phẩm theo gian hàng). Dán nhiều ID kênh / link TikTok một lần; kênh chưa có trong Danh bạ được tạo và tra TikTok.
- Tự điền: cấp KOL (theo booking gần nhất hoặc hồ sơ), giá đã hợp tác gần nhất cùng hình thức, phí kèm TNCN (= giá / 0,9, kế toán chưa chốt), số món, GPM, AOV, tỷ trọng GMV, chân dung khán giả, View Target, GMV Target, CTR, CPV.
- GMV Target = View Target × CTR × CR × AOV với CTR = (GPM/1000)/(CR × AOV), tức = View Target × GPM / 1000. View Target KL1–KL5 = view TB video bán hàng 30 ngày; KL6–KL7 nhập tay (API không có video không gắn giỏ).
- GPM TikTok trả bằng USD, quy đổi theo `USD_VND` (mặc định 26.000).
- Xuất CSV theo thứ tự cột tab "Excel Listing _ Final": bản cho Brand bỏ email, Zalo, nhận hàng, ngân hàng, CCCD; ngân hàng / CCCD chỉ Admin, Leader xuất được.

- Hai chế độ xem: Tóm tắt và **Bảng Excel** (đủ cột như file "Excel Listing _ Final", bật / tắt theo nhóm cột). Trong bảng sửa nhanh
  giá, trạng thái, đề xuất, Brand chọn, lý do, content note, ngày air, View Target ngay tại ô. Lọc theo Brand chọn / đề xuất, xếp theo phí, GMV Target, CPV…
- **Brand duyệt online**: nút Tạo link sinh `/review/<token>`; Brand mở không cần đăng nhập, chọn Yes / No / Cân nhắc + lý do.
  Trang này không có SĐT, địa chỉ, ngân hàng, CCCD; thu hồi link là hết hiệu lực ngay.

## Creator matching

`/matching`: B2C soạn **best practice theo ngành hàng** (ghi chú + bộ tiêu chí). Mỗi **brief brand** chép tiêu chí từ best practice
của ngành, thêm Brand guideline, Content strategy, Content plan (dán link tài liệu được). Bộ tiêu chí: tệp kênh, cấp KOL, follower,
view TB, số món bán, GPM, giá booking gần nhất, % follower nữ, % 18–34 tuổi, tỷ trọng GMV ngành hàng TikTok, đã / chưa hợp tác.
KOC trượt tiêu chí bị loại; thiếu số liệu thì "chưa rõ", xếp sau (`src/lib/matching.ts`). Tick KOC → thêm vào đợt listing có sẵn
hoặc đợt mới; tải Excel toàn bộ KOC khớp. Danh bạ cũng có nút Tải Excel theo bộ lọc.

## Kiểm soát nhập liệu

- Form KOC kiểm SĐT Việt Nam, CCCD / CMND / MST, số tài khoản, ID kênh TikTok (`src/lib/validate.ts`).
- Tab Dữ liệu liệt kê booking Lark gần đây nhập sai / thiếu: ID kênh TikTok sai định dạng, thiếu ID kênh, chi phí, tháng plan,
  người phụ trách, nghi trùng (cùng kênh + brand + tháng) (`src/lib/dataQuality.ts`).
- Listing gắn cờ **Trùng** khi KOC đã ở đợt listing khác cùng tháng hoặc đã book cùng brand tháng này / tháng trước.

## Dữ liệu

Tab `/data` cho biết mỗi nguồn có bao nhiêu creator, bao nhiêu KOL Danh bạ có mặt, và hiệu quả (GMV, đơn, lượt xem…) của họ:
Lark Base (bảng 3.2), TikTok Partner Center (Đơn MCN, phiên live MCN, Đơn TAP, creator nhận TAP, hồ sơ creator MCN) và
TikTok Seller Center (creator hợp tác với shop, đơn affiliate, video, LIVE, yêu cầu mẫu, Creator Marketplace do Booking Hub tự tra).
Bảng TikTok đọc qua `POST /api/explore` của Trạm dữ liệu (`src/lib/dataSources.ts`). Bảng lớn mất ~10 giây nên job
`/api/cron/data-sources` (workflow mỗi giờ, chạy 6 giờ một lần, ~2 phút) lưu phần tổng vào `SyncState.data` và số của từng KOL
vào bảng `CreatorMetric`; hồ sơ KOC đọc bảng này cho mục "Hiệu quả theo nguồn TikTok". Nút Làm mới chạy job ngay.
Mỗi nguồn tách được theo **shop / brand**: bảng Seller theo 8 shop, Đơn MCN theo shop của đơn, Đơn TAP theo sản phẩm, Lark theo brand.
Trang từng nguồn có cột "Shop đã bán / hợp tác" cho từng creator, chế độ xem "Theo shop" (mỗi shop bao nhiêu creator, hiệu quả),
và lọc theo một shop. Job lưu tối đa 20 shop lớn nhất mỗi KOL vào `CreatorMetric.shops`; hồ sơ KOC hiện 5 shop đầu mỗi nguồn.
Job cũng **kéo sẵn** bảng xếp hạng vào `SourceCache` (top 200 creator theo từng chỉ số, bảng theo shop, top creator của từng shop
seller) nên trang từng nguồn chỉ đọc DB (< 1 giây). Chỉ khi lọc một shop của Đơn MCN / một sản phẩm TAP (hàng nghìn giá trị) mới
hỏi Trạm lúc mở. Một lượt job ~10 phút.
