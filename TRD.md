# TRD — 수준별 학습자료 변환기

> **5차시 폴더(`5차시_Supabase연동`)의 문서임.** 4차시 폴더(`../4차시_수준별학습자료변환기`)와 git 저장소가 따로이며 서로 영향을 주지 않음. 1~13절은 4차시 앱 기준 그대로이고, **5차시 추가분은 14절**임

> 요구사항: [PRD.md](PRD.md) · 근거: [설계명세서.md](설계명세서.md) · 사용법: [README.md](README.md)
> 버전: **v2 (2026-11-26) · 상태: 구현 완료, 이 문서는 실제 소스 코드 기준** · 구현 모델: Claude Code **Sonnet 5.5** (기획·설계는 Opus)
> v1(구현 전 설계)과 달라진 점은 13절에 정리함
> 5차시 학생 제출 저장(테이블·RLS·서버 함수)은 14절에 있음(**구현됨 · 로컬에서 실제 Supabase로 시험 완료. Vercel 배포는 아직 실행 전**)

## 1. 기술 선택 요약
| 영역 | 선택 | 이유 |
|---|---|---|
| 화면 | **HTML + CSS + 순수 JavaScript(ES Modules)**, 빌드 도구 없음 | 연수 교사가 파일을 열어 읽을 수 있음. 4차시 슬라이드의 "내가 정한 HTML·CSS·JS" 방향 |
| 학습 자료 | `materials/*.md` 4종(기초·보통·심화·다문화) + `materials/activities.json` | 교사가 Claude Code 대화로 만들고 검토한 파일을 그대로 씀. **자료 생성에는 API를 쓰지 않음** |
| 마크다운 표시 | CDN `marked@12.0.2` + `dompurify@3.1.6` | md를 HTML로 바꾼 뒤 DOMPurify로 정리해서 화면에 넣음 |
| 서버 함수 | **`api/feedback.js` 1개** (Node.js 20+, `export default async function handler(req, res)`) | Gemini 키를 숨기는 유일한 자리. 소크라테스식 힌트만 담당 |
| AI | **Gemini Interactions API** (`POST /v1beta/interactions`), SDK 없이 `fetch` 호출 | npm 패키지 없이 동작. 응답을 JSON 스키마로 강제 |
| 모델 | 환경변수 `GEMINI_MODEL`, 기본값 **`gemini-3.5-flash-lite`** (`gemini-3.8-flash`로 바꿔 쓸 수 있음) | 무료 등급에서 빠르게 응답. 모델명은 연수 당일 AI Studio에서 다시 확인 |
| 추론 강도 | 환경변수 `GEMINI_THINKING_LEVEL`, 기본값 **`low`** | 두 모델 공통으로 쓸 수 있는 값 |
| 로컬 실행 | `dev-server.mjs` (`npm run dev`, 외부 패키지 없음) | 정적 파일 + `/api/feedback`을 한 번에 실행 |
| 기기 저장 | **쓰지 않음** (`localStorage`·쿠키 없음) | 집중 기록·답·힌트는 메모리에만 두고 화면에만 표시 |
| 배포 | GitHub 저장소 → **Vercel**(화면·서버 함수). DB는 **Supabase** | 서버 함수가 Node 형식이라 코드 변경 없이 올림. 상세는 11절 |

외부 의존성
- 브라우저(CDN, 정확한 버전 고정): `marked@12.0.2`, `dompurify@3.1.6`
- 서버: **없음** (`package.json`에 dependencies 없음, `engines.node >= 20`)

## 2. 폴더 구조
```
level-reader/                  # package.json의 name
├─ index.html                  # 학생 화면: 수준 선택 → 읽기 → 집중 모드 → 활동·형성평가·힌트
├─ css/style.css
├─ js/
│  ├─ app.js                   # 화면 전환, materials/*.md 읽기·표시, 다문화 모드 전환
│  ├─ reader-tools.js          # 글자 크기 3단계, 음성 읽어 주기(TTS), 다문화 낱말 밑줄·뜻 말풍선
│  ├─ focus.js                 # 집중 모드(전체 화면·이탈 감지·집중 시간)
│  └─ activities.js            # 본문 중간 활동, 형성평가, 서술형 힌트 요청 UI
├─ materials/
│  ├─ 기초.md · 보통.md · 심화.md · 다문화.md
│  ├─ activities.json          # 수준별 활동·형성평가 문항과 정답
│  └─ 원문대비_변경점.md        # 교사 검토용
├─ api/
│  └─ feedback.js              # 서버 함수: POST /api/feedback (mode = hint)
├─ dev-server.mjs              # 로컬 개발 서버(포트 5173)
├─ package.json                # scripts.dev = node dev-server.mjs
├─ .env.example                # 환경변수 견본(진짜 키 금지)
├─ .env.local                  # (로컬 전용) 실제 키 — .gitignore로 제외
├─ .gitignore                  # .env, .env.* 제외(.env.example만 허용)
├─ 원문_트랜스포머_v1.md · 원문_트랜스포머_v2.md
└─ 설계명세서.md · PRD.md · TRD.md · README.md
```

