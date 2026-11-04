import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, parseCriteria, type MatchKoc } from './matching';

const koc: MatchKoc = {
  id: 'k', handle: 'abc', name: 'abc', nickname: null, avatarUrl: null, niche: 'Beauty', kl: null, klAuto: 'KL3',
  followers: 120_000, avgViews: 8_000, unitsSold: null, gpmUsd: null, bookingCount: 2, statsAt: null, gmvRange: null,
  ttsProfile: { follower_gender: [{ key: 'female', value: '0.8' }], category_gmv_distribution: [{ category_id: '601450', value: '0.6' }] },
};

test('evaluate: đạt / trượt / chưa rõ', () => {
  const r = Object.fromEntries(evaluate({ niches: ['Beauty'], kl: ['KL1'], followersMin: 100_000, unitsSoldMin: 10, femaleMin: 70, category: 'Làm đẹp & Chăm sóc cá nhân', categoryMin: 50, collab: 'yes' }, koc, null).map((c) => [c.label, c.ok]));
  assert.deepEqual(r, { 'Tệp kênh': true, 'Cấp KOL': false, 'Follower từ': true, 'Số món bán': null, 'Follower nữ': true, 'Ngành hàng': true, 'Hợp tác UB': true });
});

test('parseCriteria đọc form và báo ô số sai', () => {
  const fd = new FormData();
  fd.append('niches', 'Beauty'); fd.append('niches', 'Review Nữ'); fd.set('followersMin', '10.000'); fd.set('collab', 'no');
  assert.deepEqual(parseCriteria(fd), { niches: ['Beauty', 'Review Nữ'], followersMin: 10000, collab: 'no' });
  fd.set('gpmMin', 'abc');
  assert.equal(typeof parseCriteria(fd), 'string');
});
