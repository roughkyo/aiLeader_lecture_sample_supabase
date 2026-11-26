// 서버 함수: GET /api/stats — 우리 반 질문 보드 통계 조회 (Supabase)
//  요청: GET /api/stats?classCode=1-3               (헤더 x-teacher-code: 교사 코드) → 반 전체 통계 + 학번 목록
//        GET /api/stats?classCode=1-3&studentNo=7   → 위 내용 + 해당 학번의 질문·답 목록
//  보호 원칙:
//   - 교사 코드(TEACHER_CODE)가 일치할 때만 응답한다(SHA-256 + 상수 시간 비교).
//   - 학생 순위표·합계 점수·실명 필드를 계산하거나 반환하지 않는다.
//   - 학생 질문·답 원문은 로그에 남기지 않는다.
// 자세한 설계는 TRD.md 5절 참조.

import { createHash, timingSafeEqual } from 'node:crypto';
import {
  ApiError,
  CLASS_CODE_RE,
  STUDENT_NO_RE,
  normalizeStudentNo,
  sendError,
  readStoreConfig,
  selectRows,
} from './_store.js';

const CORE_LEVELS = ['basic', 'normal', 'advanced'];
const QUESTION_SCAN_LIMIT = 1000;
const STUDENT_LIST_LIMIT = 1000;
const STUDENT_DETAIL_LIMIT = 100;

// 끝 조사 목록 (긴 것부터 제거, 떼고 남은 글자가 2자 이상일 때만 적용)
const PARTICLES = [
  '이라는', '이란', '에서', '에게', '으로', '이랑', '부터', '까지',
  '은', '는', '이', '가', '을', '를', '의', '에', '로', '도', '와', '과', '란', '랑',
];

// 자주 나오는 질문용 불용어 (의문사·요청 표현 등)
const STOPWORDS = new Set([
  '뭐', '뭐가', '뭔가요', '뭐예요', '뭐에요', '무엇', '무엇인가요', '무엇이', '무슨',
  '왜', '어떻게', '어디', '언제', '누가', '어떤', '얼마나', '몇',
  '있나요', '인가요', '하나요', '되나요', '나요', '가요', '해요', '에요', '예요',
  '알려주세요', '알려줘', '알려줘요', '설명해주세요', '설명해줘', '그냥', '정말', '진짜',
  '이거', '저거', '그거', '여기', '저기', '거기', '이것', '그것', '저것',
  '뜻이', '뜻은', '차이가', '차이는', '달라요', '다른가요', '헷갈려요', '모르겠어요',
  '정답', '정답만', '힌트', '질문', '본문', '내용', '부분', '문장', '단어',
  'the', 'is', 'are', 'what', 'why', 'how', 'and', 'for', 'with',
]);

