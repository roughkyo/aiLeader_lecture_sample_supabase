// 학습 활동: 본문 중간 활동(하나 고르기·골라 넣기·빈칸 채우기·중요 단어 찾기) + 형성평가
// 문제·정답은 materials/activities.json에 있다. 답과 점수는 화면에만 보이고 저장하지 않는다.
// 서술형의 [💡 힌트 받기]는 서버 함수 /api/feedback(Gemini)을 부른다 → 로컬 개발 서버(npm run dev) 또는 배포 환경에서 동작.

const TYPE_LABEL = {
  choice: '하나 고르기',
  select: '골라 넣기',
  blank: '빈칸 채우기',
  highlight: '중요 단어 찾기',
  essay: '서술형',
};
const MAX_HINTS = 3;

let cache = null;
export async function loadActivities() {
  if (cache) return cache;
  const res = await fetch('materials/activities.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  cache = await res.json();
  return cache;
}

/* ---------- 작은 도우미 ---------- */
let uid = 0;
const nextId = (prefix) => `${prefix}-${++uid}`;

// el('p', { class: 'x', text: '...', 'aria-label': '...' }, child1, child2)
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  });
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

const normalize = (s) => String(s).normalize('NFC').replace(/\s+/g, '').toLowerCase();

// 빈칸 답 뒤에 조사를 붙여 써도 맞게 처리(예: '단어를' → '단어')
const PARTICLE = /^(을|를|이|가|은|는|의|로|으로|도)$/;
function matchesAnswer(input, accepted) {
  const n = normalize(input);
  return accepted.some((a) => {
    const na = normalize(a);
    return n === na || (n.startsWith(na) && PARTICLE.test(n.slice(na.length)));
  });
}

// "문장 {{0}} 문장 {{1}}" → ['문장 ', '0', ' 문장 ', '1', ''] (홀수 칸이 빈칸 번호)
const splitTemplate = (text) => text.split(/\{\{(\d+)\}\}/);

const MARKS = ['is-correct', 'is-wrong', 'is-answer'];
const clearMarks = (nodes) => nodes.forEach((n) => n.classList.remove(...MARKS));

/* ---------- 힌트 요청 (서버 함수) ---------- */
const HINT_ERRORS = {
  NO_SERVER: '힌트 서버가 켜져 있지 않아요. 로컬 개발 서버(npm run dev)로 실행했는지 확인해 주세요.',
  NO_KEY: '서버에 GEMINI_API_KEY가 없어요. .env.local 또는 배포 환경변수를 확인해 주세요.',
  BAD_KEY: 'API 키가 올바르지 않아요. AI Studio에서 키를 다시 확인해 주세요.',
  RATE_LIMIT: '요청이 많아요. 30초쯤 뒤에 다시 눌러 주세요.',
  TIMEOUT: '힌트를 만드는 데 시간이 오래 걸려요. 다시 눌러 주세요.',
  BAD_REQUEST: '요청 형식이 맞지 않아요.',
  NETWORK: '인터넷 연결을 확인해 주세요.',
};

async function requestHint(payload) {
  let res;
  try {
    res = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'hint', ...payload }),
    });
  } catch {
    throw new Error('NETWORK');
  }
  let data = null;
  try { data = await res.json(); } catch { /* 서버가 JSON이 아닌 응답(예: 정적 서버의 404·501)을 준 경우 */ }
  if (!res.ok) {
    const code = data?.error || ([404, 405, 501].includes(res.status) ? 'NO_SERVER' : `HTTP_${res.status}`);
    throw new Error(code);
  }
  if (!data?.hint) throw new Error('BAD_AI_OUTPUT');
  return data.hint;
}

/* ---------- 문항 위젯 ----------
   각 위젯: { node, check() → {answered, correct}, reveal(), answerText(), lock(bool), reset() } */

