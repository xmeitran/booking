# Spec: Trang hồ sơ 1 KOC (`/contacts/[id]`)

Trạng thái: **bản nháp chờ duyệt** · 10/11/2026 · số liệu độ phủ đo trên DB production (bản chuyển sang server DX ngày 10/11).

## 1. Mục tiêu

Một trang đủ để team Booking B2C **quyết định và làm việc với một KOC** mà không phải mở Lark, sheet hay TikTok:

| # | Câu hỏi nghiệp vụ | Bước trong luồng booking | Ai dùng |
|---|---|---|---|
| Q1 | Có nên book KOC này cho brand X không? (hợp tệp, hiệu quả, giá, rủi ro) | Plan → chọn KOC → Listing | Booking PIC, Leader |
| Q2 | Liên hệ ai, gửi mẫu tới đâu? | Booking → gửi hàng | Booking PIC |
| Q3 | Đủ hồ sơ để ký hợp đồng và thanh toán chưa? | Hợp đồng → ĐNTT | Booking PIC, Leader, kế toán |
| Q4 | Đã hợp tác ra sao, có vấn đề gì? | Nghiệm thu → Report | Leader, Booking PIC |
| Q5 | Đang chạy booking nào với KOC này? | Theo dõi job | Booking PIC |

Mục tiêu đo được: trả lời Q1–Q5 trong **dưới 30 giây** trên một trang, mọi số đều ghi nguồn và thời điểm cập nhật.

### Giả định (cần xác nhận)
1. Bố cục theo bản chốt b2c (`web-admin/src/components/koc/KocProfile.tsx`): đầu hồ sơ → dải thông tin nhanh → 4 tab (Lịch sử hợp tác · Hồ sơ pháp lý · Chỉ số kênh · Booking đang chạy) → cột phải (Pháp lý & thanh toán · Liên hệ & nhận mẫu · Đánh giá kênh · Đầu mối vận hành). Không dùng dữ liệu của b2c.
2. Nguồn sự thật: **Lark Base** (booking, CCCD / số TK, PIC, số team điền), **TikTok** qua Trạm dữ liệu (chỉ số kênh, đơn / video / LIVE của shop UpBase, MCN / TAP), **Booking Hub** (job, listing, hồ sơ pháp lý, đánh giá, ghi chú).
3. Brand không xem trang này. Phạm vi dữ liệu theo phân quyền hiện có: danh bạ xem chung; số CCCD / số TK chỉ đủ khi có quyền `koc.bank`; job chỉ hiện theo phạm vi brand.
4. Giữ các khối riêng của Booking Hub đang dùng (hiệu quả theo nguồn TikTok, nhật ký chăm sóc + hẹn liên hệ, gộp KOC trùng, blacklist / tag), xếp vào tab phù hợp.

## 2. Bố cục và khối

| Khối | Trả lời | Nội dung |
|---|---|---|
| Đầu hồ sơ | Q1 | Avatar, tên kênh, tên thật (hồ sơ pháp lý mặc định, cá nhân), nhãn: Đã hợp tác · N đợt / KOC mới, Sẵn sàng booking (KOC mới), Thiếu giấy tờ, Trùng kênh, Blacklist, đánh giá theo brand (tối đa 3); dòng kênh: @handle, TikTok phụ, kênh khác, tệp kênh · ngành hàng · khung lương; "N hồ sơ pháp lý · N kênh kết nối · Chung chủ / MCN với N kênh". Nút: **Tạo booking (đẩy vào Listing)** (chính), Đánh giá kênh, Chỉnh sửa KOC (mở tại trang), Cập nhật chỉ số. Điều hướng KOC trước / sau theo bộ lọc Danh bạ đang xem |
| Dải thông tin nhanh | Q1 | 5 ô: Follower, Đơn giá, GMV kênh 30 ngày, PIC chính, Book gần nhất (mục 3.1) |
| Tab Lịch sử hợp tác | Q4 | Tóm tắt (số đợt, chi phí, brand, CPV, ROI, đúng hạn, đánh giá) + bảng từng đợt (booking Lark + job app) lọc theo brand / hình thức / năm |
| Tab Hồ sơ pháp lý | Q3 | Đã có (1 KOC → N pháp nhân, HĐNT) |
| Tab Chỉ số kênh | Q1 | Chỉ số TikTok 30 ngày, chân dung follower, cơ cấu GMV, ngành hàng, lịch sử chỉ số, hiệu quả theo nguồn TikTok (Trạm) |
| Tab Booking đang chạy | Q5 | Booking Lark chưa xong + job app chưa thanh toán, kèm hạn và trạng thái |
| Cột phải: Pháp lý & thanh toán | Q3 | Đủ để ký HĐ chưa (thiếu trường nào), loại hồ sơ mặc định, tài khoản nhận tiền (che số), chế độ thuế, HĐNT |
| Cột phải: Liên hệ & nhận mẫu | Q2 | SĐT, Zalo, email, khu vực, người nhận, SĐT nhận, địa chỉ, ghi chú giao hàng; nhật ký chăm sóc + hẹn liên hệ |
| Cột phải: Đánh giá kênh | Q1, Q4 | Kết luận mới nhất theo brand, số lượt Phù hợp / Không phù hợp, lý do hay gặp |
| Cột phải: Đầu mối vận hành | Q4 | PIC từng làm, Media / Growth / Account PIC gần nhất |

