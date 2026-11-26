// 서버 함수: POST /api/feedback — 소크라테스식 힌트 (Gemini Interactions API)
// API 키는 환경변수 GEMINI_API_KEY에서만 읽는다(코드·저장소·브라우저에 넣지 않음).
// 학생 답과 본문은 로그에 남기지 않으며, Interactions API에도 store: false로 저장하지 않는다.

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const ALLOWED_THINKING = new Set(['minimal', 'low', 'medium', 'high']);
const TIMEOUT_MS = 25000;

const LEVELS = ['basic', 'normal', 'advanced', 'multicultural'];
const LANG_NAMES = { vi: '베트남어', zh: '중국어', ru: '러시아어', en: '영어', mn: '몽골어' };
const LEVEL_NAMES = { basic: '기초', normal: '보통', advanced: '심화', multicultural: '다문화(쉬운 한국어)' };

const STEP_RULES = {
  1: '1단계(되묻기): 학생의 답을 보고 생각을 여는 질문을 하나만 한다. 개념 이름을 직접 알려 주지 않는다.',
  2: '2단계(단서): 학생 답에 빠진 핵심 개념 하나를 낱말 단서로만 제시하고, 그 낱말을 넣어 다시 써 보라고 안내한다.',
  3: '3단계(본문 위치): 답이 들어 있는 본문 위치(몇 번째 절, 어떤 낱말 근처)를 짚어 주고 그 부분을 다시 읽어 보라고 안내한다.',
};

// 대체 힌트: 정답이 새어 나간 응답을 두 번 받으면 이 문장을 쓴다
const FALLBACK = {
  1: '질문이 무엇을 묻는지 한 번 더 읽어 볼까요? 본문에서 비슷한 낱말을 찾아보세요.',
  2: '본문에 나온 핵심 낱말을 하나 골라 넣어서 다시 써 볼까요?',
  3: '본문에서 질문과 같은 낱말이 나오는 절을 다시 읽어 볼까요?',
};

/* ---------- 모델·추론 설정 ---------- */
function resolveConfig() {
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const envLevel = process.env.GEMINI_THINKING_LEVEL?.trim().toLowerCase();
  // gemini-3.8-flash는 minimal을 지원하지 않으므로 공통 호환 레벨인 low를 기본값으로 사용
  let thinkingLevel = ALLOWED_THINKING.has(envLevel) ? envLevel : 'low';
  if (model.startsWith('gemini-3.8-flash') && thinkingLevel === 'minimal') {
    thinkingLevel = 'low';
  }
  return { model, thinkingLevel };
}

/* ---------- 입력 검사 ---------- */
const isStr = (v, max) => typeof v === 'string' && v.length <= max;

function validate(body) {
  if (!body || body.mode !== 'hint') return 'mode는 hint만 지원합니다';
  const { step, level, lang, question, keyPoints, studentAnswer, studentQuestion, previousHints, body: text, modelAnswer } = body;
  if (![1, 2, 3].includes(step)) return 'step은 1~3';
  if (!LEVELS.includes(level)) return 'level 값 오류';
  if (lang !== null && lang !== undefined && !LANG_NAMES[lang]) return 'lang 값 오류';
  if (!isStr(question, 500) || !question.trim()) return 'question 오류';
  if (!Array.isArray(keyPoints) || keyPoints.length > 6 || !keyPoints.every((k) => isStr(k, 100))) return 'keyPoints 오류';
  if (!isStr(studentAnswer ?? '', 1000)) return 'studentAnswer는 1,000자 이하';
  if (!isStr(studentQuestion ?? '', 300)) return 'studentQuestion은 300자 이하';
  if (!Array.isArray(previousHints) || previousHints.length !== step - 1 || !previousHints.every((h) => isStr(h, 500))) return 'previousHints 길이는 step-1';
  if (!isStr(text ?? '', 8000)) return 'body는 8,000자 이하';
  if (!isStr(modelAnswer ?? '', 600)) return 'modelAnswer는 600자 이하';
  return null;
}