## 3. 아키텍처와 데이터 흐름
```
[교사 — Claude Code 대화, API 사용 안 함]
   원문_트랜스포머_v2.md ─▶ 기초·보통·심화·다문화.md + activities.json 생성 ─▶ 교사 검토 ─▶ 커밋·푸시

[학생 브라우저 index.html]
   수준 카드 선택 ─▶ GET materials/{수준}.md ─▶ marked → DOMPurify → 화면
                 └▶ GET materials/activities.json ─▶ 본문 중간 활동·형성평가(브라우저에서 채점)
   서술형 [💡 힌트 받기] ─(POST /api/feedback {mode:"hint", step, …})─▶ [서버 함수 api/feedback.js]
                                                                       │  GEMINI_API_KEY (환경변수)
                                                                       ▼
                                                    [Gemini Interactions API  POST /v1beta/interactions]
   ◀────────────── 200 { step, hint } ◀── JSON 파싱 · 정답 누출 검사(최대 2회 호출) ◀──┘
```
- **Gemini를 부르는 곳은 서술형 힌트 1곳뿐**임. 수준 변환·다문화 자료는 미리 만든 md 파일을 읽음
- 객관식·골라 넣기·빈칸·중요 단어 찾기·서술형 핵심어 점검은 모두 브라우저에서 채점함(서버 호출 없음)

## 4. 데이터 형식
### 4-1. 수준별 자료 `materials/*.md`
| 파일 | 수준 키 | 표시 |
|---|---|---|
| `기초.md` | `basic` | 기초 |
| `보통.md` | `normal` | 보통 |
| `심화.md` | `advanced` | 심화 |
| `다문화.md` | `multicultural` | 다문화(쉬운 한국어, 줄바꿈 유지) |

학생 화면에 넣기 전에 `app.js`가 잘라 내는 부분
- 맨 위 `>` 안내 인용문(대상·원문 링크)
- `## 확인 질문` 절부터 끝까지(형성평가는 `activities.json`이 대신함)
- `### 정답(교사용)` 절부터 끝까지

다문화 낱말 풀이: 본문의 `## … 낱말 풀이 …` 제목 바로 뒤 표를 읽음. 열 제목에서 "베트남어"·"중국어"를 찾아 언어별 뜻 열로 씀

### 4-2. 활동·형성평가 `materials/activities.json`
```json
{
  "version": 1,
  "note": "…",
  "levels": {
    "normal": {
      "inline": [
        { "id": "n-i1", "after": "2", "type": "choice", "title": "하나 고르기",
          "q": "…", "options": ["…", "…", "…", "…"], "answer": 0, "explain": "… (2절)" }
      ],
      "quiz": [
        { "id": "n-q5", "type": "essay", "q": "…",
          "keyPoints": [ { "label": "다음 단어를 예측함", "any": ["예측"] } ],
          "model": "모범 답안 문장", "explain": "(5절)" }
      ]
    }
  }
}
```
| 필드 | 규칙 |
|---|---|
| `levels` | `basic`·`normal`·`advanced`·`multicultural` 4개 |
| `inline` | 본문 중간 활동 4개. `after`는 몇 번째 절 뒤에 넣을지(절 번호 문자열) |
| `quiz` | 형성평가 5개: `choice`, `choice`, `select`, `blank`, `essay` |
| `type` | `choice`(하나 고르기) · `select`(골라 넣기) · `blank`(빈칸 채우기) · `highlight`(중요 단어 찾기) · `essay`(서술형) |
| `answer` | 0부터 시작하는 보기 번호 |
| `keyPoints` | 서술형 핵심어 점검용. `label`은 힌트 요청에 보내는 핵심 내용, `any`는 학생 답에서 찾을 낱말 목록 |
| `model` | 서술형 모범 답안. 힌트 요청의 `modelAnswer`로 보내 정답 누출 검사에 씀 |

### 4-3. 브라우저 상태
- 받은 힌트, 집중 시간·이탈 횟수, 답과 점수는 **메모리에만** 둠. 새로고침하면 사라짐
- `localStorage`·`sessionStorage`·쿠키를 쓰지 않음

## 5. 서버 API 명세 — `POST /api/feedback`
### 5-1. 공통
- 요청·응답 `Content-Type: application/json`. 응답 헤더 `Cache-Control: no-store`
- `POST`가 아니면 405 `METHOD_NOT_ALLOWED` + `Allow: POST`
- 키: `process.env.GEMINI_API_KEY`(앞뒤 공백 제거). 없으면 500 `NO_KEY`
- 요청 본문이 문자열이면 서버에서 `JSON.parse`. 실패하면 400 `BAD_REQUEST`
- 서버는 원문·학생 답·질문을 로그에 남기지 않음. 오류 로그에는 HTTP 상태와 모델 이름만 남김

### 5-2. 요청
```json
{
  "mode": "hint",
  "step": 1,
  "level": "normal",
  "lang": null,
  "question": "서술형 질문",
  "keyPoints": ["다음 단어를 예측함", "예측한 단어를 다시 입력에 붙임"],
  "studentAnswer": "학생이 지금까지 쓴 답(빈칸 가능)",
  "studentQuestion": "학생이 AI에게 물어본 궁금한 점(빈칸이면 바로 힌트)",
  "previousHints": [],
  "body": "지금 읽는 수준의 본문 텍스트",
  "modelAnswer": "모범 답안 — 누출 검사용"
}
```
| 필드 | 검사 규칙(`validate()`) | 브라우저에서 넣는 값 |
|---|---|---|
| `mode` | `"hint"`만 허용 | 고정값 |
| `step` | 1·2·3 중 하나 | 받은 힌트 수 + 1 |
| `level` | `basic`·`normal`·`advanced`·`multicultural` | 지금 수준 |
| `lang` | `null`/생략, 또는 `vi`·`zh`·`ru`·`en`·`mn` | 다문화 수준일 때만 언어 선택값(`vi`·`zh`), 그 밖에는 `null` |
| `question` | 문자열, 500자 이하, 빈칸 금지 | `item.q` |
| `keyPoints` | 배열 6개 이하, 각 100자 이하 | `item.keyPoints[].label` |
| `studentAnswer` | 1,000자 이하(생략 가능) | 답 칸 값(앞 1,000자) |
| `studentQuestion` | 300자 이하(생략 가능) | 질문 칸 값(입력 칸도 `maxlength=300`) |
| `previousHints` | 길이가 정확히 `step - 1`, 각 500자 이하 | 이미 받은 힌트 |
| `body` | 8,000자 이하(생략 가능) | 화면 본문에서 활동·표를 뺀 텍스트(앞 8,000자) |
| `modelAnswer` | 600자 이하(생략 가능) | `item.model` |