function buildChoice(item) {
  const name = nextId('choice');
  const fieldset = el('fieldset', { class: 'act-choice' });
  fieldset.append(el('legend', { class: 'act-q', text: item.q }));
  const labels = item.options.map((option, i) => {
    const input = el('input', { type: 'radio', name, value: String(i) });
    return el('label', { class: 'act-option' }, input, el('span', { text: option }));
  });
  fieldset.append(...labels);

  return {
    node: fieldset,
    check() {
      clearMarks(labels);
      const picked = fieldset.querySelector('input:checked');
      if (!picked) return { answered: false, correct: false };
      const i = Number(picked.value);
      const correct = i === item.answer;
      labels[i].classList.add(correct ? 'is-correct' : 'is-wrong');
      return { answered: true, correct };
    },
    reveal() { labels[item.answer].classList.add('is-answer'); },
    answerText: () => item.options[item.answer],
    lock(on) { fieldset.disabled = on; },
    reset() {
      fieldset.querySelectorAll('input').forEach((input) => { input.checked = false; });
      clearMarks(labels);
      fieldset.disabled = false;
    },
  };
}

function buildSelect(item) {
  const sentence = el('p', { class: 'act-sentence' });
  const selects = [];
  splitTemplate(item.text).forEach((part, k) => {
    if (k % 2 === 0) { sentence.append(part); return; }
    const slotNo = Number(part);
    const slot = item.slots[slotNo];
    const select = el('select', { class: 'act-select', 'aria-label': `${slotNo + 1}번째 칸 고르기` });
    select.append(el('option', { value: '', text: '— 고르기 —' }));
    slot.options.forEach((option, i) => select.append(el('option', { value: String(i), text: option })));
    selects.push({ select, slot });
    sentence.append(select);
  });

  return {
    node: sentence,
    check() {
      clearMarks(selects.map((s) => s.select));
      if (selects.some(({ select }) => select.value === '')) return { answered: false, correct: false };
      let allCorrect = true;
      selects.forEach(({ select, slot }) => {
        const ok = Number(select.value) === slot.answer;
        select.classList.add(ok ? 'is-correct' : 'is-wrong');
        if (!ok) allCorrect = false;
      });
      return { answered: true, correct: allCorrect };
    },
    reveal() {
      selects.forEach(({ select, slot }) => {
        select.value = String(slot.answer);
        select.classList.remove('is-wrong');
        select.classList.add('is-answer');
      });
    },
    answerText: () => selects.map(({ slot }) => slot.options[slot.answer]).join(' / '),
    lock(on) { selects.forEach(({ select }) => { select.disabled = on; }); },
    reset() {
      selects.forEach(({ select }) => { select.value = ''; select.disabled = false; });
      clearMarks(selects.map((s) => s.select));
    },
  };
}

function buildBlank(item) {
  const sentence = el('p', { class: 'act-sentence' });
  const inputs = [];
  splitTemplate(item.text).forEach((part, k) => {
    if (k % 2 === 0) { sentence.append(part); return; }
    const no = Number(part);
    const accepted = item.blanks[no];
    const width = Math.max(4, ...accepted.map((a) => a.length)) + 2;
    const input = el('input', {
      type: 'text', class: 'act-blank', size: String(width),
      autocomplete: 'off', spellcheck: 'false', 'aria-label': `${no + 1}번째 빈칸`,
    });
    inputs.push({ input, accepted });
    sentence.append(input);
  });

  return {
    node: sentence,
    check() {
      clearMarks(inputs.map((x) => x.input));
      if (inputs.some(({ input }) => !input.value.trim())) return { answered: false, correct: false };
      let allCorrect = true;
      inputs.forEach(({ input, accepted }) => {
        const ok = matchesAnswer(input.value, accepted);
        input.classList.add(ok ? 'is-correct' : 'is-wrong');
        if (!ok) allCorrect = false;
      });
      return { answered: true, correct: allCorrect };
    },
    reveal() {
      inputs.forEach(({ input, accepted }) => {
        if (!matchesAnswer(input.value, accepted)) input.value = accepted[0];
        input.classList.remove('is-wrong');
        input.classList.add('is-answer');
      });
    },
    answerText: () => inputs.map(({ accepted }) => accepted[0]).join(' / '),
    lock(on) { inputs.forEach(({ input }) => { input.readOnly = on; }); },
    reset() {
      inputs.forEach(({ input }) => { input.value = ''; input.readOnly = false; });
      clearMarks(inputs.map((x) => x.input));
    },
  };
}