/* ---------- 프롬프트 ---------- */
function buildPrompt(b, strict) {
  const langRule = b.lang
    ? `학생은 다문화 학생이다. 쉬운 한국어로 짧게 쓰고, 핵심 낱말 바로 뒤 괄호에 ${LANG_NAMES[b.lang]} 뜻을 적는다. 예: 예측(뜻).`
    : '';
  const askText = b.studentQuestion?.trim() || '';
  const askRule = askText
    ? '학생이 궁금한 점을 직접 물어보았다. 학생의 질문에 초점을 맞추어 답하되, 정답을 직접 알려 달라고 요구하면 절대 정답을 말하지 말고 스스로 생각해 보도록 되묻는다.'
    : '';
  const system = [
    '너는 대한민국 고등학교 2학년 학생을 돕는 소크라테스식 튜터다.',
    '정답이나 모범 답안 문장을 절대 그대로 말하지 않는다. 학생이 스스로 답을 찾도록 돕는다.',
    '본문에 없는 사실·수치를 지어내지 않는다.',
    '1~2문장, 존댓말("~해 볼까요?")로 쓴다. 칭찬은 학생 답에 맞는 내용이 있을 때만 한 구절로 한다.',
    `학생 수준: ${LEVEL_NAMES[b.level]}.`,
    langRule,
    STEP_RULES[b.step],
    askRule,
    strict ? '주의: 직전 응답이 모범 답안과 너무 비슷했다. 모범 답안의 표현을 하나도 쓰지 말고 질문 형태로만 답하라.' : '',
    '출력은 {"hint": "..."} JSON 하나만.',
  ].filter(Boolean).join('\n');

  const user = [
    `[질문] ${b.question}`,
    `[채점 핵심] ${b.keyPoints.join(' / ')}`,
    `[학생의 지금 답] ${b.studentAnswer?.trim() || '(아직 안 씀)'}`,
    askText ? `[학생이 AI에게 물어본 궁금한 점] ${askText}` : '',
    b.previousHints.length ? `[이미 준 힌트] ${b.previousHints.map((h, i) => `${i + 1}) ${h}`).join(' ')}` : '',
    `[모범 답안 — 참고만 하고 그대로 쓰지 말 것] ${b.modelAnswer || '(없음)'}`,
    `[본문] ${b.body || '(없음)'}`,
  ].filter(Boolean).join('\n');

  return { system, user };
}

/* ---------- 정답 누출 검사: 모범 답안의 15자 이상 구절이 그대로 들어 있으면 누출 ---------- */
const norm = (s) => String(s).replace(/\s+/g, '').replace(/[.,!?'"()]/g, '');
function leaksAnswer(hint, modelAnswer) {
  if (!modelAnswer) return false;
  const h = norm(hint);
  const m = norm(modelAnswer);
  const WINDOW = 15;
  for (let i = 0; i + WINDOW <= m.length; i += 3) {
    if (h.includes(m.slice(i, i + WINDOW))) return true;
  }
  return false;
}

/* ---------- Interactions API 응답에서 텍스트 추출 ---------- */
function extractOutputText(data) {
  const steps = Array.isArray(data?.steps) ? data.steps : [];
  const text = steps
    .filter((s) => s?.type === 'model_output')
    .flatMap((s) => (Array.isArray(s.content) ? s.content : []))
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
  return text.trim();
}

/* ---------- Gemini Interactions API 호출 ---------- */
class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

async function callGemini(key, { system, user }) {
  const { model, thinkingLevel } = resolveConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
        'Api-Revision': '2026-05-20',
      },
      body: JSON.stringify({
        model,
        system_instruction: system,
        input: user,
        store: false,
        generation_config: {
          max_output_tokens: 1024,
          thinking_level: thinkingLevel,
        },
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: {
            type: 'object',
            properties: { hint: { type: 'string' } },
            required: ['hint'],
            additionalProperties: false,
          },
        },
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError(504, 'TIMEOUT');
    console.error('feedback: fetch failed', err?.name);
    throw new ApiError(502, 'AI_ERROR');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`feedback: Gemini API ${res.status} (model=${model})`);
    if (res.status === 429) throw new ApiError(429, 'RATE_LIMIT');
    if ([400, 401, 403].includes(res.status) && /api[_ ]?key|unauthenticated|permission/i.test(detail)) {
      throw new ApiError(502, 'BAD_KEY');
    }
    throw new ApiError(502, 'AI_ERROR');
  }

  const data = await res.json();
  const text = extractOutputText(data);
  try {
    const hint = JSON.parse(text)?.hint;
    if (typeof hint === 'string' && hint.trim()) return hint.trim();
  } catch { /* 아래에서 처리 */ }
  throw new ApiError(502, 'BAD_AI_OUTPUT');
}

/* ---------- 요청 처리 ---------- */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return res.status(500).json({ error: 'NO_KEY' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const invalid = validate(body);
  if (invalid) return res.status(400).json({ error: 'BAD_REQUEST', detail: invalid });

  try {
    let hint = await callGemini(key, buildPrompt(body, false));
    if (leaksAnswer(hint, body.modelAnswer)) {
      hint = await callGemini(key, buildPrompt(body, true));
      if (leaksAnswer(hint, body.modelAnswer)) hint = FALLBACK[body.step];
    }
    return res.status(200).json({ step: body.step, hint });
  } catch (err) {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.code });
    console.error('feedback: unexpected error', err?.name);
    return res.status(500).json({ error: 'AI_ERROR' });
  }
}
