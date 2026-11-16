import test from 'node:test';
import assert from 'node:assert/strict';
import { toStats } from './creatorStats';

// Rút gọn từ phản hồi thật (creator VN, 04/11/2026).
test('toStats đọc hồ sơ creator VN: GMV chỉ có khoảng, GPM tính USD', () => {
  const s = toStats({
    nickname: 'Thỏ thích thử', follower_count: 15367, avg_ec_video_play_count: 1632, avg_ec_live_view_count: 0,
    units_sold: 268, gmv_range: { formatted_range: '1M₫+' }, gpm: { amount: '10.396', currency: 'USD' }, creator_level: 2,
  });
  assert.deepEqual(s, {
    nickname: 'Thỏ thích thử', followers: 15367, avgViews: 1632, avgLiveViews: 0, unitsSold: 268,
    gmvRange: '1M₫+', gpmUsd: 10.396, creatorLevel: 2,
  });
});

test('toStats: GMV chính xác thì dùng số, trường thiếu để undefined (giữ giá trị cũ)', () => {
  const s = toStats({ gmv: { amount: '77456.34356', currency: 'USD' }, gpm: { amount: '5', currency: 'VND' } });
  assert.equal(s.gmvRange, '77.456 USD');
  assert.equal(s.gpmUsd, undefined);
  assert.equal(s.followers, undefined);
});