// 마우스로 끌어서(드래그) 중요 단어를 고르는 활동
function buildHighlight(item, { onProgress } = {}) {
  const wrap = el('div', { class: 'act-highlight' });
  const passage = el('p', { class: 'hl-passage', tabindex: '0' });
  const status = el('p', { class: 'hl-status', 'aria-live': 'polite' });
  const targets = [...item.targets];
  const found = new Set();

  // 문장을 쪼개 목표 단어를 span으로 감싼다(찾기 전에는 겉으로 아무 표시 없음)
  const pattern = new RegExp(
    [...targets].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'g',
  );
  let last = 0;
  for (const m of item.passage.matchAll(pattern)) {
    passage.append(item.passage.slice(last, m.index), el('span', { class: 'hl-target', 'data-target': m[0], text: m[0] }));
    last = m.index + m[0].length;
  }
  passage.append(item.passage.slice(last));

  const spans = () => [...passage.querySelectorAll('.hl-target')];
  const progressText = () => `${targets.length}개 중 ${found.size}개 찾음`;
  const longest = Math.max(...targets.map((t) => normalize(t).length));

  function markFound(target) {
    found.add(target);
    spans().filter((s) => s.dataset.target === target).forEach((s) => s.classList.add('is-found'));
  }

  function onSelectEnd() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!passage.contains(range.commonAncestorContainer)) return;
    const picked = normalize(sel.toString());
    if (!picked) return;

    const hit = spans().find((s) => {
      if (!range.intersectsNode(s)) return false;
      const t = normalize(s.dataset.target);
      const covers = picked.includes(t) && picked.length <= t.length + 3;          // 단어 + 조사 정도까지
      const mostly = t.includes(picked) && picked.length >= Math.ceil(t.length * 0.6);
      return covers || mostly;
    });

    if (hit) {
      const target = hit.dataset.target;
      if (found.has(target)) {
        status.textContent = `‘${target}’은(는) 이미 찾았어요. (${progressText()})`;
      } else {
        markFound(target);
        const done = found.size === targets.length;
        status.textContent = done ? `‘${target}’ 찾았어요! 모두 찾았어요. 🎉` : `‘${target}’ 찾았어요! (${progressText()})`;
        onProgress?.(done);
      }
    } else if (picked.length > longest + 3) {
      status.textContent = '너무 길게 골랐어요. 중요한 단어만 끌어서 골라 보세요.';
    } else {
      status.textContent = '중요 단어가 아니에요. 다른 곳을 골라 보세요.';
    }
    sel.removeAllRanges();
  }

  passage.addEventListener('mouseup', onSelectEnd);
  passage.addEventListener('touchend', () => setTimeout(onSelectEnd, 0));
  passage.addEventListener('keyup', (e) => { if (e.shiftKey) onSelectEnd(); });   // Shift+방향키로 고르기

  status.textContent = progressText();
  wrap.append(passage, status);

  return {
    node: wrap,
    check: () => ({ answered: found.size > 0, correct: found.size === targets.length }),
    reveal() {
      targets.forEach((t) => {
        if (!found.has(t)) spans().filter((s) => s.dataset.target === t).forEach((s) => s.classList.add('is-revealed'));
      });
      status.textContent = `정답: ${targets.join(', ')}`;
    },
    answerText: () => targets.join(', '),
    lock() {},
    reset() {
      found.clear();
      spans().forEach((s) => s.classList.remove('is-found', 'is-revealed'));
      status.textContent = progressText();
    },
  };
}

