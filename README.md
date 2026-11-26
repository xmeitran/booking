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

## Chỉ số KOL từ kho dữ liệu

- Follower, lượt xem TB / video và / LIVE bán hàng, số món bán, GMV, GPM, chân dung follower (30 ngày, toàn sàn) lấy từ kho dữ liệu
  UpBase (bảng kol-connector, xem mục "Kho dữ liệu"). Job `sync-creators` mỗi sáng ghi số vào hồ sơ KOC Danh bạ cùng handle
  (`Koc.followers`, `avgViews`, `avgLiveViews`, `unitsSold`, `gpmUsd`, `ttsProfile` dạng `{ source: 'warehouse', … }`); KOL không có
  trong kho giữ số cũ. Listing, xuất Excel, trang review cho brand, AI brief đọc các cột này.
- Trước 26/11/2026 số này do Trạm dữ liệu TikTok (Data-tiktok) tra Creator Marketplace; đã bỏ hẳn, Booking Hub không gọi Data-tiktok nữa.
- Trang creator có "Chỉ số chính" (follower, view TB, số món bán và GMV 30 ngày toàn sàn, GMV bán cho shop UpBase, GMV video, booking)
  ghi rõ nguồn; creator ngoài Danh bạ có nút "Thêm vào Danh bạ" (chép luôn số kho).
- Creator ẩn GMV: GMV lấy giữa khoảng TikTok trả, `gmvRange` ghi "~N tr ₫". GPM trong kho là VND, lưu vào `gpmUsd` theo `USD_VND`.

## Hồ sơ KOC (KOC 360)

`/contacts/[id]`: chỉ số TikTok 30 ngày, tỷ trọng GMV video / LIVE / thẻ sản phẩm và theo ngành, chân dung follower (giới tính, tuổi, tỉnh thành), lịch sử hợp tác với UpBase (booking trên Lark), liên hệ & nhận hàng, thanh toán (chỉ Admin / Leader). Độ đầy đủ hồ sơ tính theo 5 nhóm: số TikTok, cấp KOL, liên hệ, nhận hàng, thanh toán.

- Mỗi lượt đồng bộ kho mà follower / view / số món bán đổi thì lưu một dòng `KocSnapshot` → mục "Lịch sử chỉ số" (tăng / giảm so với lần trước).
- Nhật ký chăm sóc (`KocNote`): ghi chú + ngày hẹn liên hệ lại; mọi vai trò ghi được. Danh bạ có lọc nhanh "Đến hẹn liên hệ",
  "Chưa có PIC", "Chưa có số TikTok", "Thiếu liên hệ / địa chỉ / thanh toán" kèm số đếm, lọc theo cấp KOL (nhập tay, trống thì theo booking).

## Listing

Thay file "Excel Listing" theo sheet *[Booking] - Requirement Excel Listing (UpAI)*:
- Đợt listing (Brand · Store · Sản phẩm · Tháng, CR và AOV sản phẩm theo gian hàng). Dán nhiều ID kênh / link TikTok một lần; kênh chưa có trong Danh bạ được tạo (số kho vào ở lượt đồng bộ sáng hôm sau).
- Tự điền: cấp KOL (theo booking gần nhất hoặc hồ sơ), giá đã hợp tác gần nhất cùng hình thức, phí kèm TNCN (= giá / 0,9, kế toán chưa chốt), số món, GPM, AOV, tỷ trọng GMV, chân dung khán giả, View Target, GMV Target, CTR, CPV.
- GMV Target = View Target × CTR × CR × AOV với CTR = (GPM/1000)/(CR × AOV), tức = View Target × GPM / 1000. View Target KL1–KL5 = view TB video bán hàng 30 ngày; KL6–KL7 nhập tay (API không có video không gắn giỏ).
- GPM lưu bằng USD (`gpmUsd`), quy đổi theo `USD_VND` (mặc định 26.000); kho trả VND nên job chia lại khi ghi.
- Xuất CSV theo thứ tự cột tab "Excel Listing _ Final": bản cho Brand bỏ email, Zalo, nhận hàng, ngân hàng, CCCD; ngân hàng / CCCD chỉ Admin, Leader xuất được.

- Hai chế độ xem: Tóm tắt và **Bảng Excel** (đủ cột như file "Excel Listing _ Final", bật / tắt theo nhóm cột). Trong bảng sửa nhanh
  giá, trạng thái, đề xuất, Brand chọn, lý do, content note, ngày air, View Target ngay tại ô. Lọc theo Brand chọn / đề xuất, xếp theo phí, GMV Target, CPV…
