# Booking Hub chạy trên server DX (Docker). Render vẫn build bằng `next build` như cũ, không dùng file này.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Heap tối đa 1 GB: job tổng hợp kho (~3 phút) chạy trong 512 MB; giới hạn để GC dọn sớm, không chiếm RAM của server dùng chung.
ENV NODE_ENV=production PORT=3000 NODE_OPTIONS=--max-old-space-size=1024
COPY --from=build /app ./
EXPOSE 3000
# Như Render: đồng bộ schema (chỉ thêm bảng / cột) rồi chạy app.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx next start -p 3000"]
