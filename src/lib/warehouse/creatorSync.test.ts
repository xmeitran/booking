import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCreator } from './creatorSync';

test('dòng kho (qua Metabase) → WarehouseCreator: % về 0..1, GMV ẩn lấy trung điểm, top video', () => {
  const at = new Date('2026-11-26T00:00:00Z');
  const c = toCreator({
    channel_code: 'tiktok', handle: '@Abc.Shop', nickname: 'ABC', follower_count: 120000, avg_video_play_count: 15000, video_engagement_rate: '5.23',
    female: 81.5, a1: 40, a2: 35, a3: 15, a4: 7, a5: 3, is_gmv_hidden_by_creator: true, gmv_amount: 0, gmv_range_min: 10_000_000, gmv_range_max: 50_000_000,
    follower_state_location: '[{"key":"HO CHI MINH","value":"30.5"},{"key":"HA NOI","value":"20"}]',
    cats: '[["Beauty & Personal Care",0.65],["Health",0.2]]', partnered_brands: '[{"name":"Cocoon"},"Hada Labo"]',
    vids: '[[1,"Review kem tay","7684300941247499527",50000,2000,"2026-11-01","Kem tay A"]]', cast_fee: 2500000.0, source_at: '2026-11-25 21:34:02.170000',
  }, at)!;
  assert.equal(c.handle, 'abc.shop');
  assert.equal(c.platform, 'TikTok');
  assert.equal(c.female, 0.815);
  assert.equal(c.ages!['18-24'], 0.4);
  assert.equal(c.er, 0.0523);
  assert.equal(c.gmv, 30_000_000);
  assert.deepEqual(c.locations, [{ name: 'HO CHI MINH', share: 0.305 }, { name: 'HA NOI', share: 0.2 }]);
  assert.equal(c.categories![0].share, 0.65);
  assert.deepEqual(c.brands, ['Cocoon', 'Hada Labo']);
  assert.equal(c.topVideos![0].date, '2026-11-01');
  assert.equal(c.topVideos![0].url, 'https://www.tiktok.com/@abc.shop/video/7684300941247499527');
  assert.equal(c.sourceAt, '2026-11-25T21:34:02.170Z');
  assert.equal(c.castFee, 2_500_000);
  assert.equal(toCreator({ channel_code: 'zalo', handle: 'x' }, at), null);
  // Chưa có chân dung follower: tuổi toàn 0, % nữ giữ chỗ 100 → không có dữ liệu. View trung vị 0 → không có dữ liệu.
  const empty = toCreator({ channel_code: 'tiktok', handle: 'y', female: 100, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, avg_video_play_count: 0, video_engagement_rate: '', vids: '[]' }, at)!;
  assert.equal(empty.female, null);
  assert.equal(empty.ages, null);
  assert.equal(empty.medianViews, null);
  assert.equal(empty.er, null);
  assert.equal(empty.topVideos, null);
  // Vài trăm creator ghi tỷ lệ tuổi theo 0..1 thay vì %.
  const frac = toCreator({ channel_code: 'tiktok', handle: 'z', female: 36.0066, a1: 0.3513, a2: 0.4872, a3: 0.1238, a4: 0.0225, a5: 0.015 }, at)!;
  assert.equal(frac.ages!['18-24'], 0.3513);
  assert.equal(frac.female, 0.360066);
});
