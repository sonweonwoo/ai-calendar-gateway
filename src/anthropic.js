// Anthropic Messages API 호출 (키는 '서버에만' 존재한다)
//
// 앱에는 절대 키를 두지 않고, 이 파일만 키를 안다.
// 모델은 용도별로 나눠 비용을 통제한다:
//   - briefing(매일 반복)  → 저가 모델
//   - analyze(사용자가 누를 때) → 고급 모델

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

/** 용도별 모델. 환경변수로 덮어쓸 수 있다. */
export const MODELS = {
  // 하루 브리핑은 매일 자동으로 나가므로 저렴한 모델을 기본으로
  briefing: process.env.MODEL_BRIEFING ?? 'claude-haiku-4-5',
  // 사용자가 직접 누르는 분석은 품질 우선
  analyze: process.env.MODEL_ANALYZE ?? 'claude-opus-4-8',
};

export class AnthropicError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * 프롬프트를 보내고 텍스트를 받는다.
 * @param {{prompt: string, kind: 'briefing'|'analyze', maxTokens?: number, signal?: AbortSignal}} opts
 */
export async function complete({ prompt, kind, maxTokens, signal }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AnthropicError(500, 'server_not_configured');

  const model = MODELS[kind] ?? MODELS.analyze;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens ?? (kind === 'briefing' ? 800 : 1024),
      messages: [{ role: 'user', content: prompt }],
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AnthropicError(res.status, body.slice(0, 300));
  }

  const data = await res.json();
  const text = (data.content ?? [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();

  if (!text) throw new AnthropicError(502, 'empty_response');
  return { text, model, usage: data.usage ?? null };
}