/** 길이가 달라도 같은 시간이 걸리도록 해시로 바꿔 비교 */
function sameCode(given, expected) {
  const a = createHash('sha256').update(String(given)).digest();
  const b = createHash('sha256').update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function getParam(req, name) {
  return req.query?.[name] ?? new URL(req.url ?? '/', 'http://localhost').searchParams.get(name);
}

function readRequiredClassCode(req) {
  const raw = getParam(req, 'classCode');
  if (typeof raw !== 'string' || !CLASS_CODE_RE.test(raw.trim())) {
    throw new ApiError(400, 'BAD_REQUEST', 'classCode 형식 오류');
  }
  return raw.trim();
}

function readOptionalStudentNo(req) {
  const raw = getParam(req, 'studentNo');
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new ApiError(400, 'BAD_REQUEST', 'studentNo 형식 오류');
  const trimmed = raw.trim();
  const normalized = normalizeStudentNo(trimmed);
  if (!/^[0-9]+$/.test(trimmed) || !STUDENT_NO_RE.test(normalized)) {
    throw new ApiError(400, 'BAD_REQUEST', 'studentNo 형식 오류');
  }
  return normalized;
}

function stripParticle(token) {
  // 영문·숫자 토큰은 조사를 떼지 않음
  if (/^[a-z0-9]+$/.test(token)) return token;
  for (const p of PARTICLES) {
    if (token.endsWith(p) && token.length - p.length >= 2) {
      return token.slice(0, -p.length);
    }
  }
  return token;
}

/**
 * 질문 목록에서 한글·영문 핵심 용어 상위 topN개를 집계한다.
 * - 한 질문 안에서 같은 용어는 1번만 센다.
 * - 영문은 대소문자를 묶어(소문자 기준) 집계한다.
 * - 건수 내림차순, 같으면 가나다순.
 */
export function extractKeywords(questionTexts, topN = 5) {
  const counts = new Map();
  for (const raw of questionTexts) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const nfc = raw.normalize('NFC');
    // 한글·영문·숫자 연속 구간만 토큰으로 추출 (구두점·따옴표·괄호·공백에서 분리)
    const parts = nfc.match(/[가-힣A-Za-z0-9]+/g) ?? [];
    const seenInQuestion = new Set();
    for (const part of parts) {
      const lowered = part.toLowerCase();
      // 순수 숫자는 제외
      if (/^[0-9]+$/.test(lowered)) continue;
      const word = stripParticle(lowered);
      if (word.length < 2) continue;
      if (STOPWORDS.has(word)) continue;
      seenInQuestion.add(word);
    }
    for (const w of seenInQuestion) {
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'ko'))
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
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
    if (typeof given !== 'string' || !sameCode(given, teacherCode)) {
      throw new ApiError(401, 'UNAUTHORIZED');
    }

    const classCode = readRequiredClassCode(req);
    const studentNo = readOptionalStudentNo(req);
    const cls = encodeURIComponent(classCode);

    const tasks = [
      selectRows(cfg, 'stats_level_questions', `?select=level,question_count,student_count&class_code=eq.${cls}`),
      selectRows(cfg, 'stats_quiz', `?select=level,question_no,submitted,correct,correct_rate&class_code=eq.${cls}&order=level.asc,question_no.asc`),
      selectRows(cfg, 'stats_hint_steps', `?select=hint_step,question_count&class_code=eq.${cls}&order=hint_step.asc`),
      selectRows(cfg, 'questions', `?select=question_text&class_code=eq.${cls}&order=created_at.desc&limit=${QUESTION_SCAN_LIMIT}`),
      selectRows(cfg, 'questions', `?select=student_no&class_code=eq.${cls}&limit=${STUDENT_LIST_LIMIT}`),
      selectRows(cfg, 'answers', `?select=student_no&class_code=eq.${cls}&limit=${STUDENT_LIST_LIMIT}`),
    ];

    if (studentNo) {
      const stu = encodeURIComponent(studentNo);
      tasks.push(
        selectRows(cfg, 'questions', `?select=level,question_text,hint_step,created_at&class_code=eq.${cls}&student_no=eq.${stu}&order=created_at.desc&limit=${STUDENT_DETAIL_LIMIT}`),
        selectRows(cfg, 'answers_latest', `?select=level,question_no,answer,is_correct,created_at&class_code=eq.${cls}&student_no=eq.${stu}&order=level.asc,question_no.asc`),
      );
    }

    const results = await Promise.all(tasks);
    const [levelRows, quizRows, hintRows, qTextRows, qStuRows, aStuRows] = results;

    // 다문화 전용 뷰는 두지 않고 기본 3수준(기초·보통·심화)을 항상 포함.
    // 혹시 다문화 수준 데이터가 해당 반에 1건 이상 있으면 합계 일치를 위해 함께 반환.
    const levelMap = new Map(levelRows.map((r) => [r.level, r]));
    const levelOrder = [...CORE_LEVELS];
    if (levelMap.has('multicultural') && (Number(levelMap.get('multicultural')?.question_count) || 0) > 0) {
      levelOrder.push('multicultural');
    }
    const levels = levelOrder.map((lv) => {
      const row = levelMap.get(lv);
      return {
        level: lv,
        questionCount: Number(row?.question_count) || 0,
        studentCount: Number(row?.student_count) || 0,
      };
    });

    const quiz = quizRows.map((r) => ({
      level: r.level,
      questionNo: Number(r.question_no),
      submitted: Number(r.submitted) || 0,
      correct: r.correct === null || r.correct === undefined ? null : Number(r.correct),
      correctRate: r.correct_rate === null || r.correct_rate === undefined ? null : Number(r.correct_rate),
    }));

    const hintMap = new Map(hintRows.map((r) => [Number(r.hint_step), Number(r.question_count) || 0]));
    const hints = [1, 2, 3].map((step) => ({
      hintStep: step,
      count: hintMap.get(step) ?? 0,
    }));

    const keywords = extractKeywords(qTextRows.map((r) => r.question_text), 5);

    // 학번 목록: 순위·점수 순 정렬 금지, 오직 학번 숫자 순으로만 정렬
    const students = [...new Set([...qStuRows, ...aStuRows].map((r) => String(r.student_no)))]
      .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));

    const payload = { classCode, levels, quiz, hints, keywords, students };

    if (studentNo) {
      const [, , , , , , stuQuestions, stuAnswers] = results;
      payload.student = {
        studentNo,
        questions: stuQuestions.map((r) => ({
          level: r.level,
          questionText: r.question_text,
          hintStep: Number(r.hint_step),
          createdAt: r.created_at,
        })),
        answers: stuAnswers.map((r) => ({
          level: r.level,
          questionNo: Number(r.question_no),
          answer: r.answer,
          isCorrect: r.is_correct === null || r.is_correct === undefined ? null : Boolean(r.is_correct),
          createdAt: r.created_at,
        })),
      };
    }

    return res.status(200).json(payload);
  } catch (err) {
    return sendError(res, err, 'stats');
  }
}