### 5-3. 응답 `200`
```json
{ "step": 1, "hint": "모델이 다음 단어를 고를 때 무엇을 보고 고를까요?" }
```

### 5-4. 힌트 단계 규칙(시스템 지시문에 들어가는 문장)
| 단계 | 규칙 |
|---|---|
| 1 되묻기 | 학생의 답을 보고 생각을 여는 질문을 하나만 함. 개념 이름을 직접 알려 주지 않음 |
| 2 단서 | 학생 답에 빠진 핵심 개념 하나를 낱말 단서로만 제시하고, 그 낱말을 넣어 다시 써 보라고 안내함 |
| 3 본문 위치 | 답이 들어 있는 본문 위치(몇 번째 절, 어떤 낱말 근처)를 짚고 그 부분을 다시 읽어 보라고 안내함 |

### 5-5. 정답 누출 방지
1. 힌트와 `modelAnswer`에서 공백과 `.,!?'"()`를 지움
2. 모범 답안을 15자 창으로 3자씩 밀면서 잘라, 그 조각이 힌트 안에 그대로 있으면 누출로 판단
3. 누출이면 "모범 답안의 표현을 하나도 쓰지 말고 질문 형태로만 답하라"는 문장을 더해 **1회 다시 호출**
4. 다시 누출이면 단계별 대체 힌트를 씀

| 단계 | 대체 힌트 |
|---|---|
| 1 | 질문이 무엇을 묻는지 한 번 더 읽어 볼까요? 본문에서 비슷한 낱말을 찾아보세요. |
| 2 | 본문에 나온 핵심 낱말을 하나 골라 넣어서 다시 써 볼까요? |
| 3 | 본문에서 질문과 같은 낱말이 나오는 절을 다시 읽어 볼까요? |

- 힌트 1번 요청에 Gemini 호출은 **최대 2회**

### 5-6. 오류 응답과 화면 안내
| HTTP | `error` | 발생 조건 | 화면 안내(`activities.js` `HINT_ERRORS`) |
|---|---|---|---|
| 400 | `BAD_REQUEST` (+ `detail`) | 5-2 검사 실패, JSON 파싱 실패 | 요청 형식이 맞지 않아요. |
| 405 | `METHOD_NOT_ALLOWED` | POST가 아님 | 기본 문구 |
| 500 | `NO_KEY` | `GEMINI_API_KEY` 없음 | 서버에 GEMINI_API_KEY가 없어요. .env.local 또는 배포 환경변수를 확인해 주세요. |
| 429 | `RATE_LIMIT` | Gemini가 429 반환 | 요청이 많아요. 30초쯤 뒤에 다시 눌러 주세요. |
| 502 | `BAD_KEY` | Gemini 400·401·403 + 오류 본문에 api key·unauthenticated·permission | API 키가 올바르지 않아요. AI Studio에서 키를 다시 확인해 주세요. |
| 502 | `AI_ERROR` | 그 밖의 Gemini 오류, 네트워크 실패 | 기본 문구 |
| 502 | `BAD_AI_OUTPUT` | 출력이 JSON이 아니거나 `hint`가 비어 있음(재시도 없음) | 기본 문구 |
| 504 | `TIMEOUT` | Gemini 응답 25초 초과(`AbortController`) | 힌트를 만드는 데 시간이 오래 걸려요. 다시 눌러 주세요. |
| 500 | `AI_ERROR` | 예상하지 못한 서버 오류 | 기본 문구 |
| — | `NO_SERVER` | JSON이 아닌 404·405·501 응답(정적 서버로 연 경우) | 힌트 서버가 켜져 있지 않아요. 로컬 개발 서버(npm run dev)로 실행했는지 확인해 주세요. |
| — | `NETWORK` | `fetch` 자체 실패 | 인터넷 연결을 확인해 주세요. |

- 기본 문구: "힌트를 받지 못했어요. 잠시 뒤 다시 눌러 주세요."
- 로컬 개발 서버는 요청 본문이 1MB를 넘으면 413 `SERVER_ERROR`를 돌려줌

## 6. Gemini 호출 세부 (`callGemini()`)
요청
```http
POST https://generativelanguage.googleapis.com/v1beta/interactions
Content-Type: application/json
x-goog-api-key: {GEMINI_API_KEY}
Api-Revision: 2026-05-20
```
```json
{
  "model": "gemini-3.5-flash-lite",
  "system_instruction": "…7절 시스템 지시문…",
  "input": "…7절 사용자 입력…",
  "store": false,
  "generation_config": { "max_output_tokens": 1024, "thinking_level": "low" },
  "response_format": {
    "type": "text",
    "mime_type": "application/json",
    "schema": {
      "type": "object",
      "properties": { "hint": { "type": "string" } },
      "required": ["hint"],
      "additionalProperties": false
    }
  }
}
```
| 항목 | 값 | 비고 |
|---|---|---|
| 키 전달 | `x-goog-api-key` 헤더 | 주소(쿼리 문자열)에 키를 넣지 않음 |
| `store` | `false` | 학생 답·본문을 Gemini 쪽에 저장하지 않음 |
| `temperature` 등 샘플링 값 | 보내지 않음 | 지원 중단된 파라미터라 제거함 |
| `max_output_tokens` | 1024 | 힌트는 1~2문장 |
| 제한 시간 | 25초 | 넘으면 504 `TIMEOUT` |