// 서술형: 핵심어 점검 + 소크라테스식 힌트(최대 3단계, 서버 함수 호출)
function buildEssay(item, { ctx } = {}) {
  const wrap = el('div', { class: 'act-essay' });
  const id = nextId('essay');
  const label = el('label', { class: 'act-q', for: id, text: item.q });
  const textarea = el('textarea', { id, rows: '3', class: 'act-textarea', placeholder: '여기에 답을 써 보세요.' });

  const askInput = el('input', {
    type: 'text',
    class: 'hint-input',
    maxlength: '300',
    autocomplete: 'off',
    placeholder: 'AI에게 궁금한 점을 물어보세요 (비워 두면 바로 힌트)',
    'aria-label': 'AI에게 물어볼 궁금한 점',
  });
  const hintBtn = el('button', { type: 'button', class: 'btn btn-small btn-hint' });
  const hintControls = el('div', { class: 'hint-controls' }, askInput, hintBtn);
  const hintStatus = el('p', { class: 'hint-status', 'aria-live': 'polite' });
  const hintList = el('ol', { class: 'hint-list' });
  const hints = [];   // 받은 힌트(메모리에만)
  let busy = false;
  let locked = false;

  const updateHintBtn = () => {
    const done = hints.length >= MAX_HINTS;
    hintBtn.textContent = done ? '💡 힌트를 모두 썼어요' : `💡 힌트 받기 (${hints.length}/${MAX_HINTS})`;
    hintBtn.disabled = busy || locked || done;
    askInput.disabled = busy || locked || done;
  };
  updateHintBtn();

  async function askHint() {
    if (busy || locked || hints.length >= MAX_HINTS) return;
    const studentQuestion = askInput.value.trim().slice(0, 300);
    busy = true;
    updateHintBtn();
    hintStatus.textContent = studentQuestion ? '질문에 맞는 힌트를 만드는 중…' : '힌트를 만드는 중…';
    try {
      const hint = await requestHint({
        step: hints.length + 1,
        level: ctx?.level ?? 'normal',
        lang: ctx?.getLang?.() ?? null,
        question: item.q,
        keyPoints: item.keyPoints.map((kp) => kp.label),
        studentAnswer: textarea.value.slice(0, 1000),
        studentQuestion,
        previousHints: [...hints],
        body: ctx?.getBody?.() ?? '',
        modelAnswer: item.model,
      });
      hints.push(hint);
      const li = el('li');
      if (studentQuestion) {
        li.append(el('p', { class: 'hint-q', text: `내 질문: ${studentQuestion}` }));
      }
      li.append(el('p', { class: 'hint-a', text: hint }));
      hintList.append(li);
      askInput.value = '';
      hintStatus.textContent = '';
    } catch (err) {
      hintStatus.textContent = HINT_ERRORS[err.message] ?? '힌트를 받지 못했어요. 잠시 뒤 다시 눌러 주세요.';
    } finally {
      busy = false;
      updateHintBtn();
    }
  }

  hintBtn.addEventListener('click', askHint);
  askInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      askHint();
    }
  });

  const review = el('div', { class: 'essay-review', hidden: '' });
  wrap.append(label, textarea, el('div', { class: 'hint-box' }, hintControls, hintStatus, hintList), review);

  function hits() {
    const text = normalize(textarea.value);
    return item.keyPoints.map((kp) => ({ ...kp, ok: kp.any.some((w) => text.includes(normalize(w))) }));
  }

  return {
    node: wrap,
    // 서술형은 점수에 넣지 않고 핵심어 포함 여부로 스스로 점검한다
    check() {
      const answered = textarea.value.trim().length > 0;
      const result = hits();
      review.replaceChildren(
        el('p', { class: 'essay-title', text: '핵심어 점검' }),
        el('ul', { class: 'essay-checklist' },
          ...result.map((r) => el('li', { class: r.ok ? 'is-correct' : 'is-wrong', text: `${r.ok ? '✓' : '✗'} ${r.label}` }))),
        el('p', { class: 'essay-model' }, el('strong', { text: '모범 답안 ' }), item.model),
      );
      review.hidden = false;
      return { answered, correct: null, hits: result.filter((r) => r.ok).length, total: result.length };
    },
    reveal() {},
    answerText: () => item.model,
    lock(on) { textarea.readOnly = on; locked = on; updateHintBtn(); },
    // 다시 풀어도 이미 쓴 힌트 횟수는 그대로(3회 제한 유지)
    reset() { textarea.value = ''; textarea.readOnly = false; locked = false; review.hidden = true; review.replaceChildren(); updateHintBtn(); },
  };
}

const BUILDERS = { choice: buildChoice, select: buildSelect, blank: buildBlank, highlight: buildHighlight, essay: buildEssay };

