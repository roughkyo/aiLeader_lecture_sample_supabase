// 서버 함수: GET /api/results — 교사 조회 (Supabase)
//  요청: GET /api/results            (헤더 x-teacher-code: 교사 코드)            → 전체 반
//        GET /api/results?classCode=1-3                                          → 그 반만
//  교사 코드가 환경변수 TEACHER_CODE와 같을 때만 기록을 돌려준다. 코드는 주소(쿼리)에 넣지 않고 헤더로 받는다.
//  응답: { classCode, classes: [반 코드 목록], answers: [...], questions: [...] } (각 표 최대 500줄, 최신순)
// 접속값은 환경변수 SUPABASE_URL·SUPABASE_SECRET_KEY에서만 읽는다. 자세한 규칙은 TRD.md 14절.

import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError, CLASS_CODE_RE, sendError, readStoreConfig, selectRows } from './_store.js';

const ROW_LIMIT = 500;
const CLASS_LIST_LIMIT = 1000;   // Supabase 기본 최대 행 수(1,000)에 맞춤

/** 길이가 달라도 같은 시간이 걸리도록 해시로 바꿔 비교 */
function sameCode(given, expected) {
  const a = createHash('sha256').update(String(given)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function readClassCode(req) {
  const raw = req.query?.classCode ?? new URL(req.url ?? '/', 'http://localhost').searchParams.get('classCode');
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !CLASS_CODE_RE.test(raw)) throw new ApiError(400, 'BAD_REQUEST', 'classCode 형식 오류');
  return raw;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const teacherCode = process.env.TEACHER_CODE?.trim();
    if (!teacherCode) throw new ApiError(500, 'NO_TEACHER_CODE');
    const cfg = readStoreConfig();
    if (!cfg) throw new ApiError(500, 'NO_STORE');

    const given = req.headers?.['x-teacher-code'];
    if (typeof given !== 'string' || !sameCode(given, teacherCode)) throw new ApiError(401, 'UNAUTHORIZED');

    const classCode = readClassCode(req);   // 검사를 통과한 값만 아래 질의에 들어간다
    const filter = classCode ? `&class_code=eq.${encodeURIComponent(classCode)}` : '';
    const list = `?select=*&order=created_at.desc&limit=${ROW_LIMIT}${filter}`;
    const codes = `?select=class_code&limit=${CLASS_LIST_LIMIT}`;

    const [answers, questions, ansCodes, quesCodes] = await Promise.all([
      selectRows(cfg, 'answers', list),
      selectRows(cfg, 'questions', list),
      selectRows(cfg, 'answers', codes),
      selectRows(cfg, 'questions', codes),
    ]);
    const classes = [...new Set([...ansCodes, ...quesCodes].map((r) => r.class_code))]
      .sort((x, y) => x.localeCompare(y, 'ko', { numeric: true }));

    return res.status(200).json({ classCode, classes, answers, questions });
  } catch (err) {
    return sendError(res, err, 'results');
  }
}