응답 처리
- `steps[]` 가운데 `type: "model_output"`인 항목의 `content[]`에서 `type: "text"` 글을 모두 이어 붙임
- 이어 붙인 글을 `JSON.parse` → `hint` 문자열을 앞뒤 공백 없이 반환

모델·추론 강도 설정(`resolveConfig()`)
| 환경변수 | 기본값 | 허용값 | 규칙 |
|---|---|---|---|
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | 예: `gemini-3.5-flash-lite`, `gemini-3.8-flash` | 비우면 기본값 |
| `GEMINI_THINKING_LEVEL` | `low` | `minimal`·`low`·`medium`·`high` | 그 밖의 값·빈칸은 `low`. `gemini-3.8-flash`는 `minimal`을 지원하지 않아 `low`로 바꿈 |

## 7. 프롬프트 설계 (`buildPrompt()`)
시스템 지시문(`system_instruction`)은 아래 줄을 차례로 이어 붙임(해당 없는 줄은 뺌)
1. 너는 대한민국 고등학교 2학년 학생을 돕는 소크라테스식 튜터다.
2. 정답이나 모범 답안 문장을 절대 그대로 말하지 않는다. 학생이 스스로 답을 찾도록 돕는다.
3. 본문에 없는 사실·수치를 지어내지 않는다.
4. 1~2문장, 존댓말("~해 볼까요?")로 쓴다. 칭찬은 학생 답에 맞는 내용이 있을 때만 한 구절로 한다.
5. 학생 수준: {기초·보통·심화·다문화(쉬운 한국어)}.
6. (다문화일 때) 쉬운 한국어로 짧게 쓰고, 핵심 낱말 바로 뒤 괄호에 {베트남어·중국어} 뜻을 적는다.
7. 5-4의 단계 규칙 1줄
8. (학생 질문이 있을 때) 학생의 질문에 초점을 맞추어 답하되, 정답을 직접 알려 달라고 요구하면 절대 정답을 말하지 말고 스스로 생각해 보도록 되묻는다.
9. (누출 재시도일 때) 모범 답안의 표현을 하나도 쓰지 말고 질문 형태로만 답하라.
10. 출력은 {"hint": "..."} JSON 하나만.

사용자 입력(`input`)
```
[질문] …
[채점 핵심] 핵심1 / 핵심2 / …
[학생의 지금 답] … 또는 (아직 안 씀)
[학생이 AI에게 물어본 궁금한 점] …        ← 질문이 있을 때만
[이미 준 힌트] 1) … 2) …                  ← 2·3단계일 때만
[모범 답안 — 참고만 하고 그대로 쓰지 말 것] … 또는 (없음)
[본문] … 또는 (없음)
```

## 8. 학생 화면 동작
### 8-1. 힌트 UI (`activities.js` `buildEssay()`)
- 서술형 문항마다 질문 입력 칸(최대 300자) + [💡 힌트 받기 (n/3)] 버튼
- 질문 칸에서 Enter로도 요청(한글 조합 중에는 무시)
- 문항당 최대 3회. 다 쓰면 "💡 힌트를 모두 썼어요"로 바뀌고 버튼·입력 칸이 잠김
- 받은 힌트는 "내 질문"과 함께 목록으로 쌓임. 화면에 넣을 때 `textContent` 사용(`innerHTML` 금지)
- 요청 중 안내: "질문에 맞는 힌트를 만드는 중…" / "힌트를 만드는 중…"

### 8-2. 집중 모드 (`focus.js`)
| 기능 | 구현 |
|---|---|
| 시작 | [집중 시작] 클릭 안에서 `requestFullscreen()`. 미지원 기기는 전체 화면 없이 진행하고 안내 문구 표시 |
| 이탈 감지 | 마우스가 창 밖으로 나감(`mouseout`, 언어 선택 목록이 열릴 때는 제외) / 다른 탭·창(`visibilitychange`, `window blur`) / 전체 화면 해제(`fullscreenchange`) |
| 안내 | "이탈 N번째" 배지와 이유별 안내. 마우스는 돌아오면 자동으로 닫히고, 탭·전체 화면은 버튼으로 복귀 |
| 우선순위 | 전체 화면 해제 > 탭 이동 > 마우스 |
| 시간 계산 | `setInterval` 횟수가 아니라 `Date.now()` 시각 차이로 계산. 집중 시간 = 경과 시간 − 이탈 시간 합 |
| 종료 | [집중 끝내기] → 전체 화면 해제 → "집중 시간 mm:ss · 이탈 N회 — 이 기록은 화면에만 보이고 저장되지 않아요." |

### 8-3. 읽기 도구 (`reader-tools.js`)
- 글자 크기: 보통 → 크게 → 아주 크게 순환
- 읽어 주기: 브라우저 `speechSynthesis`(한국어 `ko-KR`)
- 다문화 모드: 낱말 풀이 표의 낱말에 밑줄 → 누르면 쉬운 뜻·모국어 뜻 말풍선, 발음 듣기(`vi-VN`·`zh-CN`)