/* ---------- 본문 중간 활동 카드 ---------- */
function buildInlineCard(item, ctx) {
  const titleId = nextId('act-title');
  const card = el('section', { class: `activity type-${item.type}`, 'aria-labelledby': titleId });
  const feedback = el('p', { class: 'act-feedback', role: 'status', 'aria-live': 'polite' });
  const showFeedback = (kind, text) => {
    feedback.className = `act-feedback${kind ? ` is-${kind}` : ''}`;
    feedback.textContent = text;
  };

  const widget = BUILDERS[item.type](item, {
    ctx,
    onProgress: (done) => { if (done) showFeedback('correct', `✓ ${item.explain}`); },
  });

  card.append(el('p', { class: 'act-head' },
    el('span', { class: 'act-chip', id: titleId, text: `✏️ ${item.title || TYPE_LABEL[item.type]}` })));
  if (item.prompt) card.append(el('p', { class: 'act-prompt', text: item.prompt }));
  card.append(widget.node);

  const buttons = el('div', { class: 'act-buttons' });
  const checkBtn = el('button', { type: 'button', class: 'btn btn-primary btn-small', text: '확인' });
  const revealBtn = el('button', { type: 'button', class: 'btn btn-small', text: '정답 보기' });
  const resetBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: '다시 하기' });
  if (item.type !== 'highlight') buttons.append(checkBtn);
  buttons.append(revealBtn, resetBtn);
  card.append(buttons, feedback);

  checkBtn.addEventListener('click', () => {
    const r = widget.check();
    if (!r.answered) { showFeedback('', '먼저 모든 칸에 답을 골라(써) 주세요.'); return; }
    if (r.correct) showFeedback('correct', `✓ 정답이에요! ${item.explain}`);
    else showFeedback('wrong', '✗ 틀린 곳이 있어요. 빨간 표시를 고쳐 다시 확인하거나 [정답 보기]를 눌러 보세요.');
  });
  revealBtn.addEventListener('click', () => {
    widget.check();
    widget.reveal();
    showFeedback('answer', `정답: ${widget.answerText()} — ${item.explain}`);
  });
  resetBtn.addEventListener('click', () => {
    widget.reset();
    showFeedback('', '');
  });

  return card;
}

