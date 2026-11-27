import type { NextConfig } from 'next';

// File brief PDF / ảnh tải lên cho AI đọc (Creator matching) đi qua server action: nâng giới hạn 1 MB mặc định.
// nginx stg (client_max_body_size 20m) và trần 18 MB của form khớp với mức này.
const nextConfig: NextConfig = { experimental: { serverActions: { bodySizeLimit: '20mb' } } };

export default nextConfig;