## 9. 보안·비용 통제
| 항목 | 방법 |
|---|---|
| 키 보관 | 로컬은 `.env.local`(`.env.example`을 복사해 작성), 배포는 Vercel 환경변수. 코드·대화창·저장소에 키를 쓰지 않음 |
| 저장소 보호 | `.gitignore`에 `.env`, `.env.*` 제외(`.env.example`만 허용). 첫 커밋 전에 확인 |
| 소스·비밀 파일 열람 차단 | `dev-server.mjs`가 `/.`로 시작하거나 `/.`가 들어 있는 경로, `/api/` 아래 파일을 403으로 막음. 폴더 밖 경로도 403 |
| 키 노출 점검 | 개발자 도구 Sources·Network에서 키 앞부분 검색, GitHub 저장소 검색 → 0건 |
| 학생 정보 | 이름·번호 입력 칸 없음. 서버 로그에 본문·답을 남기지 않음. Gemini에도 `store: false` |
| 입력 크기 | 5-2 표의 글자 수 제한, 로컬 서버 요청 본문 1MB 상한 |
| 호출 횟수 | 서술형 문항당 힌트 3회(브라우저 기준), 요청 1번에 Gemini 최대 2회 |
| 알려진 한계 | 정답·모범 답안이 `activities.json`과 힌트 요청에 들어 있어 개발자 도구로 볼 수 있음 → 4차시는 허용, 5차시 "화면에 안 보임 ≠ 접근 불가"(RLS) 수업 사례로 씀. 힌트 횟수 제한도 브라우저 기준이라 새로고침하면 다시 3회가 됨 |
| 화면 출력 | md는 DOMPurify로 정리한 뒤 넣고, AI 응답은 `textContent`로만 넣음 |

## 10. 로컬 개발
1. Node.js 20 이상 확인(외부 npm 패키지 설치 없음)
2. `.env.example`을 복사해 `.env.local` 만들기 → `GEMINI_API_KEY`에 AI Studio 키 입력. `GEMINI_MODEL`·`GEMINI_THINKING_LEVEL`은 비워 두면 기본값
3. `npm run dev` → `http://127.0.0.1:5173` (포트·주소는 `PORT`·`HOST` 환경변수로 바꿀 수 있음)
4. 서버 시작 로그에서 "모델: … | GEMINI_API_KEY: 설정됨" 확인
- `.env`와 `.env.local`을 모두 읽고, 같은 이름은 `.env.local` 값이 우선함
- `index.html`을 파일로 직접 열면(`file://`) 자료를 읽지 못함 → 반드시 로컬 서버 주소로 열기

## 11. 배포 (Vercel)와 DB (Supabase)
### 11-1. 역할
| 서비스 | 맡는 일 | 우리 앱에서 |
|---|---|---|
| GitHub | 코드 보관 | Vercel이 저장소를 가져가 배포 |
| **Vercel** | 화면과 서버 함수 호스팅(배포) | `index.html`·`teacher.html`·`materials/`·`api/*.js` |
| **Supabase** | DB(표 저장·조회, RLS) | `answers`·`questions` |
- 서버 함수가 환경변수의 secret key로 Supabase에 접근한다. 브라우저는 Supabase에 직접 접근하지 않는다
- Supabase는 화면을 올리는 용도가 아니다. Edge Functions(Deno)도 쓰지 않는다

### 11-2. 5차시 진행 순서
4차시는 로컬 테스트로 끝나 있고, 5차시는 아래 순서로 진행한다.
1. **Vercel 배포**: Claude Code 프롬프트로 GitHub 저장소를 Vercel에 배포. `GEMINI_API_KEY`는 Vercel 환경변수에 등록(값은 직접 입력, 대화에 쓰지 않음)
2. **배포 확인**: 배포 주소 접속, 수준 선택·집중 모드·힌트 동작, 휴대폰 접속, 키 노출 점검
3. **Supabase 준비**: 가입, 프로젝트 생성(지역·DB 비밀번호), 설계 문서 수정
4. **DB 완료**: `supabase/migrations/20261126113000_create_answers_questions.sql`을 SQL Editor에서 실행(표 2개, RLS), Project URL·secret key를 `.env.local`에 입력해 로컬 시험
5. **배포 및 점검·테스트**: `SUPABASE_URL`·`SUPABASE_SECRET_KEY`·`TEACHER_CODE`를 Vercel 환경변수에 등록 → 재배포 → 배포 주소에서 저장·조회 테스트, 다른 기기 확인, 키 노출 점검

### 11-3. 주의
- 환경변수를 새로 등록·변경했으면 **재배포**해야 반영된다(등록만 하면 이전 배포에는 적용되지 않음)
- `.env.local`은 GitHub에 올라가지 않으므로 배포 환경에는 Vercel 환경변수로 따로 등록해야 한다
- Vercel의 `api/` 폴더 규칙(`_`로 시작하는 파일 처리 등), 정적 파일 제공 방식, 환경변수 메뉴 이름은 **당일 공식 문서로 확인**
- `SUPABASE_SECRET_KEY`에 publishable key(`sb_publishable_…`)를 넣으면 저장이 거부된다. `sb_secret_…`로 시작하는지 확인

