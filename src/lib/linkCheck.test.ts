import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, keywordsOf, verdict, videoIdOf } from './linkCheck';

test('evaluate: sai kênh FAIL, thiếu hashtag FAIL, thiếu từ khoá WARN, bỏ dấu khi so', () => {
  const v = { live: true, finalUrl: 'u', author: 'ABC', caption: 'Dung dich ve sinh #PHCare' };
  assert.equal(verdict(evaluate(v, { handle: 'abc', keywords: ['#phcare', 'dung dịch vệ sinh'] })), 'PASS');
  assert.equal(verdict(evaluate(v, { handle: 'abc', keywords: ['mua ngay'] })), 'WARN');
  assert.equal(verdict(evaluate(v, { handle: 'abc', keywords: ['#sale'] })), 'FAIL');
  assert.equal(verdict(evaluate(v, { handle: 'khac', keywords: [] })), 'FAIL');
  assert.equal(evaluate({ ...v, live: false }, { handle: 'abc', keywords: ['#x'] }).length, 1);
  // Không đọc được caption: hashtag thiếu chỉ là "cần xem lại", không kết luận Không đạt.
  assert.equal(verdict(evaluate({ ...v, caption: null }, { handle: 'abc', keywords: ['#sale'] })), 'WARN');
  assert.equal(evaluate({ live: true, finalUrl: 'u', author: null, caption: null }, { handle: 'abc', keywords: [] })[0].status, 'WARN');
  assert.deepEqual(keywordsOf('#a, b ;c\n'), ['#a', 'b', 'c']);
  assert.equal(videoIdOf('https://www.tiktok.com/@a/video/7412345678901234567?x=1'), '7412345678901234567');
});
