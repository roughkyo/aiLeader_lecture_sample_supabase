// 우리 반 질문 보드 (교사용 통계 화면)
// - 교사 코드와 반 코드는 메모리에만 두고 localStorage·쿠키·주소창에 저장하지 않는다.
// - 학생이 입력한 글(질문·답)은 textContent로만 화면에 넣는다(innerHTML 금지).
// - 학생 순위표나 합계 점수는 계산·표시하지 않는다.

const $ = (id) => document.getElementById(id);

const els = {
  queryForm: $('queryForm'),
  teacherCodeInput: $('teacherCodeInput'),
  classCodeInput: $('classCodeInput'),
  viewBtn: $('viewBtn'),
  refreshBtn: $('refreshBtn'),
  clearBtn: $('clearBtn'),
  statusMsg: $('statusMsg'),
  boardContent: $('boardContent'),
  classBadge: $('classBadge'),
  summaryText: $('summaryText'),
  levelBars: $('levelBars'),
  hintBars: $('hintBars'),
  keywordList: $('keywordList'),
  quizBody: document.querySelector('#quizTable tbody'),
  studentDetails: $('studentDetails'),
  studentSelect: $('studentSelect'),
  studentStatusMsg: $('studentStatusMsg'),
  studentDetailBox: $('studentDetailBox'),
  studentQuestionsBody: document.querySelector('#studentQuestionsTable tbody'),
  studentAnswersBody: document.querySelector('#studentAnswersTable tbody'),
};

const LEVEL_LABEL = {
  basic: '기초',
  normal: '보통',
  advanced: '심화',
  multicultural: '다문화',
};

const CLASS_CODE_RE = /^[0-9A-Za-z-]{1,20}$/;

const ERRORS = {
  UNAUTHORIZED: '교사 코드를 확인해 주세요.',
  BAD_REQUEST: '반 코드를 확인해 주세요. (영문·숫자·하이픈만 사용)',
  NO_TEACHER_CODE: '서버 설정(TEACHER_CODE)을 확인해 주세요.',
  NO_STORE: '저장 서버 설정(SUPABASE_URL·SUPABASE_SECRET_KEY)을 확인해 주세요.',
  STORE_ERROR: '통계를 불러오지 못했어요. Supabase SQL Editor에서 통계 뷰 SQL을 실행했는지 확인해 주세요.',
  NO_SERVER: '서버가 켜져 있지 않아요. 로컬 개발 서버(npm run dev)로 실행했는지 확인해 주세요.',
  NETWORK: '인터넷 연결을 확인해 주세요.',
};

let currentCode = '';
let currentClass = '';
let loading = false;

function setStatus(text, kind = '') {
  els.statusMsg.className = `student-status${kind ? ` is-${kind}` : ''}`;
  els.statusMsg.textContent = text;
}

const fmtTime = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

async function fetchStats(classCode, studentNo = '') {
  const params = new URLSearchParams({ classCode });
  if (studentNo) params.set('studentNo', studentNo);
  let res;
  try {
    res = await fetch(`/api/stats?${params.toString()}`, {
      headers: { 'x-teacher-code': currentCode },
      cache: 'no-store',
    });
  } catch {
    throw new Error('NETWORK');
  }
  let data = null;
  try { data = await res.json(); } catch { /* 비 JSON 응답 */ }
  if (!res.ok) {
    throw new Error(data?.error || ([404, 405, 501].includes(res.status) ? 'NO_SERVER' : `HTTP_${res.status}`));
  }
  return data;
}

function resetDisplay() {
  els.boardContent.hidden = true;
  els.levelBars.replaceChildren();
  els.hintBars.replaceChildren();
  els.keywordList.replaceChildren();
  els.quizBody.replaceChildren();
  els.studentSelect.replaceChildren();
  els.studentDetails.open = false;
  els.studentDetailBox.hidden = true;
  els.studentStatusMsg.textContent = '';
  els.studentQuestionsBody.replaceChildren();
  els.studentAnswersBody.replaceChildren();
}

function renderBars(container, items, { getLabel, getValue, getMeta, getBarClass }) {
  container.replaceChildren();
  const max = Math.max(0, ...items.map(getValue));
  for (const item of items) {
    const val = getValue(item);
    const pct = max > 0 ? Math.round((val / max) * 100) : 0;

    const row = makeEl('div', 'bar-row');
    const head = makeEl('div', 'bar-head');
    head.append(
      makeEl('span', 'bar-label', getLabel(item)),
      makeEl('span', 'bar-meta', getMeta(item)),
    );
    const track = makeEl('div', 'bar-track');
    const barCls = typeof getBarClass === 'function' ? getBarClass(item) : '';
    const fill = makeEl('div', `bar-fill ${barCls}`.trim());
    fill.style.width = `${pct}%`;
    track.append(fill);

    row.append(head, track);
    container.append(row);
  }
}