## 12. 테스트 계획
자동 테스트 도구는 두지 않고 아래 시나리오를 직접 확인함. 2026-11-26 로컬에서 1·2·5·9번을 `gemini-3.5-flash-lite` 실제 호출로 확인함
| # | 시나리오 | 기대 결과 |
|---|---|---|
| 1 | 서술형에 질문 입력 후 [힌트 받기] | 질문에 맞춘 1단계 되묻기 힌트, 정답 문장 없음 |
| 2 | 질문 칸에 "그냥 정답 알려주세요" | 정답을 말하지 않고 2단계 단서로 되물음 |
| 3 | 질문 없이 힌트 3번 | 1→2→3단계 내용이 다르고, 4번째는 버튼이 잠김 |
| 4 | 다문화 수준 + 중국어 선택 후 힌트 | 쉬운 한국어 + 핵심 낱말 뒤 괄호에 중국어 뜻 |
| 5 | 힌트 요청 중 콘솔 확인 | 콘솔 오류 0건 |
| 6 | `.env.local`에서 키를 지우고 서버 재시작 후 힌트 | "서버에 GEMINI_API_KEY가 없어요…" |
| 7 | 키를 틀린 값으로 바꾸고 힌트 | "API 키가 올바르지 않아요…" |
| 8 | `python -m http.server` 같은 정적 서버로 열고 힌트 | "힌트 서버가 켜져 있지 않아요…" |
| 9 | 브라우저에서 `/.env.local`, `/api/feedback.js` 직접 열기 | 403 Forbidden |
| 10 | 집중 시작 → 다른 탭 10초 → 복귀 | "이탈 1번째", 집중 시간이 약 10초 덜 늘어남 |
| 11 | 키 노출 점검(9절) | 키 문자열 검색 결과 0건 |

## 13. v1 설계와 달라진 점
| v1 설계(구현 전) | v2 실제 구현 | 이유 |
|---|---|---|
| 교사 화면 `index.html`에서 원문 → Gemini로 3수준 변환(`mode: "convert"`) | 교사가 Claude Code 대화로 `materials/*.md`를 만들고 검토 | 자료 생성에는 API가 필요 없음. API는 힌트 1곳만 쓰기로 결정 |
| 학생 기기에서 다문화 자료를 Gemini로 생성(`mode: "multicultural"`) | 미리 만든 `다문화.md` 사용 | 같은 이유. 교사가 검토한 자료만 학생에게 보여 줌 |
| `learn.html?id=…` 공유 링크·QR, `api/materials.js` + 저장소(ShareDoc) | 구현하지 않음. 자료는 저장소의 `materials/` 폴더에서 바로 읽음 | 4차시 범위 축소. 자료 저장은 5차시 Supabase에서 다룸 |
| `generateContent` + `gemini-2.5-flash` + `temperature` | Interactions API + `gemini-3.5-flash-lite`(기본) + `thinking_level` | 최신 API로 전환, 지원 중단 파라미터 제거 |
| 확인 질문 3개(choice·choice·essay) | 본문 중간 활동 4개 + 형성평가 5개(choice·choice·select·blank·essay) | 수업 활동을 늘림 |
| 학생 질문 없음 | 서술형 질문 입력(300자) + 정답 요구 시 되묻기 | 학생이 궁금한 점을 직접 묻게 함 |
| `localStorage`에 힌트·집중 기록 저장 | 저장하지 않음(메모리만) | 학생 기록을 남기지 않는 원칙 |
| 누출 검사: `evidence` 문장 20자 일치 | 모범 답안 15자 창(3자 간격) 일치, 2회 누출 시 대체 힌트 | 실제 문항 데이터(`model`)에 맞춤 |

## 14. 5차시 확장 — 학생 제출 저장 (구현됨 · 로컬 시험 완료)
요구사항: [PRD.md](PRD.md) 5-7절 · 개인정보 원칙: [설계명세서.md](설계명세서.md) 10절

### 14-1. 변경 요약
| 지금(4차시) | 5차시에 바뀌는 것 |
|---|---|
| 답·점수·힌트가 화면에만 있음 | `answers`(확인 질문 답)·`questions`(학생 질문, `hint_step`) 테이블에 저장. 서버 함수 `api/submit.js` |
| 교사가 결과를 볼 수 없음 | `teacher.html` + `api/results.js`, 교사 코드(`TEACHER_CODE`) 확인 |
| 학생을 구분하는 값이 없음 | 시작 화면에 **반 코드·학번** 입력(실명 입력 없음) |
| 힌트 횟수 제한이 브라우저 기준 | 그대로 유지(DB 기준 제한은 열린 질문) |
| 환경변수 `GEMINI_API_KEY` 1개 | `SUPABASE_URL`·`SUPABASE_SECRET_KEY`·`TEACHER_CODE` 추가 |
- `api/feedback.js`의 요청 형식(5-2)은 그대로 둠. 질문 저장은 `api/feedback.js`가 아니라 **브라우저가 힌트를 받은 뒤 `api/submit.js`를 따로 호출**해서 함(힌트 기능과 저장 기능을 분리해, 저장이 실패해도 힌트는 그대로 동작)

### 14-2. 데이터 모델 (Postgres)
SQL 파일: `supabase/migrations/20261126113000_create_answers_questions.sql` (Supabase SQL Editor에 붙여넣어 실행)

