// 서버 함수 공통(저장·조회용): 입력 검사 + Supabase REST 호출
// - 접속값은 환경변수 SUPABASE_URL·SUPABASE_SECRET_KEY에서만 읽는다(코드·저장소·브라우저에 넣지 않음).
// - secret key는 RLS를 우회하는 모든 권한 키이므로 이 파일을 쓰는 서버 함수에서만 사용한다.
// - 학생 답·질문은 로그에 남기지 않는다. 오류 로그에는 HTTP 상태와 표 이름, PostgREST 오류 코드만 남긴다.
// 파일명이 _로 시작하는 것은 "서버 함수(경로)가 아니라 공통 도구"라는 뜻이다.

export const LEVELS = ['basic', 'normal', 'advanced', 'multicultural'];
export const CLASS_CODE_RE = /^[0-9A-Za-z-]{1,20}$/;   // 반 코드(예: 1-3). 이름 같은 한글은 받지 않는다
export const STUDENT_NO_RE = /^[0-9]{1,10}$/;          // 학번(숫자만). 실명 대신 사용
export const MAX_BODY_CHARS = 20_000;
const REST_TIMEOUT_MS = 10_000;

export class ApiError extends Error {
  constructor(status, code, detail) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** 오류를 JSON 응답으로 바꾼다. 예상하지 못한 오류는 내용을 로그에 남기지 않고 이름만 남긴다. */
export function sendError(res, err, tag) {
  if (err instanceof ApiError) {
    const body = { error: err.code };
    if (err.detail) body.detail = err.detail;
    return res.status(err.status).json(body);
  }
  console.error(`${tag}: unexpected error`, err?.name);
  return res.status(500).json({ error: 'SERVER_ERROR' });
}

/** 요청 본문을 JSON 객체로 읽는다(문자열이든 이미 객체든). 20,000자를 넘으면 413. */
export function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_CHARS) throw new ApiError(413, 'TOO_LARGE');
    try { body = JSON.parse(body); } catch { body = null; }
  } else if (body && JSON.stringify(body).length > MAX_BODY_CHARS) {
    throw new ApiError(413, 'TOO_LARGE');
  }
  return body && typeof body === 'object' ? body : null;
}

const isStr = (v) => typeof v === 'string';

/** 반 코드·학번·수준 검사. 문제가 있으면 필드 이름이 든 문장, 없으면 null */
export function validateStudent(b) {
  if (!isStr(b.classCode) || !CLASS_CODE_RE.test(b.classCode)) return 'classCode 형식 오류';
  if (!isStr(b.studentNo) || !STUDENT_NO_RE.test(b.studentNo)) return 'studentNo 형식 오류';
  if (!LEVELS.includes(b.level)) return 'level 값 오류';
  return null;
}

/* ---------- Supabase REST ---------- */
export function readStoreConfig() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  return url && key ? { url, key } : null;
}

function headers({ key }, extra = {}) {
  const h = { apikey: key, 'Content-Type': 'application/json', ...extra };
  // 새 sb_secret_ 키는 apikey 헤더만 쓰고, 예전 JWT 형식 키(eyJ…)는 Authorization도 필요함
  if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
  return h;
}

async function rest(cfg, table, { method, query = '', body, prefer }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${cfg.url}/rest/v1/${table}${query}`, {
      method,
      signal: controller.signal,
      headers: headers(cfg, prefer ? { Prefer: prefer } : {}),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    console.error(`store: ${table} fetch failed`, err?.name);
    throw new ApiError(502, 'STORE_ERROR');
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    let code = '';
    try { code = (await res.json())?.code ?? ''; } catch { /* 본문이 JSON이 아님 */ }
    console.error(`store: ${method} ${table} → ${res.status} ${code}`);
    throw new ApiError(502, 'STORE_ERROR');
  }
  return res;
}

/** 행 여러 개를 한 번에 저장(반환값 없음) */
export async function insertRows(cfg, table, rows) {
  await rest(cfg, table, { method: 'POST', body: rows, prefer: 'return=minimal' });
}

/** 조회. query는 이미 검사한 값으로만 만든 문자열이어야 한다(예: '?select=*&limit=500') */
export async function selectRows(cfg, table, query) {
  const res = await rest(cfg, table, { method: 'GET', query });
  return res.json();
}