function renderKeywords(keywords) {
  els.keywordList.replaceChildren();
  if (!keywords.length) {
    els.keywordList.append(makeEl('p', 'empty-msg', '집계할 질문 용어가 아직 없어요.'));
    return;
  }
  const max = Math.max(1, ...keywords.map((k) => k.count));
  keywords.forEach((item, idx) => {
    const row = makeEl('div', 'keyword-row');
    const rank = makeEl('span', 'keyword-rank', String(idx + 1));
    const word = makeEl('span', 'keyword-word', item.word);
    const track = makeEl('div', 'bar-track');
    const fill = makeEl('div', 'bar-fill is-keyword');
    fill.style.width = `${Math.round((item.count / max) * 100)}%`;
    track.append(fill);
    const cnt = makeEl('span', 'keyword-count', `${item.count}건`);
    row.append(rank, word, track, cnt);
    els.keywordList.append(row);
  });
}

function renderQuizTable(levels, quizRows) {
  els.quizBody.replaceChildren();
  // 수준 순서: levels 배열 + quizRows에만 존재하는 수준이 있으면 뒤에 추가
  const levelOrder = levels.map((l) => l.level);
  for (const r of quizRows) {
    if (!levelOrder.includes(r.level)) levelOrder.push(r.level);
  }
  const map = new Map(quizRows.map((r) => [`${r.level}:${r.questionNo}`, r]));

  for (const lv of levelOrder) {
    const tr = document.createElement('tr');
    tr.append(makeEl('th', 'quiz-level-cell', LEVEL_LABEL[lv] ?? lv));
    for (let qNo = 1; qNo <= 5; qNo += 1) {
      const cellData = map.get(`${lv}:${qNo}`);
      const td = document.createElement('td');
      if (!cellData || cellData.submitted === 0) {
        td.textContent = '—';
        td.className = 'is-muted';
      } else if (qNo === 5 || cellData.correctRate === null) {
        td.append(makeEl('span', 'rate-chip is-essay', `서술형 ${cellData.submitted}명`));
      } else {
        const tier = cellData.correctRate >= 80 ? 'is-high' : (cellData.correctRate < 60 ? 'is-low' : 'is-mid');
        td.append(makeEl('span', `rate-chip ${tier}`, `${cellData.correctRate.toFixed(1)}% (${cellData.correct}/${cellData.submitted})`));
      }
      tr.append(td);
    }
    els.quizBody.append(tr);
  }
}

function renderStudentOptions(students) {
  els.studentSelect.replaceChildren(new Option('— 학번을 고르세요 —', ''));
  for (const no of students) {
    els.studentSelect.append(new Option(`${no}번`, no));
  }
  els.studentSelect.disabled = students.length === 0;
  els.studentStatusMsg.textContent = students.length
    ? `참여 학번 ${students.length}명 (학번 순)`
    : '조회할 학생 기록이 없어요.';
}

function renderStudentDetail(student) {
  els.studentQuestionsBody.replaceChildren();
  els.studentAnswersBody.replaceChildren();

  if (!student.questions.length) {
    const tr = document.createElement('tr');
    const td = makeEl('td', 'is-empty', '저장된 질문이 없어요.');
    td.colSpan = 4;
    tr.append(td);
    els.studentQuestionsBody.append(tr);
  } else {
    for (const q of student.questions) {
      const tr = document.createElement('tr');
      tr.append(
        makeEl('td', '', fmtTime(q.createdAt)),
        makeEl('td', '', LEVEL_LABEL[q.level] ?? q.level),
        makeEl('td', 'is-text', q.questionText),
        makeEl('td', '', `${q.hintStep}단계`),
      );
      els.studentQuestionsBody.append(tr);
    }
  }

  if (!student.answers.length) {
    const tr = document.createElement('tr');
    const td = makeEl('td', 'is-empty', '저장된 답안이 없어요.');
    td.colSpan = 5;
    tr.append(td);
    els.studentAnswersBody.append(tr);
  } else {
    for (const a of student.answers) {
      const tr = document.createElement('tr');
      const resultText = a.isCorrect === null ? '— (서술형)' : (a.isCorrect ? '✓ 맞음' : '✗ 틀림');
      const resultCls = a.isCorrect === null ? 'is-muted' : (a.isCorrect ? 'is-ok' : 'is-no');
      tr.append(
        makeEl('td', '', fmtTime(a.createdAt)),
        makeEl('td', '', LEVEL_LABEL[a.level] ?? a.level),
        makeEl('td', '', `${a.questionNo}번`),
        makeEl('td', 'is-text', a.answer),
        makeEl('td', resultCls, resultText),
      );
      els.studentAnswersBody.append(tr);
    }
  }

  els.studentDetailBox.hidden = false;
}