/* ---------- 형성평가 ---------- */
function buildQuiz(items, ctx) {
  const titleId = nextId('quiz-title');
  const section = el('section', { class: 'quiz', 'aria-labelledby': titleId });
  section.append(
    el('h2', { id: titleId, text: '📝 형성평가' }),
    el('p', { class: 'quiz-intro', text: '모두 풀고 [채점하기]를 누르세요. 고르기·골라 넣기·빈칸은 자동으로 채점하고, 서술형은 핵심어로 스스로 점검해요. 답과 점수는 저장되지 않아요.' }),
  );

  const list = el('ol', { class: 'quiz-list' });
  const entries = items.map((item, index) => {
    const widget = BUILDERS[item.type](item, { ctx });
    const feedback = el('p', { class: 'act-feedback', role: 'status' });
    const li = el('li', { class: `quiz-item type-${item.type}` },
      el('p', { class: 'quiz-item-head' },
        el('span', { class: 'quiz-no', text: `${index + 1}.` }),
        el('span', { class: 'act-chip', text: TYPE_LABEL[item.type] })),
      widget.node,
      feedback);
    list.append(li);
    return { item, widget, feedback, li, result: null };
  });

  const summary = el('div', { class: 'quiz-summary', role: 'status', 'aria-live': 'polite', hidden: '' });
  const buttons = el('div', { class: 'act-buttons' });
  const gradeBtn = el('button', { type: 'button', class: 'btn btn-primary', text: '채점하기' });
  const retryBtn = el('button', { type: 'button', class: 'btn', text: '틀린 문제 다시 풀기', hidden: '' });
  const resetBtn = el('button', { type: 'button', class: 'btn btn-ghost', text: '처음부터 다시', hidden: '' });
  buttons.append(gradeBtn, retryBtn, resetBtn);
  section.append(list, summary, buttons);

  function setFeedback(entry, kind, text) {
    entry.feedback.className = `act-feedback${kind ? ` is-${kind}` : ''}`;
    entry.feedback.textContent = text;
  }

  function grade() {
    const unanswered = [];
    let essayInfo = null;

    entries.forEach((entry, i) => {
      if (entry.result?.correct === true) return;   // 이미 맞힌 문제는 그대로 둠
      const r = entry.widget.check();
      entry.result = r;
      entry.widget.lock(true);
      if (entry.item.type === 'essay') {
        setFeedback(entry, r.answered ? 'answer' : 'wrong',
          r.answered ? `핵심어 ${r.hits}/${r.total}개 포함 — 모범 답안과 비교해 보세요.` : '답을 쓰지 않았어요. 모범 답안을 확인해 보세요.');
        return;
      }
      if (!r.answered) unanswered.push(i + 1);
      if (r.correct) {
        setFeedback(entry, 'correct', `✓ 정답 — ${entry.item.explain}`);
      } else {
        entry.widget.reveal();
        setFeedback(entry, 'wrong', `✗ ${r.answered ? '오답' : '풀지 않음'} — 정답: ${entry.widget.answerText()}. ${entry.item.explain}`);
      }
    });

    let score = 0;
    let total = 0;
    entries.forEach((entry) => {
      if (entry.item.type === 'essay') { essayInfo = entry.result; return; }
      total += 1;
      if (entry.result?.correct) score += 1;
    });

    const ratio = total ? score / total : 0;
    const message = ratio === 1 ? '모두 맞혔어요! 🎉'
      : ratio >= 0.5 ? '잘했어요. 틀린 문제의 해설을 확인해 보세요.'
        : '본문을 다시 읽고 틀린 문제를 다시 풀어 보세요.';
    summary.replaceChildren(...[
      el('p', { class: 'quiz-score' }, '점수 ', el('strong', { text: `${score} / ${total}` }), ` — ${message}`),
      unanswered.length ? el('p', { text: `풀지 않은 문제: ${unanswered.join(', ')}번` }) : null,
      essayInfo ? el('p', { text: `서술형: 핵심어 ${essayInfo.hits}/${essayInfo.total}개 포함 (점수에는 넣지 않음)` }) : null,
    ].filter(Boolean));
    summary.hidden = false;
    gradeBtn.hidden = true;
    retryBtn.hidden = score === total;
    resetBtn.hidden = false;
    summary.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function retryWrong() {
    entries.forEach((entry) => {
      if (entry.item.type === 'essay' || entry.result?.correct) return;
      entry.widget.reset();
      entry.result = null;
      setFeedback(entry, '', '');
    });
    summary.hidden = true;
    gradeBtn.hidden = false;
    retryBtn.hidden = true;
    entries.find((e) => !e.result)?.li.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function resetAll() {
    entries.forEach((entry) => {
      entry.widget.reset();
      entry.result = null;
      setFeedback(entry, '', '');
    });
    summary.hidden = true;
    gradeBtn.hidden = false;
    retryBtn.hidden = true;
    resetBtn.hidden = true;
    section.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  gradeBtn.addEventListener('click', grade);
  retryBtn.addEventListener('click', retryWrong);
  resetBtn.addEventListener('click', resetAll);
  return section;
}

/* ---------- 본문에 붙이기 ---------- */
// "## 3. …" 절의 마지막 요소(다음 h2나 구분선 바로 앞)를 찾는다
function findSectionEnd(reader, sectionNo) {
  const heading = [...reader.querySelectorAll('h2')].find((h) => h.textContent.trim().startsWith(`${sectionNo}.`));
  if (!heading) return null;
  let last = heading;
  let node = heading.nextElementSibling;
  while (node && node.tagName !== 'H2' && node.tagName !== 'HR') {
    last = node;
    node = node.nextElementSibling;
  }
  return last;
}

// 힌트 요청에 함께 보낼 본문(활동·평가는 빼고 글만)
function readBodyText(reader) {
  const clone = reader.cloneNode(true);
  clone.querySelectorAll('.activity, .quiz, table').forEach((n) => n.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim().slice(0, 8000);
}

export async function mountActivities(reader, level, { getLang } = {}) {
  const data = await loadActivities();
  const set = data.levels?.[level];
  if (!set) return;

  const bodyText = readBodyText(reader);
  const ctx = {
    level,
    getLang: () => (level === 'multicultural' ? getLang?.() ?? null : null),
    getBody: () => bodyText,
  };

  (set.inline ?? []).forEach((item) => {
    if (!BUILDERS[item.type]) return;
    const anchor = findSectionEnd(reader, item.after);
    if (anchor) anchor.after(buildInlineCard(item, ctx));
  });

  if (set.quiz?.length) reader.append(buildQuiz(set.quiz.filter((q) => BUILDERS[q.type]), ctx));
}