`answers` — 확인 질문(형성평가) 답
| 열 | 타입 | 규칙 | 설명 |
|---|---|---|---|
| `id` | bigint | 자동 증가, 기본 키 | 행 번호 |
| `class_code` | text | 필수, `^[0-9A-Za-z-]{1,20}$` | 반 코드(예: `1-3`) |
| `student_no` | text | 필수, `^[0-9]{1,10}$` | 학번(숫자만, 실명 대신) |
| `level` | text | 필수, `basic`·`normal`·`advanced`·`multicultural` | 고른 수준(4-1절 키와 같음) |
| `question_no` | smallint | 필수, 1~5 | 형성평가 문항 번호 |
| `answer` | text | 필수, 1~1,000자 | 학생 답(고르기는 고른 보기 글, 골라 넣기·빈칸은 입력값, 서술형은 쓴 글) |
| `created_at` | timestamptz | 필수, 기본값 `now()` | 제출 시각(자동) |

`questions` — 학생이 AI에게 한 질문
| 열 | 타입 | 규칙 | 설명 |
|---|---|---|---|
| `id` | bigint | 자동 증가, 기본 키 | 행 번호 |
| `class_code` | text | 필수, 위와 같음 | 반 코드 |
| `student_no` | text | 필수, 위와 같음 | 학번 |
| `level` | text | 필수, 위와 같음 | 읽던 수준 |
| `question_text` | text | 필수, 1~300자 | 학생 질문(힌트 요청의 `studentQuestion`과 같은 한도) |
| `hint_step` | smallint | 필수, 1~3 | 그 질문으로 받은 힌트 단계 |
| `created_at` | timestamptz | 필수, 기본값 `now()` | 질문 시각(자동) |

- 이름·연락처·이메일·학교명을 담는 열은 **두지 않음**
- 같은 학생이 다시 채점하면 `answers`에 줄이 더 쌓임(덮어쓰지 않고 이력을 남김)
- 조회용 인덱스: 두 테이블 모두 `(class_code, student_no, created_at)`
- 제약(`check`)은 서버 함수 검사와 같은 규칙을 DB에도 한 번 더 둠 → 서버 함수가 잘못 만들어져도 형식에 맞지 않는 값은 저장되지 않음

### 14-3. 접근 권한 (RLS)
- 두 테이블 모두 `enable row level security`
- **`create policy`를 쓰지 않음** → 브라우저용 키(publishable key, `anon`·`authenticated` 역할)로는 읽기·쓰기가 모두 거부됨
- `anon`·`authenticated` 역할의 테이블 권한도 회수(`revoke all`)해 이중으로 막음
- 서버 함수는 secret key(`service_role`)로 접근함. 이 역할은 RLS를 우회하므로 정책이 없어도 서버 함수는 저장·조회가 됨
- secret key는 서버 함수 환경변수에만 두고 브라우저 코드·저장소·응답에 노출하지 않음

### 14-4. 서버 함수 `POST /api/submit`
구현: `api/submit.js` (공통 검사·Supabase 호출은 `api/_store.js`. 파일명이 `_`로 시작하면 경로로 열리지 않는 공통 도구). Supabase는 REST(`/rest/v1/{표}`)를 `fetch`로 호출하며 키는 `apikey` 헤더로만 보냄(예전 JWT 형식 키는 `Authorization`도 보냄)
공통: `Content-Type: application/json`, 응답 `Cache-Control: no-store`. 키 `SUPABASE_URL`·`SUPABASE_SECRET_KEY`가 없으면 500 `NO_STORE`. 서버는 답·질문을 로그에 남기지 않음

확인 질문 답 저장
```json
{
  "kind": "answers",
  "classCode": "1-3",
  "studentNo": "7",
  "level": "normal",
  "items": [
    { "questionNo": 1, "answer": "…" },
    { "questionNo": 5, "answer": "…" }
  ]
}
```
학생 질문 저장
```json
{
  "kind": "question",
  "classCode": "1-3",
  "studentNo": "7",
  "level": "normal",
  "questionText": "토큰이 뭔가요?",
  "hintStep": 1
}
```
| 항목 | 검사 규칙 |
|---|---|
| `kind` | `answers` 또는 `question` |
| `classCode` | 14-2 형식. 아니면 400 `BAD_REQUEST` |
| `studentNo` | 14-2 형식 |
| `level` | 4개 중 하나 |
| `items` | 1~5개, `questionNo` 1~5(중복 금지), `answer` 1~1,000자. 빈 답은 보내지 않음(브라우저에서 제외) |
| `questionText` | 1~300자 |
| `hintStep` | 1~3 |
| 요청 본문 | 20KB 이하, 넘으면 413 |

응답 `201`: `{ "saved": 2 }` (저장한 줄 수)
| HTTP | `error` | 발생 조건 | 화면 안내 |
|---|---|---|---|
| 400 | `BAD_REQUEST` | 검사 실패 | 반 코드와 학번을 확인해 주세요 |
| 405 | `METHOD_NOT_ALLOWED` | POST가 아님 | — |
| 413 | `TOO_LARGE` | 본문 20KB 초과 | — |
| 500 | `NO_STORE` | Supabase 환경변수 없음 | 저장 서버 설정을 확인해 주세요 |
| 502 | `STORE_ERROR` | Supabase 저장 실패 | 저장하지 못했어요. [다시 저장]을 눌러 주세요 |
- 저장이 실패해도 채점 결과·힌트는 화면에 그대로 보여 줌(PRD F-D7)

