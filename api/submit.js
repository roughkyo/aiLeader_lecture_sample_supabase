// 서버 함수: POST /api/submit — 학생 제출 저장 (Supabase)
//  kind: "answers"  → answers 표에 확인 질문 답을 문항별 한 줄씩
//  kind: "question" → questions 표에 학생 질문과 받은 힌트 단계를 한 줄
// 학생 구분은 반 코드(classCode)와 학번(studentNo)뿐이다. 실명·연락처는 받지도 저장하지도 않는다.
// 접속값은 환경변수 SUPABASE_URL·SUPABASE_SECRET_KEY에서만 읽는다. 자세한 규칙은 TRD.md 14절.

import { ApiError, parseBody, sendError, validateStudent, normalizeStudentNo, readStoreConfig, insertRows } from './_store.js';

/** 요청 검사. 문제가 있으면 필드 이름이 든 문장(값은 넣지 않음), 없으면 null */
function validate(b) {
  if (!b) return '요청 본문이 JSON 객체가 아닙니다';
  const student = validateStudent(b);
  if (student) return student;

  if (b.kind === 'answers') {
    if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 5) return 'items는 1~5개';
    const seen = new Set();
    for (const it of b.items) {
      if (!it || !Number.isInteger(it.questionNo) || it.questionNo < 1 || it.questionNo > 5) return 'questionNo는 1~5';
      if (seen.has(it.questionNo)) return 'questionNo 중복';
      seen.add(it.questionNo);
      if (typeof it.answer !== 'string') return 'answer는 문자열';
      const n = it.answer.trim().length;
      if (n < 1 || n > 1000) return 'answer는 1~1,000자';
    }
    return null;
  }
  if (b.kind === 'question') {
    if (typeof b.questionText !== 'string') return 'questionText는 문자열';
    const n = b.questionText.trim().length;
    if (n < 1 || n > 300) return 'questionText는 1~300자';
    if (!Number.isInteger(b.hintStep) || b.hintStep < 1 || b.hintStep > 3) return 'hintStep은 1~3';
    return null;
  }
  return 'kind는 answers 또는 question';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const body = parseBody(req);
    const invalid = validate(body);
    if (invalid) throw new ApiError(400, 'BAD_REQUEST', invalid);

    const cfg = readStoreConfig();
    if (!cfg) throw new ApiError(500, 'NO_STORE');

    const who = { class_code: body.classCode, student_no: normalizeStudentNo(body.studentNo), level: body.level };
    if (body.kind === 'answers') {
      const rows = body.items.map((it) => ({ ...who, question_no: it.questionNo, answer: it.answer.trim() }));
      await insertRows(cfg, 'answers', rows);
      return res.status(201).json({ saved: rows.length });
    }
    await insertRows(cfg, 'questions', [{ ...who, question_text: body.questionText.trim(), hint_step: body.hintStep }]);
    return res.status(201).json({ saved: 1 });
  } catch (err) {
    return sendError(res, err, 'submit');
  }
}