- **Brand duyệt online**: nút Tạo link sinh `/review/<token>`; Brand mở không cần đăng nhập, chọn Yes / No / Cân nhắc + lý do.
  Trang này không có SĐT, địa chỉ, ngân hàng, CCCD; thu hồi link là hết hiệu lực ngay.

## Trang hiệu quả creator

`/creator/<username>` (bấm creator ở bất kỳ bảng nào trong tab Dữ liệu, nút "Hiệu quả ở mọi nguồn" trong hồ sơ KOC, hoặc ô
"Tra creator"): creator có mặt ở bảng nào (Lark, 3 bảng shop UpBase trong kho, hồ sơ creator trong kho), số mỗi bảng kèm cách tính,
theo shop / brand, booking với UpBase. Mỗi bảng ghi rõ dữ liệu đến từ đâu, phủ từ ngày nào, tổng hợp lúc nào, và nhãn
"Số TikTok trả về" / "Team tự điền". Job gộp mọi creator nên creator ngoài Danh bạ cũng có số, không phải hỏi kho lúc mở trang.

## Luồng booking trong app (theo tài liệu chức năng B2C-Ops)

Plan → Creator matching → Listing → Brand duyệt → Job → Nghiệm thu → Đề nghị thanh toán. Booking cũ trên Lark Base vẫn đọc ở tab
"Booking (Lark)"; job mới quản lý trong app, không ghi ngược vào Lark.

- **Danh mục** (`/catalog`): brand (USP, guideline, checklist nghiệm thu, nhân sự phụ trách), gian hàng (CR, AOV), sản phẩm,
  bảng giá theo tier. Nút "Lấy brand từ booking Lark" tạo nhanh brand + gian hàng từ cột Brand / Store. User có vai trò nghiệp vụ
  (Trưởng phòng, Booking PIC, Booking Support, Brand Manager) bên cạnh quyền trong app.
- **Plan** (`/plan`): plan tháng → dòng chi tiết (brand, sản phẩm, tuần, tier, loại content, số KOC, ngân sách, PIC; trống PIC =
  Booking PIC của brand). "Tìm KOC" tạo đợt Creator matching từ dòng (brand, SKU, tháng / tuần, tier × số KOC, ngân sách);
  tiến độ = số job, ngân sách đã chốt = tổng giá job.
- **Creator matching**: 10 bước, xem mục dưới. KOC blacklist luôn bị loại (mã BL).
- **Job** (`/jobs`): tạo từ KOC Brand chọn "Yes" ở Listing. Chặng Đã duyệt → Đã chốt → Gửi hàng → Đang quay → Đã nộp → Nghiệm thu →
  Thanh toán. Nhập link video tự chuyển "Đã nộp"; nghiệm thu theo checklist của brand (Đạt / Cần sửa / Không đạt + mốc thời gian),
  chưa đạt thì về "Đang quay" và có sẵn tin nhắn yêu cầu sửa. Brief: mẫu từ dữ liệu, hoặc **AI viết brief** (Claude, cần
  `ANTHROPIC_API_KEY`; chỉ gửi thông tin công khai). Mọi thay đổi ghi `AuditLog`.
- **Thanh toán** (`/payments`): gom job nghiệm thu Đạt thành ĐNTT, tải file cho kế toán, theo dõi trạng thái. Chưa đẩy sang Lark
  Approval (cần approval code).

## Creator matching

Theo "Tổng hợp tiêu chí chuẩn hóa – AI Creator Matching (v0.1)" (Lark docx `C6NNdKVzdol43txs9Xylw5bKg4d`). Đặc tả (mã K, tiêu chí,
bậc điểm, trọng số, mức kết luận) ở `src/lib/matching/spec.ts`; cách tính ở `engine.ts` (hàm thuần, có test); nạp dữ liệu `data.ts`;
chạy / chấm lại `run.ts`. Mỗi đợt (`MatchBrief`) giữ ứng viên ở `MatchCandidate` (handle + nền tảng, có cả creator chưa có ở Danh bạ).

- **Đầu vào**: Khối 1 (hồ sơ brand: ngành, ngành con, tập đoàn, TA, tone, RTB / claim cấm, đối thủ) và Khối 3 (ngưỡng KL1–KL7 Must /
  Nice, ngưỡng ngành, cửa sổ chống trùng / scandal / đối thủ, ads code, ngoại lệ, nhóm 0) khai ở Danh mục → brand; Khối 2 (mã SP, TA,
  ngưỡng % nữ / 18–34 / khu vực, tệp kênh ưu tiên, trường hợp loại, từ cấm, PIC duyệt) ở sản phẩm; Khối 4 (SKU, giá deal, mục tiêu,
  GMV Max, kênh, số KOC theo KL, ngân sách, trần fee, tháng / tuần air, format, KOC chỉ định / cấm, mục tiêu GMV) ở đợt.
