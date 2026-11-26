// 교사 화면: 교사 코드를 입력하면 /api/results가 서버의 TEACHER_CODE와 비교하고,
// 맞을 때만 반별 답(answers)과 질문(questions)을 보여 준다. 반 코드로 거를 수 있다.
// - 교사 코드는 주소(URL)에 넣지 않고 요청 헤더(x-teacher-code)로만 보낸다.
// - 코드는 이 화면의 메모리에만 있고 localStorage·쿠키에 저장하지 않는다.
// - 서버에서 받은 글은 textContent로만 화면에 넣는다(innerHTML 사용 안 함).

const $ = (id) => document.getElementById(id);
const els = {
  loginBox: $('loginBox'),
  loginForm: $('loginForm'),
  teacherCode: $('teacherCode'),
  loginStatus: $('loginStatus'),
  resultBox: $('resultBox'),
  classFilter: $('classFilter'),
  refreshBtn: $('refreshBtn'),
  logoutBtn: $('logoutBtn'),
  summary: $('summary'),
  answersBody: document.querySelector('#answersTable tbody'),
  questionsBody: document.querySelector('#questionsTable tbody'),
};

const LEVEL_LABEL = { basic: '기초', normal: '보통', advanced: '심화', multicultural: '다문화' };
const ERRORS = {
  UNAUTHORIZED: '교사 코드가 맞지 않아요.',
  NO_TEACHER_CODE: '서버에 TEACHER_CODE가 없어요. .env.local 또는 배포 환경변수를 확인해 주세요.',
  NO_STORE: '서버에 SUPABASE_URL 또는 SUPABASE_SECRET_KEY가 없어요. .env.local 또는 배포 환경변수를 확인해 주세요.',
  STORE_ERROR: 'Supabase에서 기록을 가져오지 못했어요. 잠시 뒤 다시 눌러 주세요.',
  BAD_REQUEST: '반 코드 형식이 맞지 않아요.',
  NO_SERVER: '서버가 켜져 있지 않아요. 로컬 개발 서버(npm run dev)로 실행했는지 확인해 주세요.',
  NETWORK: '인터넷 연결을 확인해 주세요.',
};

let teacherCode = '';   // 메모리에만 보관
let loading = false;

async function fetchResults(classCode) {
  const query = classCode ? `?classCode=${encodeURIComponent(classCode)}` : '';
  let res;
  try {
    res = await fetch(`/api/results${query}`, { headers: { 'x-teacher-code': teacherCode }, cache: 'no-store' });
  } catch {
    throw new Error('NETWORK');
  }
  let data = null;
  try { data = await res.json(); } catch { /* JSON이 아닌 응답(정적 서버의 404 등) */ }
  if (!res.ok) throw new Error(data?.error || ([404, 405, 501].includes(res.status) ? 'NO_SERVER' : `HTTP_${res.status}`));
  return data;
}

// 2026-11-26 15:00:39 (내 컴퓨터 시간대 기준)
const fmtTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function fillTable(tbody, rows, build, emptyText, cols) {
  tbody.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = cell(emptyText, 'is-empty');
    td.colSpan = cols;
    tr.append(td);
    tbody.append(tr);
    return;
  }
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    tr.append(...build(row));
    tbody.append(tr);
  });
}

function render(data, keepFilter) {
  // 반 코드 목록은 서버가 준 전체 목록(필터를 바꿔도 목록이 줄지 않게). 고른 반이 목록에 없으면 추가
  const selected = keepFilter ?? data.classCode ?? '';
  const classes = [...data.classes];
  if (selected && !classes.includes(selected)) classes.push(selected);
  els.classFilter.replaceChildren(new Option('전체 반', ''), ...classes.map((c) => new Option(c, c)));
  els.classFilter.value = selected;

  fillTable(els.answersBody, data.answers, (r) => [
    cell(fmtTime(r.created_at)), cell(r.class_code), cell(r.student_no),
    cell(LEVEL_LABEL[r.level] ?? r.level), cell(`${r.question_no}번`), cell(r.answer, 'is-text'),
  ], '저장된 답이 없어요.', 6);

  fillTable(els.questionsBody, data.questions, (r) => [
    cell(fmtTime(r.created_at)), cell(r.class_code), cell(r.student_no),
    cell(LEVEL_LABEL[r.level] ?? r.level), cell(r.question_text, 'is-text'), cell(`${r.hint_step}단계`),
  ], '저장된 질문이 없어요.', 6);

  const where = data.classCode ? `반 코드 ${data.classCode}` : '전체 반';
  els.summary.textContent = `${where} · 답 ${data.answers.length}줄 · 질문 ${data.questions.length}줄`;
}

async function load(classCode) {
  if (loading) return;
  loading = true;
  els.refreshBtn.disabled = true;
  els.summary.textContent = '불러오는 중…';
  try {
    const data = await fetchResults(classCode);
    els.loginBox.hidden = true;
    els.resultBox.hidden = false;
    render(data, classCode || '');
  } catch (err) {
    const message = ERRORS[err.message] ?? `기록을 불러오지 못했어요. (${err.message})`;
    if (els.resultBox.hidden) {
      els.loginStatus.className = 'student-status is-wrong';
      els.loginStatus.textContent = message;
    } else {
      els.summary.textContent = message;
    }
    if (err.message === 'UNAUTHORIZED') teacherCode = '';
  } finally {
    loading = false;
    els.refreshBtn.disabled = false;
  }
}

function logout() {
  teacherCode = '';
  els.teacherCode.value = '';
  els.resultBox.hidden = true;
  els.loginBox.hidden = false;
  els.loginStatus.className = 'student-status';
  els.loginStatus.textContent = '';
  els.answersBody.replaceChildren();
  els.questionsBody.replaceChildren();
  els.teacherCode.focus();
}

els.loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  teacherCode = els.teacherCode.value.trim();
  if (!teacherCode) {
    els.loginStatus.className = 'student-status is-wrong';
    els.loginStatus.textContent = '교사 코드를 입력해 주세요.';
    return;
  }
  els.loginStatus.className = 'student-status';
  els.loginStatus.textContent = '확인하는 중…';
  load('');
});
els.classFilter.addEventListener('change', () => load(els.classFilter.value));
els.refreshBtn.addEventListener('click', () => load(els.classFilter.value));
els.logoutBtn.addEventListener('click', logout);
