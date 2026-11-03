#!/usr/bin/env bash
# Tạo Postgres riêng cho Booking Hub trên VPS DX (container tách khỏi Postgres của CRM).
# Chạy trên VPS: sudo bash setup-db-dx.sh
# In ra DATABASE_URL để dán vào Render. Chạy lại lần 2 không tạo lại mật khẩu.
set -euo pipefail

DIR=${DIR:-/opt/booking-hub-db}
PORT=${PORT:-15439}
mkdir -p "$DIR" && cd "$DIR"

[ -f .env ] || echo "BOOKING_DB_PASSWORD=$(openssl rand -hex 24)" > .env
[ -f server.key ] || openssl req -new -x509 -days 3650 -nodes -subj "/CN=booking-hub-db" \
  -keyout server.key -out server.crt 2>/dev/null
chmod 600 .env server.key
# Từ ngoài container chỉ nhận kết nối SSL; socket trong container (lúc khởi tạo) vẫn trust.
printf 'local all all trust\nhostssl all all 0.0.0.0/0 scram-sha-256\nhostssl all all ::/0 scram-sha-256\n' > pg_hba.conf

cat > docker-compose.yml <<YAML
services:
  postgres:
    image: postgres:16-alpine
    container_name: booking-hub-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: booking_hub
      POSTGRES_USER: booking_hub
      POSTGRES_PASSWORD: \${BOOKING_DB_PASSWORD}
    # Postgres đòi key SSL thuộc user postgres, quyền 600: chép vào trong container rồi mới chạy.
    entrypoint: ["sh", "-c", "install -o postgres -g postgres -m 600 /certs/* /var/lib/postgresql/ && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/var/lib/postgresql/server.crt -c ssl_key_file=/var/lib/postgresql/server.key -c hba_file=/var/lib/postgresql/pg_hba.conf"]
    ports:
      - "0.0.0.0:${PORT}:5432"
    volumes:
      - data:/var/lib/postgresql/data
      - ./server.crt:/certs/server.crt:ro
      - ./server.key:/certs/server.key:ro
      - ./pg_hba.conf:/certs/pg_hba.conf:ro
volumes:
  data: {}
YAML

docker compose up -d
until docker exec booking-hub-postgres pg_isready -U booking_hub -d booking_hub >/dev/null 2>&1; do sleep 1; done

set -a; . ./.env; set +a
HOST=${HOST:-$(curl -s https://checkip.amazonaws.com)}
echo
echo "DATABASE_URL=postgresql://booking_hub:${BOOKING_DB_PASSWORD}@${HOST}:${PORT}/booking_hub?sslmode=require"
echo
echo "Nhớ mở cổng ${PORT}/tcp trong AWS Security Group cho 74.220.49.0/24 và 74.220.57.0/24 (IP outbound của Render)."
