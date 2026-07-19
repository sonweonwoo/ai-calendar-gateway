# AI 게이트웨이

앱이 **Anthropic API 키를 갖지 않도록** 중계하는 서버입니다.

```
[앱] --(프롬프트만)--> [이 서버] --(키 보관)--> [Anthropic]
```

## 왜 필요한가
지금 앱은 빌드할 때 키를 심어 넣습니다(`--dart-define=AI_API_KEY=...`).
**APK를 뜯으면 키가 추출**되어 도용·요금 폭주로 이어질 수 있습니다.
이 서버를 거치면:

| 문제 | 해결 |
|---|---|
| 앱에서 키 추출 | 키는 서버 환경변수에만 존재 |
| 비용 통제 불가 | 사용자별 하루 한도 + 연타 방지 + 서버 전체 상한 |
| 비싼 모델 남용 | 용도별 모델 분리(브리핑=저가, 분석=고급) |
| 오류 시 내부 정보 노출 | 메시지를 일반화해 반환 |

## 로컬 실행
```bash
cd gateway
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start      # 기본 포트 8787
```

## 환경변수
| 이름 | 기본값 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | (필수) | Anthropic 키. **이 서버에만 둡니다** |
| `PORT` | 8787 | 포트 |
| `DAILY_LIMIT` | 20 | 사용자(기기)당 하루 호출 한도 |
| `BURST_LIMIT` | 5 | `WINDOW_MS` 안 최대 호출 수(연타 방지) |
| `WINDOW_MS` | 60000 | 연타 판정 시간창(ms) |
| `GLOBAL_DAILY_LIMIT` | 5000 | **서버 전체** 하루 상한(비용 서킷브레이커) |
| `MODEL_BRIEFING` | claude-haiku-4-5 | 매일 나가는 브리핑용(저가) |
| `MODEL_ANALYZE` | claude-opus-4-8 | 사용자가 누르는 분석용(고급) |
| `APP_TOKEN` | (없음) | 설정하면 `x-app-token` 헤더가 일치하는 앱만 허용 |

## API
### `GET /health`
서버 상태·설정 확인.

### `GET /v1/quota`
헤더: `x-device-id`
→ `{ used, limit, remaining }`

### `POST /v1/ai`
헤더: `x-device-id` (필수), `x-app-token` (APP_TOKEN 설정 시)
```json
{ "kind": "briefing" | "analyze", "prompt": "..." }
```
→ 성공 `{ "text": "...", "remaining": 17 }`
→ 한도 초과 `429 { "error": "daily_limit" | "too_fast", "message": "...", "retryAfter": 60 }`

## 테스트
```bash
node --test test/
```
쿼터·연타·날짜 초기화·사용자 격리를 검증합니다. **비용과 직결되므로 수정 시 반드시 통과 확인.**

## 배포 (아직 미결정)
어디든 올릴 수 있게 Hono로 작성했습니다.

| 후보 | 장점 | 주의 |
|---|---|---|
| **Cloudflare Workers** | 무료 넉넉, **콜드스타트 없음**, 전세계 빠름 | `src/app.js`를 진입점으로 wrangler 설정 필요 |
| **Render** | 이미 쓰고 계심, 익숙함 | 무료 플랜은 유휴 후 **첫 요청 30초+ 지연**(AI엔 치명적) → 유료 권장 |
| **Vercel** | 간편 | 함수 실행시간 제한 확인 필요 |

> 추천: **Cloudflare Workers** — AI 프록시는 콜드스타트가 곧 사용자 대기시간이라, 무료로 상시 대기되는 쪽이 유리합니다.

## 남은 일 (사용자 늘면)
- 쿼터 저장을 **메모리 → Redis**로 (서버 여러 대·재시작 대응)
- 프롬프트 캐싱 / 배치 API로 비용 추가 절감
- 사용량·비용 대시보드, 알림
