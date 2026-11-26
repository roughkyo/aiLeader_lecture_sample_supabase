// 학생 구분(반 코드·학번)과 저장 요청
// - 이름·연락처는 받지 않는다. 학생을 구분하는 값은 반 코드와 학번뿐이다.
// - 값은 화면의 입력 칸에만 있고 localStorage·쿠키에 저장하지 않는다(새로고침하면 다시 입력).
// - 저장은 서버 함수 /api/submit이 Supabase에 한다. 브라우저는 Supabase에 직접 접근하지 않는다.

const CLASS_CODE_RE = /^[0-9A-Za-z-]{1,20}$/;
const STUDENT_NO_RE = /^[0-9]{1,10}$/;

let fields = null;

/** 입력 칸의 지금 값이 올바르면 { classCode, studentNo }, 아니면 null */
export function getStudent() {
  if (!fields) return null;
  const classCode = fields.classInput.value.trim();
  const studentNo = fields.noInput.value.trim();
  return CLASS_CODE_RE.test(classCode) && STUDENT_NO_RE.test(studentNo) ? { classCode, studentNo } : null;
}

function describe() {
  const classCode = fields.classInput.value.trim();
  const studentNo = fields.noInput.value.trim();
  if (!classCode && !studentNo) {
    return { kind: '', text: '입력하지 않으면 답과 질문은 저장되지 않아요. 읽기는 그대로 할 수 있어요.', badge: '저장 안 함' };
  }
  if (classCode && !CLASS_CODE_RE.test(classCode)) {
    return { kind: 'wrong', text: '반 코드는 영문·숫자·하이픈(-)만 쓸 수 있어요. 예: 1-3 (이름은 쓰지 마세요)', badge: '저장 안 함' };
  }
  if (!classCode || !studentNo) {
    return { kind: 'wrong', text: '반 코드와 학번을 모두 입력해 주세요.', badge: '저장 안 함' };
  }
  return {
    kind: 'correct',
    text: `✓ 반 코드 ${classCode} · 학번 ${studentNo} — 형성평가 답과 질문이 저장돼요.`,
    badge: `저장: ${classCode} · ${studentNo}`,
  };
}

export function initStudent({ classInput, noInput, statusEl, badgeEl }) {
  fields = { classInput, noInput, statusEl, badgeEl };
  const render = () => {
    const d = describe();
    statusEl.className = `student-status${d.kind ? ` is-${d.kind}` : ''}`;
    statusEl.textContent = d.text;
    badgeEl.textContent = d.badge;
    badgeEl.classList.toggle('is-saving', d.kind === 'correct');
  };
  // 학번은 숫자만 남긴다(이름을 잘못 써도 저장되지 않게)
  noInput.addEventListener('input', () => {
    const digits = noInput.value.replace(/\D/g, '');
    if (digits !== noInput.value) noInput.value = digits;
    render();
  });
  classInput.addEventListener('input', render);
  render();
}

/* ---------- 저장 요청 ---------- */
export const SAVE_ERRORS = {
  NO_SERVER: '저장 서버가 켜져 있지 않아요. 로컬 개발 서버(npm run dev)로 실행했는지 확인해 주세요.',
  BAD_REQUEST: '반 코드와 학번을 확인해 주세요.',
  NO_STORE: '저장 서버 설정(SUPABASE_URL·SUPABASE_SECRET_KEY)을 확인해 주세요.',
  STORE_ERROR: '저장하지 못했어요. 잠시 뒤 [다시 저장]을 눌러 주세요.',
  TOO_LARGE: '내용이 너무 길어요. 답을 줄여 주세요.',
  NETWORK: '인터넷 연결을 확인해 주세요.',
};

/** payload: { kind: 'answers' | 'question', classCode, studentNo, level, ... } → 저장한 줄 수 */
export async function saveSubmission(payload) {
  let res;
  try {
    res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('NETWORK');
  }
  let data = null;
  try { data = await res.json(); } catch { /* 서버가 JSON이 아닌 응답(정적 서버의 404·501 등)을 준 경우 */ }
  if (!res.ok) {
    throw new Error(data?.error || ([404, 405, 501].includes(res.status) ? 'NO_SERVER' : `HTTP_${res.status}`));
  }
  return data?.saved ?? 0;
}
