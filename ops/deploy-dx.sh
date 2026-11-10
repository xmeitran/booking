#!/usr/bin/env bash
# Deploy Booking Hub lên server DX: chép source (không kèm .env), build image, chạy lại container.
# Chạy từ thư mục repo trên máy dev: bash ops/deploy-dx.sh
# Trên server: ~/booking-hub/.env.docker (biến môi trường), container booking-hub-db (Postgres 17, mạng booking-hub).
set -euo pipefail
HOST=${HOST:-merkle@54.254.6.67}
cd "$(dirname "$0")/.."
rsync -az --delete --exclude node_modules --exclude .next --exclude .git --exclude '.env*' --exclude graphify-out --exclude '*.log' ./ "$HOST:booking-hub/"
ssh "$HOST" 'set -e; cd booking-hub
docker build -q -t booking-hub:$(date +%Y%m%d-%H%M) -t booking-hub:latest . >/dev/null
docker rm -f booking-hub >/dev/null 2>&1 || true
docker run -d --name booking-hub --restart unless-stopped --network booking-hub --env-file .env.docker -p 127.0.0.1:3060:3000 booking-hub:latest >/dev/null
for i in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:3060/login && break; sleep 2; done
curl -s -o /dev/null -w "booking-hub /login %{http_code}\n" http://127.0.0.1:3060/login'