## 3. Metric

Độ phủ: tỷ lệ bản ghi có số (KOC: trên 3.163 KOC; booking: trên 18.585 booking Lark).

### 3.1 Dải thông tin nhanh

| Metric | Định nghĩa | Nguồn | Cập nhật | Độ phủ hiện tại |
|---|---|---|---|---|
| Follower | `follower_count` lúc tra | TikTok Creator Marketplace (`Koc.followers`) | KOL tra lại khi số cũ hơn 7 ngày | **343 KOC (10,8%)** |
| View TB / video bán hàng | `avg_ec_video_play_count` 30 ngày | TikTok (`Koc.avgViews`) | như trên | 343 (10,8%) |
| Đơn giá | Giá tham khảo nhập tay; trống thì chi phí booking video gần nhất (chi phí > 0); phụ: biên độ thấp nhất – cao nhất | `Koc.rateCard`; Lark `Chi phí`, `Giá book cao/thấp nhất` | mỗi giờ | giá nhập tay **0%**; booking có chi phí 71% |
| GMV kênh 30 ngày | GMV cả kênh trên TikTok Shop (không riêng UpBase); số chính xác nếu TikTok trả, không thì khoảng | TikTok `gmv` / `gmv_range` | 7 ngày | khoảng 343, số chính xác 139 |
| PIC chính | PIC trong Booking Hub; trống thì Booking PIC đầu tiên của booking gần nhất | `Koc.pic`; Lark `Booking PIC` | mỗi giờ | PIC trong app **0%**; booking có PIC 66% |
| Book gần nhất | Ngày air (hoặc dự kiến air) mới nhất + brand + mã BO | Lark | mỗi giờ | có ngày air 44%, ngày dự kiến 30% |

### 3.2 Lịch sử hợp tác

| Metric | Định nghĩa | Nguồn | Độ phủ |
|---|---|---|---|
| Số đợt | Số booking Lark của kênh (+ job app chưa có trên Lark) | Lark, Job | 100% |
| Tổng chi phí | Σ chi phí booking | Lark | 71% booking có chi phí |
| Paid / FOC | Booking chi phí > 0 / = 0 | Lark | như trên |
| View 30 ngày / video | Số team điền 30 ngày sau air (ưu tiên số "(Chốt)") | Lark `🌸 Views 30 ngày`, `(Chốt) Views 30 ngày` | **23%** (Done / Làm ĐNTT: 52%) |
| GMV 30 ngày / video | như trên | Lark `🌸 GMV 30 ngày`, `(Chốt) GMV 30 ngày` | **8%** (Done / Làm ĐNTT: 18%) |
| **CPV** | Chi phí / view 30 ngày (chỉ booking có đủ 2 số) | tính | ~23% |
| **ROI** | GMV 30 ngày / chi phí (chỉ booking có đủ 2 số) | tính | ~8% |
| Đúng hạn air | Tỷ lệ booking không "Trễ hạn" SLA | Lark `Cảnh báo trễ SLA` | **74% booking bị đánh dấu trễ, cần kiểm lại công thức Lark** |
| Đánh giá hiệu quả video | Nhận xét team trên Lark | Lark `Đánh giá hiệu quả video`, `Đánh giá 14/30 days` | **chưa đồng bộ** |
| Đánh giá sao TB | Trung bình sao sau deal, ≤ 2 là điểm thấp | Booking Hub `KocRating` (nhập ở tab Nghiệm thu) | 0% (chưa có màn nhập) |
| Nghiệm thu đạt lần đầu | Job đạt ở lần nghiệm thu đầu / job đã nghiệm thu | Job app | 5 / 62 job đã nghiệm thu |
| Brand đã làm | Danh sách brand, số đợt mỗi brand | Lark | 100% |

### 3.3 Chỉ số kênh (TikTok, 30 ngày)

Có sẵn trong hồ sơ TikTok đang lưu (`Koc.ttsProfile`, 343 KOC): follower, số video / LIVE bán hàng, view / like / bình luận / chia sẻ TB, **ER video / LIVE**, **GPM**, sản phẩm bán, GMV (khoảng; chính xác 139 KOC), **AOV** (khoảng), **hoa hồng TB** (139), cơ cấu GMV video / LIVE / showcase, top ngành hàng, giới tính / tuổi / tỉnh thành follower, số brand đã hợp tác, tần suất đăng, bio, cấp creator. Lịch sử: `KocSnapshot` (343 KOC).