### 14-5. 서버 함수 `GET /api/results` (교사 조회)
- 요청: `GET /api/results?classCode=1-3` + 헤더 `x-teacher-code: {교사 코드}`
- 서버가 `TEACHER_CODE` 환경변수와 비교(길이가 같을 때 상수 시간 비교). 없거나 틀리면 401 `UNAUTHORIZED`. 코드는 주소(쿼리 문자열)에 넣지 않음
- 응답 `200`: `{ "classCode": "1-3" 또는 null, "classes": ["1-3", …], "answers": [ … ], "questions": [ … ] }` (`created_at` 내림차순, 표마다 최대 500줄. `classes`는 기록이 있는 반 코드 목록으로 화면의 거르기 목록에 씀)
- `classCode`를 생략하면 전체 반. 교사 코드가 없거나 틀리면 401, 서버에 `TEACHER_CODE`가 없으면 500 `NO_TEACHER_CODE`
- 반 코드 형식 검사는 14-4와 같음. 학생 화면(`index.html`)에서는 이 함수를 부르지 않음

### 14-6. 화면 변경
| 화면 | 변경 |
|---|---|
| `index.html` 시작 화면 | 반 코드·학번 입력 칸 추가. 안내 문구: "이름·연락처는 쓰지 않아요". 입력 전에는 저장 없이 읽기만 가능 |
| `js/activities.js` | 채점 후 `api/submit.js`(`kind: "answers"`) 호출, 힌트 성공 후 질문이 있으면 `kind: "question"` 호출 |
| `js/student.js`(새 파일) | 반 코드·학번 입력 검사(학번은 숫자만 남김), 저장 요청, 오류 안내 문구. 값은 입력 칸에만 있고 `localStorage`·쿠키에 저장하지 않음 |
| `teacher.html`·`js/teacher.js`(새 파일) | 교사 코드·반 코드 입력 → 답·질문 표. 실명 열 없음 |

### 14-7. 환경변수
| 이름 | 용도 | 비고 |
|---|---|---|
| `GEMINI_API_KEY` | 힌트(4차시) | 변경 없음 |
| `SUPABASE_URL` | 프로젝트 주소 | 서버 함수에서만 읽음 |
| `SUPABASE_SECRET_KEY` | 모든 권한 키 | 서버 함수에서만 읽음. 코드·대화창에 붙여넣지 않음 |
| `TEACHER_CODE` | 교사 조회 코드 | 교사가 정함. 저장소에 쓰지 않음 |
- `.env.example`에 이름만 추가하고 값은 비워 둠

### 14-8. 5차시 테스트 계획
| # | 시나리오 | 기대 결과 |
|---|---|---|
| 1 | 반 코드 `1-3`, 학번 `7`로 채점 | `answers`에 문항별 줄이 생기고 Table Editor에서 확인됨 |
| 2 | 질문을 입력해 힌트 받기 | `questions`에 질문·힌트 단계가 한 줄 저장됨. 질문을 비운 요청은 줄이 생기지 않음 |
| 3 | 학번에 이름(한글)·연락처 형태를 입력 | 400 `BAD_REQUEST`, 저장 안 됨 |
| 4 | 개발자 도구에서 publishable key로 `answers` 조회·삽입 | 권한 오류로 거부(빈 결과 또는 오류) |
| 5 | 휴대폰에서 제출 → PC 교사 화면에서 조회 | 같은 기록이 보임 |
| 6 | 교사 코드 없이 `/api/results` 호출 | 401 |
\1| 8 | 배포 주소(Vercel)에서 학생 화면 열기 → 힌트 받기 | 첫 화면이 열리고 힌트가 동작(`GEMINI_API_KEY`를 Vercel 환경변수에 등록) |
| 9 | Vercel 환경변수 4개 등록 → 재배포 → 배포 주소에서 제출·조회 | `answers`·`questions`에 줄이 생기고 교사 화면에서 같은 기록이 보임 |
| 10 | 휴대폰으로 제출 → PC 교사 화면에서 조회 | 같은 기록이 보임(다른 기기 확인) |

**시험 결과 (2026-11-26)**: 가짜 `fetch` 모의 시험 60개, 실제 Supabase(로컬 서버 경유) 24개 통과. 브라우저에서 반 코드·학번 입력 → 채점 저장 → 질문 저장 → 교사 화면 조회·거르기·저장 실패 후 [다시 저장]까지 확인. 시험 데이터(반 코드 `0-0`)는 삭제함. 아직 못 한 것: 위 3번 학번 이름 입력의 DB 직접 거부, **4번(publishable key로 직접 접근 거부)**, 5번(다른 기기 확인), Supabase 배포 환경

### 14-9. 열린 질문
- **정답률 집계(6차시)**: `answers`에 정오 열이 없음. 정답률이 필요하면 `is_correct` 열을 추가하거나 서버 함수에서 `activities.json`의 정답과 비교해 계산하는 방식을 6차시 전에 정함
- **정답 보호**: 정답이 `activities.json`에 그대로 있어 개발자 도구로 볼 수 있음. 정답을 DB로 옮겨 서버에서만 채점하는 방식은 범위가 커서 5차시 수업 사례로만 다룸
- **학번의 식별성**: 반 코드와 학번의 조합으로 학생을 알아볼 수 있음 → 실제 수업 적용 전에 학교 개인정보 처리 절차를 확인
- **힌트 횟수 DB 제한**: `questions` 기록으로 서버에서 3회를 세는 방식은 아직 설계하지 않음(지금은 브라우저 기준)
- **교사 코드 입력 횟수 제한 없음**: `/api/results`는 틀린 코드를 몇 번이든 시도할 수 있음. 실제 수업에 쓰기 전에 시도 횟수 제한을 둘지 정함
- **서버 함수 형식**: 서버 함수 3개(`feedback.js`·`submit.js`·`results.js`)는 Node 형식 그대로 Vercel에서 실행(11절). Vercel의 `api/` 규칙은 당일 공식 문서 확인
