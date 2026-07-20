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

app.get('/health', (c) => {
  // 키가 '있는지'만이 아니라 '형식이 맞는지'까지 알려준다.
  // ⚠️ 키 자체는 절대 노출하지 않는다 — 길이와 접두사(공개 정보)만 보여준다.
  const raw = process.env.ANTHROPIC_API_KEY ?? '';
  const key = raw.trim();
  // ⚠️ 변수명을 헷갈려 엉뚱한 이름(AI_API_KEY 등)에 키를 넣는 사고가 있었다.
  //    형식만 맞으면 '정상'으로 보여서 원인 파악이 늦어졌으므로, 오해할 만한
  //    이름에 값이 들어와 있으면 여기서 바로 경고한다.
  const misnamed = ['AI_API_KEY', 'API_KEY', 'CLAUDE_API_KEY', 'ANTHROPIC_KEY']
    .filter((n) => (process.env[n] ?? '').trim().length > 0);
  return c.json({
    ok: true,
    configured: key.length > 0,
    keyCheck: {
      length: key.length, // 정상: 100자 이상
      prefixOk: key.startsWith('sk-ant-'), // 정상: true
      hasQuotes: /^["']|["']$/.test(raw), // true면 따옴표까지 붙여넣은 것
      hasSpace: raw !== key, // true면 앞뒤 공백이 섞인 것
      // ⚠️ 형식이 맞아도 '유효한 키'라는 뜻은 아니다. 실제 확인은 /health/ai
      note: '형식만 검사함. 실제 인증 확인은 /health/ai',
      ...(misnamed.length ? { 잘못된_변수명: misnamed } : {}),
    },
    models: MODELS,
    dailyLimit: DAILY_LIMIT,
  });
});

/**
 * 키가 '실제로 유효한지' 확인한다.
 * /health는 형식만 보므로, 만료·삭제된 키도 정상으로 보인다.
 * 여기서는 AI에 아주 짧은 요청을 실제로 보내 인증 결과를 확인한다.
 * ⚠️ 키 값이나 상세 오류는 밖으로 내보내지 않는다(상태코드와 판정만).
 */
app.get('/health/ai', async (c) => {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    await complete({ prompt: 'ping', kind: 'briefing', maxTokens: 8, signal: ctrl.signal });
    clearTimeout(timer);
    return c.json({ ok: true, auth: '정상', message: '키가 유효하고 AI 응답이 정상입니다.' });
  } catch (e) {
    const status = e instanceof AnthropicError ? e.status : 0;
    const 진단 =
      status === 401 ? '키가 무효합니다 — 삭제됐거나 잘못 입력된 키입니다(ANTHROPIC_API_KEY 확인).'
      : status === 429 ? '키는 유효하지만 요청 한도에 걸렸습니다.'
      : status === 400 ? '키는 유효하지만 요청 형식/모델 이름이 잘못됐습니다.'
      : '연결 실패 — 잠시 후 다시 시도해 주세요.';
    return c.json({ ok: false, auth: '실패', upstreamStatus: status, message: 진단 }, 200);
  }
});

/**
 * 테스터용 APK 다운로드 안내 페이지.
 * 실제 파일은 GitHub Releases에 올리고 여기서 안내 + 연결만 한다.
 * (큰 바이너리를 저장소에 넣으면 배포가 무거워지므로)
 */
app.get('/download', (c) => {
  // 기본값을 넣어 두어 환경변수 설정 없이도 바로 동작한다.
  // 새 버전을 낼 땐 Render 환경변수 APK_URL/APK_VERSION만 바꾸면 된다.
  const url = process.env.APK_URL ??
    'https://github.com/sonweonwoo/ai-calendar-gateway/releases/download/v1.16.1/ai-smart-calendar-v1.16.1.apk';
  const version = process.env.APK_VERSION ?? 'v1.16.1';
  return c.html(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI 스마트 일정 관리 · 설치</title>
<style>
 body{font-family:-apple-system,"Malgun Gothic",sans-serif;background:#FBF3EA;color:#4A3F37;
      margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
 .card{background:#FFFAF4;border:1px solid #EFE0D0;border-radius:20px;max-width:420px;width:100%;
       padding:30px 24px;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.05)}
 .icon{width:88px;height:88px;border-radius:22px;background:#E8998D;margin:0 auto 16px;
       display:flex;align-items:center;justify-content:center;font-size:40px}
 h1{font-size:1.3rem;margin:0 0 4px} .sub{color:#9C8B7C;font-size:.9rem;margin:0 0 22px}
 a.btn{display:block;background:#E8998D;color:#fff;text-decoration:none;font-weight:700;
       font-size:1.05rem;padding:15px;border-radius:14px;margin-bottom:16px}
 .steps{text-align:left;background:#F6EBDF;border-radius:12px;padding:14px 16px;font-size:.88rem;line-height:1.75}
 .warn{margin-top:14px;font-size:.8rem;color:#B0745F;line-height:1.5}
 .none{background:#F6EBDF;border-radius:12px;padding:18px;font-size:.9rem;color:#9C8B7C}
</style></head><body><div class="card">
 <div class="icon">🗂️</div>
 <h1>AI 스마트 일정 관리</h1>
 <p class="sub">일정과 메모를 AI가 자동 정리해요${version ? ` · ${version}` : ''}<br>(안드로이드 전용)</p>
 ${
   url
     ? `<a class="btn" href="${url}">📥 앱 설치파일 받기</a>
 <div class="steps"><b>설치 방법</b><br>
  1. 위 버튼으로 다운로드<br>
  2. 받은 파일을 탭 → "이 출처의 앱 설치 허용" → 허용<br>
  3. 설치 → 열기 → 사용 설명서 확인<br>
  ※ 아이폰은 설치할 수 없어요</div>
 <p class="warn">⚠️ 앱에서 일정을 수정·삭제하면 휴대폰 캘린더(삼성·구글)에도 반영됩니다.</p>`
     : `<div class="none">아직 설치파일이 준비되지 않았어요.<br>잠시 후 다시 확인해 주세요.</div>`
 }
</div></body></html>`);
});

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
