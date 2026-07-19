// 쿼터·레이트리밋 검증 — 여기가 새면 곧바로 요금이 된다.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  consume,
  peek,
  sweep,
  _reset,
  DAILY_LIMIT,
  BURST_LIMIT,
  WINDOW_MS,
} from '../src/quota.js';

beforeEach(() => _reset());

test('기기 식별자가 없으면 거부한다', () => {
  const r = consume(null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_user');
});

test('정상 요청은 통과하고 남은 횟수를 알려준다', () => {
  const r = consume('device-aaaaaaaa');
  assert.equal(r.ok, true);
  assert.equal(r.remaining, DAILY_LIMIT - 1);
});

test('연타하면 막고, 얼마 뒤 다시 되는지 알려준다', () => {
  const u = 'device-bbbbbbbb';
  const t0 = Date.now();
  for (let i = 0; i < BURST_LIMIT; i++) {
    assert.equal(consume(u, t0 + i).ok, true, `${i}번째는 통과해야 함`);
  }
  const blocked = consume(u, t0 + BURST_LIMIT);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'too_fast');
  assert.ok(blocked.retryAfter > 0);
});

test('연타 제한은 시간이 지나면 풀린다', () => {
  const u = 'device-cccccccc';
  const t0 = Date.now();
  for (let i = 0; i < BURST_LIMIT; i++) consume(u, t0 + i);
  assert.equal(consume(u, t0 + BURST_LIMIT).ok, false);
  // 창이 지난 뒤에는 다시 허용
  assert.equal(consume(u, t0 + WINDOW_MS + 1).ok, true);
});

test('하루 한도를 넘으면 막는다', () => {
  const u = 'device-dddddddd';
  let t = Date.now();
  let allowed = 0;
  // 연타 제한에 걸리지 않도록 시간을 벌리며 호출
  for (let i = 0; i < DAILY_LIMIT + 5; i++) {
    const r = consume(u, t);
    if (r.ok) allowed++;
    t += WINDOW_MS + 1;
  }
  assert.equal(allowed, DAILY_LIMIT, '정확히 한도만큼만 허용해야 함');
  const r = consume(u, t);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'daily_limit');
});

test('사용자끼리 한도가 섞이지 않는다', () => {
  const t = Date.now();
  consume('device-user-one', t);
  const other = peek('device-user-two', t);
  assert.equal(other.used, 0, '다른 사용자 사용량에 영향 없어야 함');
});

test('날짜가 바뀌면 한도가 초기화된다', () => {
  const u = 'device-eeeeeeee';
  const day1 = Date.parse('2026-07-19T10:00:00Z');
  let t = day1;
  for (let i = 0; i < DAILY_LIMIT; i++) {
    consume(u, t);
    t += WINDOW_MS + 1;
  }
  assert.equal(consume(u, t).ok, false, '같은 날은 막혀야 함');
  const day2 = Date.parse('2026-07-20T10:00:00Z');
  assert.equal(consume(u, day2).ok, true, '다음 날은 다시 허용');
});

test('peek은 사용량을 차감하지 않는다', () => {
  const u = 'device-ffffffff';
  consume(u);
  const a = peek(u);
  const b = peek(u);
  assert.equal(a.used, 1);
  assert.equal(b.used, 1);
});

test('sweep은 지난 날짜 기록을 정리한다', () => {
  const u = 'device-gggggggg';
  const day1 = Date.parse('2026-07-19T10:00:00Z');
  consume(u, day1);
  const day2 = Date.parse('2026-07-21T10:00:00Z');
  sweep(day2);
  assert.equal(peek(u, day2).used, 0);
});