Hiệu quả với UpBase (Trạm, đã lưu cho KOL Danh bạ): bán cho 8 shop UpBase 922 KOC, video gắn sản phẩm 905, TAP 665, xin mẫu 405, đơn affiliate 375, LIVE 61, MCN 16.

**Không có nguồn** (b2c có nhưng TikTok API không trả): CTR giỏ hàng, CR chuyển đổi, tỷ lệ hoàn / huỷ, điểm uy tín TikTok, video gần nhất của kênh (Trạm chỉ có video gắn sản phẩm shop UpBase).

### 3.4 Liên hệ, pháp lý

| Dữ liệu | Nguồn | Độ phủ |
|---|---|---|
| SĐT / Zalo / email | Booking Hub 0%. Lark bảng **3.4 KOCs tổng hợp** (`tblTzGxo27dWxfjT`, 6.087 dòng) có `Zalo`, `Email`: mẫu 500 dòng Zalo **54%**, Email 1% | **chưa đồng bộ** |
| Người nhận / địa chỉ nhận mẫu | Lark bảng **3.4 List KOCs tổng hợp** (`tblY8408KFBMJVFw`) có `Địa chỉ`, `Địa chỉ cập nhật` nhưng mẫu 500 dòng **0%**: chỉ còn nhập tay (Ghi lịch sử liên hệ) | **0%** |
| Giá net video / giá booking gần nhất | Lark `3.4 List KOCs tổng hợp.Giá net video` (mẫu 43%), `3.4 KOCs tổng hợp.Giá booking gần nhất` (47%) | **chưa đồng bộ** |
| PIC phụ trách KOC | Lark `3.4 KOCs tổng hợp.PIC` (mẫu 32%) | **chưa đồng bộ** |
| CCCD / MST, số TK, ngân hàng, chủ TK | Lark (điền ô trống) → hồ sơ pháp lý | 56% |
| Loại tài khoản (cá nhân / HKD / DN) | Lark `Loại tài khoản thanh toán` | 61% booking |
| Link hợp đồng | Lark `Link hợp đồng` | 5% booking |
| Ngành hàng (KOC category) | Lark có cột `KOC category` | **chưa đồng bộ**, app 0% |
| Tệp kênh | Lark `🎃 Tệp kênh` | 66% |

## 4. Dữ liệu phải đảm bảo

### 4.1 Cam kết dữ liệu (đề xuất)

| # | Cam kết | Chỉ tiêu | Hiện tại | Việc cần làm |
|---|---|---|---|---|
| D1 | Booking Lark mới nhất | Đồng bộ đúng :00 mỗi giờ, lỗi thì báo | Đã làm (crontab server DX) | — |
| D2 | Chỉ số TikTok của KOL đang book | ≥ 90% KOL book trong 90 ngày có số ≤ 7 ngày tuổi | 343 / 3.066 (11%) | Chuyển job `creator-stats` sang crontab server (mỗi giờ, ~22 KOL / lượt ≈ 530 / ngày, phủ hết trong ~6 ngày); sửa 306 ID kênh sai định dạng |
| D3 | Liên hệ & nhận mẫu | ≥ 95% KOL book trong 90 ngày có SĐT / Zalo; KOL đang gửi mẫu có địa chỉ | 0% | Đồng bộ `Zalo`, `Email`, `PIC`, giá từ 2 bảng 3.4 trên Lark (chỉ điền ô trống, như CCCD / số TK) → dự kiến ~54% có Zalo; phần còn lại và địa chỉ: nhập ở "Ghi lịch sử liên hệ", kiểm thiếu ở Kiểm soát nhập liệu |
| D4 | Số hiệu quả sau air | ≥ 90% booking Done / Làm ĐNTT có link air, view 30 ngày; GMV 30 ngày với booking gắn giỏ | link 86%, view 52%, GMV 18% | Thêm vào Kiểm soát nhập liệu (tab Dữ liệu): thiếu link air, thiếu view 30 ngày sau 35 ngày air |
| D5 | Chi phí và hình thức | ≥ 98% booking có chi phí (hoặc đánh dấu FOC) và hình thức | chi phí 71%, hình thức 68% | Đã có kiểm "Thiếu chi phí"; thêm "Thiếu hình thức" |
| D6 | Định danh KOC | 1 kênh = 1 hồ sơ; booking khớp được KOC | 79 nhóm nghi trùng, 306 ID sai định dạng | Gộp nhóm trùng ở trang KOC; kiểm ID sai định dạng (đã có) |
| D7 | Hồ sơ thanh toán | 100% KOL có job sắp ĐNTT có CCCD / MST + số TK hợp lệ | 56% KOC | Cảnh báo ở trang KOC và ĐNTT (đã có "Thiếu") |
| D8 | Mỗi số ghi nguồn và thời điểm | 100% metric có tooltip nguồn + "cập nhật lúc" | một phần | Làm trong trang mới |