function renderBoard(data) {
  const totalQuestions = data.levels.reduce((sum, x) => sum + x.questionCount, 0);
  const hasAny = totalQuestions > 0 || data.quiz.length > 0 || data.students.length > 0;

  els.classBadge.textContent = `반 코드 ${data.classCode}`;
  els.summaryText.textContent = `참여 학번 ${data.students.length}명 · 총 질문 ${totalQuestions}건`;

  if (!hasAny) {
    els.boardContent.hidden = true;
    setStatus(`반 코드 ${data.classCode}: 이 반의 기록이 아직 없어요.`, '');
    return;
  }

  renderBars(els.levelBars, data.levels, {
    getLabel: (r) => LEVEL_LABEL[r.level] ?? r.level,
    getValue: (r) => r.questionCount,
    getMeta: (r) => `질문 ${r.questionCount}건 · 학생 ${r.studentCount}명`,
    getBarClass: (r) => `is-level-${r.level}`,
  });

  renderBars(els.hintBars, data.hints, {
    getLabel: (r) => `${r.hintStep}단계`,
    getValue: (r) => r.count,
    getMeta: (r) => `${r.count}건`,
    getBarClass: (r) => `is-hint-${r.hintStep}`,
  });

  renderKeywords(data.keywords);
  renderQuizTable(data.levels, data.quiz);
  renderStudentOptions(data.students);

  els.boardContent.hidden = false;
  els.refreshBtn.hidden = false;
  els.clearBtn.hidden = false;
  setStatus('', '');
}

async function loadClassStats(classCode) {
  if (loading) return;
  loading = true;
  els.viewBtn.disabled = true;
  els.refreshBtn.disabled = true;
  // 반을 바꾸면 이전 결과를 먼저 비워 숫자가 섞이지 않게 한다
  resetDisplay();
  setStatus('통계를 불러오는 중…', '');

  try {
    const data = await fetchStats(classCode);
    currentClass = data.classCode;
    renderBoard(data);
  } catch (err) {
    const msg = ERRORS[err.message] ?? `통계를 불러오지 못했어요. (${err.message})`;
    setStatus(msg, 'wrong');
    if (err.message === 'UNAUTHORIZED') {
      currentCode = '';
      els.refreshBtn.hidden = true;
      els.clearBtn.hidden = true;
    }
  } finally {
    loading = false;
    els.viewBtn.disabled = false;
    els.refreshBtn.disabled = false;
  }
}

async function loadStudent(studentNo) {
  if (!studentNo || !currentClass || !currentCode) {
    els.studentDetailBox.hidden = true;
    return;
  }
  els.studentStatusMsg.textContent = `${studentNo}번 기록 불러오는 중…`;
  try {
    const data = await fetchStats(currentClass, studentNo);
    if (data.student) {
      renderStudentDetail(data.student);
      els.studentStatusMsg.textContent = `${studentNo}번 · 질문 ${data.student.questions.length}건 · 최신 답 ${data.student.answers.length}건`;
    }
  } catch (err) {
    els.studentStatusMsg.textContent = ERRORS[err.message] ?? `학생 기록을 불러오지 못했어요. (${err.message})`;
  }
}

els.queryForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = els.teacherCodeInput.value.trim();
  const cls = els.classCodeInput.value.trim();
  if (!code) {
    setStatus('교사 코드를 입력해 주세요.', 'wrong');
    return;
  }
  if (!CLASS_CODE_RE.test(cls)) {
    setStatus(ERRORS.BAD_REQUEST, 'wrong');
    return;
  }
  currentCode = code;
  loadClassStats(cls);
});

els.refreshBtn.addEventListener('click', () => {
  if (currentClass && currentCode) loadClassStats(currentClass);
});

els.clearBtn.addEventListener('click', () => {
  currentCode = '';
  currentClass = '';
  els.teacherCodeInput.value = '';
  els.refreshBtn.hidden = true;
  els.clearBtn.hidden = true;
  resetDisplay();
  setStatus('교사 코드를 지웠어요.', '');
  els.teacherCodeInput.focus();
});

els.studentSelect.addEventListener('change', () => {
  loadStudent(els.studentSelect.value);
});