- **Bước 2–3** ("Chạy matching"): pool = Danh bạ trên nền tảng của kênh + creator trong kho (lọc ngành, follower tối thiểu, tối đa
  3.000 theo GMV). Loại tự động: BL, I-36, đánh giá "Không phù hợp" brand, K6, K7, K9 (Must loại, Nice cảnh báo), K10, K13, K15,
  nhóm 0 Bắt buộc. Thiếu số liệu không loại. Chạy lại giữ nguyên mọi thao tác của Booker. Ngoại lệ: người có quyền "Duyệt list KOC"
  hoặc người duyệt ngoại lệ của brand.
- **Bước 4**: kho chưa có lời thoại / hình video nên K1, K2, K3 (khi brand bật), K4, K5, K8, K11 do Booker đánh dấu; app gợi ý từ cấm /
  tên đối thủ trong tiêu đề video nổi bật.
- **Bước 5, 7**: chấm 6 nhóm (0, A–E) 1–5 theo bậc của doc (khoảng giữa 2 mốc = 2 / 4), tổng = Σ điểm/5 × trọng số kênh, **quy về 100
  trên phần có số liệu**; độ phủ < 50% thì "Chưa đủ dữ liệu". Nhóm D, tone, độ ổn định view, phần lớn nhóm 0 do Booker chấm tay
  (đè được điểm tự động). Benchmark GMV/video, view, CPV theo KL lấy từ booking Lark đã air 2 tháng (ít mẫu thì 6 tháng).
- **Bước 6**: giá KOC báo, ads code, cam kết đối thủ, chứng chỉ → K8 / K12 / K14. Creator chỉ có trong kho được tạo hồ sơ Danh bạ khi vào
  shortlist. **Bước 8**: quyền "Duyệt list KOC"; kiểm tra số KOC theo KL, ngân sách, trần fee, GMV dự báo. **Bước 9**: Excel (không có K15)
  và đưa sang Listing (giá, đề xuất Must Have / Recommend / Optional theo mức). **Bước 10**: GMV / view 30 ngày từ booking Lark, job; ghi
  KPI, đúng hạn, lỗi M1–M3, quyết định (Vào core → nhãn "KOC core"; Dừng → đánh giá Không phù hợp brand) và rating sao → nuôi K15, C, E.
- **Không bước nào bỏ KOC khỏi danh sách**: mỗi bước hiện đủ mọi KOC của đợt, xếp theo trạng thái (B2C đã duyệt → Đã báo giá →
  Shortlist → Trong pool → Đã loại → Bị loại tự động → Ngoài pool) rồi theo điểm; KOC qua bước đó nằm trên vạch, còn lại mờ đi kèm lý do.
  KOC không khớp ngành / KL cần book ở trạng thái "Ngoài pool" (không xoá); "Excel tất cả KOC" xuất đủ danh sách.
- Hồ sơ KOC có mục "Lịch sử Creator matching" (đợt, trạng thái, mã loại).

### Kho dữ liệu (ClickHouse qua Metabase)

`POST /api/cron/sync-creators` (mỗi ngày, sau kol-connector 01:00) đọc `upbase_prod.connector_creator_public_creator_channel`,
`_performance_latest`, `_categories`, `_top_content`, `connector_creator_public_categories` (FINAL, bỏ dòng xoá) vào `WarehouseCreator`.
ClickHouse chỉ mở trong VPN nên app chạy SQL qua Metabase của DX (`/api/dataset/json`, đọc theo luồng, ~62 nghìn creator, ~10 giây).
Cấu hình ở Phân quyền → Tích hợp → Kho dữ liệu (`METABASE_URL`, `METABASE_USER`, `METABASE_PASSWORD`, `METABASE_DATABASE_ID` mặc định 2);
chưa cấu hình thì job bỏ qua và matching dùng số TikTok Shop đã lưu ở Danh bạ. Lượt nào trả về ít hơn một nửa lần trước thì giữ creator cũ.
Đơn vị (kiểm tra 2026-11-26): ER là % dạng chuỗi, % nữ và tuổi là %; tuổi toàn 0 nghĩa là chưa có chân dung follower (~80% creator).

## Kiểm soát nhập liệu