### 4.2 Quy tắc hiển thị
- Thiếu số thì "—", không hiện 0. Số do team điền trên Lark ghi nhãn "Team tự điền"; số TikTok ghi "Số TikTok trả về".
- CPV, ROI chỉ tính trên booking có đủ cả 2 số, ghi rõ "trên N / M đợt có số".
- GMV kênh (cả kênh trên TikTok Shop) và GMV từ booking UpBase không cộng, không so chung.
- Số nhạy cảm (CCCD, số TK) che `****1234` khi không có quyền `koc.bank`.

## 5. Ngoài phạm vi
- Ký hợp đồng, đồng bộ KOC Hub / UpAffiliate (thuộc tab Hợp đồng, KOC Hub).
- Nhập đánh giá sao sau deal (thuộc tab Nghiệm thu; trang này chỉ hiển thị).
- CTR, CR, tỷ lệ hoàn / huỷ, điểm uy tín TikTok, video gần nhất của kênh: chưa có nguồn.

## 6. Kỹ thuật
- Stack: Next.js 16 App Router (server component, `searchParams` cho tab / hộp thoại), Prisma 6, Postgres 17, Tailwind 4 (token b2c trong `src/app/globals.css`).
- Lệnh: `npm run typecheck` · `npm test` · `npx next build` · deploy server DX: `bash ops/deploy-dx.sh`.
- Vị trí: `src/app/(app)/contacts/[id]/` (trang, các tab), logic thuần (CPV, ROI, đúng hạn, tóm tắt) trong `src/lib/kocInsights.ts` kèm test `src/lib/kocInsights.test.ts`.
- Kiểm thử: unit test cho mọi công thức metric (thiếu số, chia 0, chỉ tính trên bản ghi đủ số); render thử trang với dữ liệu production trên server (như đã làm với Danh bạ); chụp màn hình so với b2c.

## 7. Ranh giới
- **Luôn:** dùng dữ liệu Booking Hub; ghi nguồn số; giữ phân quyền / phạm vi brand; test công thức trước khi commit.
- **Hỏi trước:** thêm bảng / cột DB; đồng bộ thêm trường Lark; đổi lịch cron; bỏ khối đang dùng của Booking Hub.
- **Không:** dùng dữ liệu mẫu b2c; suy ra số không có nguồn (CTR, CR, điểm uy tín); hiện số nhạy cảm cho người không có quyền.

## 8. Tiêu chí hoàn thành
1. Trang có đủ khối mục 2, bố cục theo b2c; mỗi metric mục 3.1–3.3 có nguồn + thời điểm cập nhật.
2. Với KOC có ≥ 5 booking (vd. `14th02_`), trả lời được Q1–Q5 mà không mở trang khác.
3. CPV, ROI, đúng hạn có unit test (đủ số, thiếu số, chia 0) và khớp tính tay trên 3 KOC mẫu.
4. Mở trang ≤ 1 giây với KOC 400 booking (server DX).
5. Chỉ tiêu D2, D4, D5 có số theo dõi ở tab Dữ liệu → Kiểm soát nhập liệu.

## 9. Câu hỏi mở
1. **Địa chỉ nhận mẫu của KOC nằm ở đâu?** Lark 2 bảng 3.4 có cột Địa chỉ nhưng gần như trống; có ở UpAffiliate / KOC Hub hay sheet nào khác không? Zalo / Email / giá / PIC thì lấy được từ Lark 3.4 KOCs tổng hợp (mục 3.4): đồng ý đồng bộ không?
2. Đồng bộ thêm từ bảng booking Lark: `KOC category`, `Giá book cao / thấp nhất`, `Đánh giá hiệu quả video`, `Đánh giá 14 / 30 days`, `(Chốt) Views / GMV 30 ngày`, `Views / GMV 60 / 90 ngày`, `Media PIC`, `Growth PIC`?
3. "Booking đang chạy" tính thế nào? 10.401 booking đang ở pipeline "Gửi hàng", nhiều booking cũ chưa chuyển bước: đề xuất = chưa Done **và** air / dự kiến air trong 60 ngày gần đây hoặc sắp tới.
4. Cờ "Trễ hạn SLA" đang bật ở 74% booking: đúng thực tế hay công thức Lark sai?
5. "Điểm uy tín KOC": bỏ, hay ghép từ các số có thật (đúng hạn air, nghiệm thu đạt lần đầu, sao TB)?
6. 63% booking có nền tảng "Khác": có cần chuẩn hoá cột nền tảng trên Lark không?
