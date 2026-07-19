// AI 게이트웨이 라우팅 (Hono — Node/Cloudflare/Vercel 어디든 올릴 수 있음)
//
// 앱 → 이 서버 → Anthropic
//   · 앱은 Anthropic 키를 갖지 않는다 (키 추출 위험 제거)
//   · 사용자별 쿼터·연타 방지·서버 전체 상한으로 비용을 통제한다
//   · 용도별 모델 라우팅으로 비용을 낮춘다

import { Hono } from 'hono';
import { complete, AnthropicError, MODELS } from './anthropic.js';
import { consume, peek, DAILY_LIMIT } from './quota.js';

export const app = new Hono();

/** 앱이 보내는 기기 식별자. 없으면 거부. */
function userIdOf(c) {
  const id = c.req.header('x-device-id')?.trim();
  if (!id || id.length < 8 || id.length > 128) return null;
  return id;
}

/** 클라이언트 인증(선택). APP_TOKEN을 설정하면 그 값을 가진 앱만 허용. */
function appTokenOk(c) {
  const expected = process.env.APP_TOKEN;
  if (!expected) return true; // 미설정이면 검사 안 함
  return c.req.header('x-app-token') === expected;
}

app.get('/health', (c) =>
  c.json({
    ok: true,
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
    models: MODELS,
    dailyLimit: DAILY_LIMIT,
  })
);

/** 남은 사용량 조회 */
app.get('/v1/quota', (c) => {
  const userId = userIdOf(c);
  if (!userId) return c.json({ error: 'missing_device_id' }, 400);
  return c.json(peek(userId));
});

/**
 * AI 호출. body: { kind: 'briefing'|'analyze', prompt: string }
 * 앱은 프롬프트만 보내고, 키·모델·한도는 서버가 관리한다.
 */
app.post('/v1/ai', async (c) => {
  if (!appTokenOk(c)) return c.json({ error: 'unauthorized' }, 401);

  const userId = userIdOf(c);
  if (!userId) return c.json({ error: 'missing_device_id' }, 400);

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const kind = body?.kind === 'briefing' ? 'briefing' : 'analyze';
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) return c.json({ error: 'empty_prompt' }, 400);
  if (prompt.length > 20000) return c.json({ error: 'prompt_too_long' }, 413);

  // 쿼터 검사 (여기서 비용이 통제된다)
  const gate = consume(userId);
  if (!gate.ok) {
    const status = gate.reason === 'too_fast' ? 429 : 429;
    return c.json(
      {
        error: gate.reason,
        message:
          gate.reason === 'daily_limit'
            ? '오늘 AI 사용 한도를 다 썼어요. 내일 다시 이용해 주세요.'
            : gate.reason === 'too_fast'
              ? '요청이 너무 빨라요. 잠시 후 다시 시도해 주세요.'
              : '지금은 AI 사용이 많아 잠시 제한됐어요.',
        retryAfter: gate.retryAfter ?? null,
      },
      status
    );
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    const out = await complete({ prompt, kind, signal: ctrl.signal });
    clearTimeout(timer);
    return c.json({ text: out.text, remaining: gate.remaining });
  } catch (e) {
    if (e instanceof AnthropicError) {
      // 키 등 내부 정보가 밖으로 나가지 않도록 메시지를 일반화
      const status = e.status === 401 ? 500 : e.status;
      return c.json(
        {
          error: 'upstream_error',
          message:
            status === 429
              ? 'AI 요청이 몰려 잠시 제한됐어요. 잠시 후 다시 시도해 주세요.'
              : 'AI 분석에 실패했어요. 잠시 후 다시 시도해 주세요.',
        },
        status >= 400 && status < 600 ? status : 502
      );
    }
    if (e?.name === 'AbortError') {
      return c.json({ error: 'timeout', message: '응답이 지연됐어요.' }, 504);
    }
    return c.json({ error: 'internal', message: 'AI 처리 중 오류가 생겼어요.' }, 500);
  }
});

export default app;
