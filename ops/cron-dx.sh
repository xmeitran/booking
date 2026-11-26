#!/usr/bin/env bash
# Lịch chạy job nền của Booking Hub trên server DX (crontab user merkle, xem `crontab -l`):
#   0 * * * *  ~/booking-hub/ops/cron-dx.sh sync-bookings sync-plans sync-listings   # đồng bộ Lark đúng :00 mỗi giờ
#   20 * * * * ~/booking-hub/ops/cron-dx.sh data-sources               # tổng hợp tab Dữ liệu (app tự giới hạn 6 giờ / lần)
#   30 2 * * *    ~/booking-hub/ops/cron-dx.sh sync-creators           # số liệu creator từ kho (qua Metabase) cho Creator matching (bỏ qua khi chưa cấu hình)
# Gọi thẳng container (127.0.0.1:3060), các job chạy song song để cùng bắt đầu lúc :00. Kết quả ghi ~/booking-hub/cron.log.
set -u
key=$(cat "$HOME/booking-hub/.cron-secret")
for job in "$@"; do
  (
    out=$(mktemp)
    code=$(curl -s -o "$out" -w '%{http_code}' -m 1800 -X POST -H "x-cron-secret: $key" "http://127.0.0.1:3060/api/cron/$job")
    echo "$(date -u +%FT%TZ) $job $code $(head -c 300 "$out")" >> "$HOME/booking-hub/cron.log"
    rm -f "$out"
  ) &
done
wait
