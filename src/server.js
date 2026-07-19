// Node 실행 진입점 (Render / Railway / 일반 VM 용)
// Cloudflare Workers·Vercel에 올릴 땐 app.js를 그대로 쓰면 된다.

import { serve } from '@hono/node-server';
import app from './app.js';
import { sweep } from './quota.js';

const port = Number(process.env.PORT ?? 8787);

// 메모리 누수 방지: 10분마다 오래된 카운터 정리
setInterval(() => sweep(), 10 * 60 * 1000).unref?.();

serve({ fetch: app.fetch, port }, (info) => {
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  console.log(`[gateway] listening on :${info.port}`);
  if (!configured) {
    console.warn('[gateway] ⚠ ANTHROPIC_API_KEY 미설정 — /v1/ai 는 500을 반환합니다');
  }
});
