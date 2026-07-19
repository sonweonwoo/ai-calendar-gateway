// 사용자별 쿼터 · 레이트리밋 (메모리 기반)
//
// 왜 필요한가:
//   앱이 Anthropic을 직접 부르면 사용량·비용을 통제할 방법이 없다.
//   게이트웨이가 "누가 · 얼마나" 썼는지 세어야 비용 폭주와 남용을 막을 수 있다.
//
// ⚠️ 지금은 메모리 저장이라 서버가 재시작되면 카운터가 초기화되고,
//    인스턴스를 여러 대로 늘리면 인스턴스별로 따로 센다.
//    사용자가 늘면 Redis 등 공유 저장소로 교체할 것. (인터페이스는 그대로 유지)

/** 하루 사용 한도 (사용자당) */
export const DAILY_LIMIT = Number(process.env.DAILY_LIMIT ?? 20);

/** 짧은 시간 연타 방지: WINDOW_MS 안에 BURST_LIMIT회까지 */
export const WINDOW_MS = Number(process.env.WINDOW_MS ?? 60_000);
export const BURST_LIMIT = Number(process.env.BURST_LIMIT ?? 5);

/** 서버 전체 하루 상한 (비용 서킷브레이커) */
export const GLOBAL_DAILY_LIMIT = Number(process.env.GLOBAL_DAILY_LIMIT ?? 5000);

const daily = new Map(); // key: `${userId}:${yyyy-mm-dd}` → count
const burst = new Map(); // key: userId → number[] (요청 시각들)
let globalDay = '';
let globalCount = 0;

function today(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * 사용 가능 여부를 판단하고, 가능하면 1회 차감한다.
 * @returns {{ok: true, remaining: number} | {ok: false, reason: string, retryAfter?: number}}
 */
export function consume(userId, now = Date.now()) {
  if (!userId) return { ok: false, reason: 'no_user' };

  const day = today(now);

  // 0) 서버 전체 상한 (비용 폭주 차단)
  if (globalDay !== day) {
    globalDay = day;
    globalCount = 0;
  }
  if (globalCount >= GLOBAL_DAILY_LIMIT) {
    return { ok: false, reason: 'global_limit' };
  }

  // 1) 연타 방지
  const times = (burst.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (times.length >= BURST_LIMIT) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - times[0])) / 1000);
    burst.set(userId, times);
    return { ok: false, reason: 'too_fast', retryAfter };
  }

  // 2) 하루 한도
  const key = `${userId}:${day}`;
  const used = daily.get(key) ?? 0;
  if (used >= DAILY_LIMIT) {
    return { ok: false, reason: 'daily_limit' };
  }

  // 통과 → 차감
  times.push(now);
  burst.set(userId, times);
  daily.set(key, used + 1);
  globalCount += 1;
  return { ok: true, remaining: DAILY_LIMIT - (used + 1) };
}

/** 현재 사용량 조회 (차감 없음) */
export function peek(userId, now = Date.now()) {
  const used = daily.get(`${userId}:${today(now)}`) ?? 0;
  return { used, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - used) };
}

/** 오래된 항목 정리 (메모리 누수 방지) — 주기적으로 호출 */
export function sweep(now = Date.now()) {
  const day = today(now);
  for (const key of daily.keys()) {
    if (!key.endsWith(day)) daily.delete(key);
  }
  for (const [user, times] of burst) {
    const live = times.filter((t) => now - t < WINDOW_MS);
    if (live.length === 0) burst.delete(user);
    else burst.set(user, live);
  }
}

/** 테스트용 초기화 */
export function _reset() {
  daily.clear();
  burst.clear();
  globalDay = '';
  globalCount = 0;
}