- Form KOC kiểm SĐT Việt Nam, CCCD / CMND / MST, số tài khoản, ID kênh TikTok (`src/lib/validate.ts`).
- Tab Dữ liệu liệt kê booking Lark gần đây nhập sai / thiếu: ID kênh TikTok sai định dạng, thiếu ID kênh, chi phí, tháng plan,
  người phụ trách, nghi trùng (cùng kênh + brand + tháng) (`src/lib/koc/dataQuality.ts`).
- Listing gắn cờ **Trùng** khi KOC đã ở đợt listing khác cùng tháng hoặc đã book cùng brand tháng này / tháng trước.

## Dữ liệu

Tab `/data` cho biết mỗi nguồn có bao nhiêu creator, bao nhiêu KOL Danh bạ có mặt, và hiệu quả (GMV, đơn, lượt xem…) của họ:
- **Lark Base** (bảng 3.2, team điền).
- **Kho dữ liệu UpBase**, bảng TikTok Seller Center của các shop UpBase quản lý (`src/lib/koc/dataSources.ts`, tên shop / brand từ `dbt_prod.ecom_dim_store`):
  Đơn affiliate của shop (`report_public_tiktok_affiliate_order`, ~2,6 triệu đơn từ 10/2025), Video gắn sản phẩm shop
  (`report_public_tiktok_video_performance`, creator affiliate, từ 5/2026), Phiên LIVE (`report_public_report_live_koc_daily`, LIVE affiliate TikTok).
- **Hồ sơ creator TikTok** (`WarehouseCreator`, ~62 nghìn creator, 30 ngày toàn sàn).

Bảng video ~42 triệu dòng (~30 giây một lượt gộp) nên job `/api/cron/data-sources` (crontab server :20 mỗi giờ, app chạy 6 giờ một lần,
~2 phút; nút "Làm mới số kho" chạy ngay) gộp mỗi creator × shop một dòng qua Metabase, lưu **mọi creator** vào `CreatorMetric`
(m theo thứ tự chỉ số, `shops` = 20 shop lớn nhất), phần tổng vào `SyncState.data`, danh sách shop và top 200 creator từng shop vào
`SourceCache`. Trang tab Dữ liệu, trang creator, hồ sơ KOC chỉ đọc DB. Metabase cắt kết quả ở 1.048.575 dòng: vượt thì job báo lỗi.
Không còn trong kho (đã bỏ cùng Data-tiktok): Đơn MCN (CAP) toàn sàn, Đơn / creator chiến dịch TAP, yêu cầu hàng mẫu, dữ liệu gốc từng dòng.

## Tích hợp theo tài liệu giải pháp B2C-Ops Phase 1

Cấu hình và checklist thứ còn thiếu: **Phân quyền → Tích hợp** (`/users/integrations`, chỉ Admin). Giá trị đọc từ `.env` trước, không có
thì đọc bản Admin nhập trên trang (lưu trong DB, không mã hoá: khoá bí mật nên đặt ở `.env` trên server). Danh sách khoá ở
`src/lib/integrations.ts`. Tích hợp chưa đủ cấu hình thì phần giao diện của nó không hiện trong app.
UpAffiliate / UpS (U1, U2, U5) đã đóng vì chưa có API: app không gọi, không hiện số liệu UpAffiliate, không đoán dạng dữ liệu.
Hợp đồng (U3, U4: HĐNT, WeSign) và Cloudflare R2 cũng đóng, để nâng cấp sau; HĐNT vẫn nhập tay trong hồ sơ pháp lý.

| Mã | Chức năng | Ở đâu trong app | Code |
|---|---|---|---|
| G1, G2 | Đẩy listing sang Google Sheet của brand, lấy kết quả duyệt về. Đẩy lại không làm mất lựa chọn brand đã điền | Trang đợt listing | `src/lib/google.ts`, `listing/actions.ts` |
| L6 | Gửi mail mời hợp tác (SMTP) cho KOC có email, chưa được mời | Trang đợt listing | `src/lib/mail.ts` |
| L4, L5 | Gửi ĐNTT sang Lark Approval, đọc lại Duyệt / Từ chối | Trang ĐNTT | `src/lib/lark/approval.ts` |
| — | Kiểm tra tự động link nộp: link sống, đúng kênh, từ khoá / hashtag bắt buộc của brand (Danh mục) | Trang job, mục Nghiệm thu | `src/lib/linkCheck.ts` |

Chưa làm (ghi ở từng mục "Cần bổ sung thêm" trên tab Tích hợp): ghi ngược view 3.2 / bảng 6.1 (L3), trạng thái đã thanh toán từ Kế toán,
phụ lục SOW / BBNT, mọi phần UpAffiliate (hồ sơ KOC, số liệu video / ads, thông tin nghiệm thu), Zalo, Kalodata.
