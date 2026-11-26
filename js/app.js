// 학생 화면: 수준 선택 → materials/*.md 읽기 → 화면 표시
import { initReaderTools } from './reader-tools.js';
import { createFocusMode } from './focus.js';
import { mountActivities } from './activities.js';
import { initStudent } from './student.js';

const LEVELS = {
  basic: { label: '기초', file: '기초.md' },
  normal: { label: '보통', file: '보통.md' },
  advanced: { label: '심화', file: '심화.md' },
  multicultural: { label: '다문화', file: '다문화.md' },
};

const $ = (id) => document.getElementById(id);
const els = {
  levelScreen: $('levelScreen'),
  readerScreen: $('readerScreen'),
  reader: $('reader'),
  levelBadge: $('levelBadge'),
  backBtn: $('backBtn'),
  mcToggle: $('mcToggle'),
  langSelect: $('langSelect'),
  mcNotice: $('mcNotice'),
};

const state = {
  level: null,        // 지금 보고 있는 수준
  lastLevel: null,    // 다문화 모드를 켜기 전에 보던 수준
  multicultural: false,
  loadToken: 0,       // 빠르게 여러 번 눌렀을 때 늦게 온 응답 무시
};

const tools = initReaderTools({
  reader: els.reader,
  langSelect: els.langSelect,
  fontBtn: $('fontBtn'),
  speakBtn: $('speakBtn'),
  popover: $('termPopover'),
});

// 반 코드·학번 입력 칸(저장 기능에서 사용)
initStudent({
  classInput: $('classCodeInput'),
  noInput: $('studentNoInput'),
  statusEl: $('studentStatus'),
  badgeEl: $('whoBadge'),
});

const focus = createFocusMode({
  startBtn: $('focusStartBtn'),
  endBtn: $('focusEndBtn'),
  statusBar: $('focusStatus'),
  timeEl: $('focusTime'),
  countEl: $('awayCount'),
  noteEl: $('focusNote'),
  resultEl: $('focusResult'),
  overlay: $('awayOverlay'),
  overlayBadge: $('awayBadge'),
  overlayTitle: $('awayTitle'),
  overlayText: $('awayText'),
  overlayBtn: $('awayBtn'),
  onAway: () => tools.closePopover(),
});

/* ---------- 마크다운 읽기 ---------- */
async function loadMarkdown(file) {
  const res = await fetch(`materials/${encodeURIComponent(file)}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// 학생에게 보이면 안 되는 부분 제거: 맨 위 안내 인용문, 교사용 정답
// md의 '확인 질문'은 형성평가(activities.json)가 대신하므로 그 절부터 잘라 낸다
function prepareMarkdown(md) {
  let text = md.replace(/\r\n/g, '\n');
  const questionsAt = text.search(/^##\s*확인 질문/m);
  if (questionsAt !== -1) text = text.slice(0, questionsAt);
  const answerAt = text.search(/^###\s*정답\(교사용\)/m);
  if (answerAt !== -1) text = text.slice(0, answerAt);
  text = text.replace(/^(?:>.*\n)+/m, '');
  return text.trim();
}

// breaks: 다문화 자료는 한 줄에 한 문장씩 써 두었으므로 줄바꿈을 그대로 살림
function renderMarkdown(md, { breaks = false } = {}) {
  if (!window.marked || !window.DOMPurify) {
    throw new Error('LIB_NOT_LOADED');
  }
  const html = window.marked.parse(md, { breaks });
  els.reader.innerHTML = window.DOMPurify.sanitize(html);
}

function showError(err) {
  els.reader.replaceChildren();
  const p = document.createElement('p');
  p.className = 'load-error';
  if (location.protocol === 'file:') {
    p.textContent = '파일을 직접 열면 자료를 읽을 수 없어요. 이 폴더에서 로컬 서버(예: python -m http.server)를 켜고 http://localhost 주소로 열어 주세요.';
  } else if (err.message === 'LIB_NOT_LOADED') {
    p.textContent = '화면 표시 도구를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.';
  } else {
    p.textContent = `자료를 불러오지 못했어요 (${err.message}). materials 폴더에 파일이 있는지 확인해 주세요.`;
  }
  els.reader.append(p);
}

/* ---------- 화면 전환 ---------- */
async function openLevel(level) {
  const info = LEVELS[level];
  if (!info) return;
  const token = ++state.loadToken;

  tools.reset();
  state.level = level;
  els.levelScreen.hidden = true;
  els.readerScreen.hidden = false;
  els.levelBadge.textContent = info.label;
  els.levelBadge.classList.toggle('is-mc', level === 'multicultural');
  els.mcNotice.hidden = level !== 'multicultural';
  els.reader.dataset.level = level;
  els.reader.setAttribute('aria-busy', 'true');
  els.reader.textContent = '자료를 불러오는 중…';

  try {
    const md = await loadMarkdown(info.file);
    if (token !== state.loadToken) return;
    renderMarkdown(prepareMarkdown(md), { breaks: level === 'multicultural' });
    tools.onContentLoaded({ multicultural: level === 'multicultural' });
    try {
      await mountActivities(els.reader, level, { getLang: () => els.langSelect.value });
    } catch (err) {
      if (token !== state.loadToken) return;
      const p = document.createElement('p');
      p.className = 'load-error';
      p.textContent = `학습 활동을 불러오지 못했어요 (${err.message}). materials/activities.json을 확인해 주세요.`;
      els.reader.append(p);
    }
  } catch (err) {
    if (token !== state.loadToken) return;
    showError(err);
  } finally {
    if (token === state.loadToken) els.reader.removeAttribute('aria-busy');
  }
  window.scrollTo({ top: 0 });
}

function showLevelScreen() {
  state.loadToken++;
  tools.reset();
  focus.end({ silent: true });
  state.level = null;
  els.readerScreen.hidden = true;
  els.levelScreen.hidden = false;
  window.scrollTo({ top: 0 });
}

function setMulticultural(on) {
  state.multicultural = on;
  els.mcToggle.setAttribute('aria-pressed', String(on));
  els.langSelect.disabled = !on;
}

/* ---------- 이벤트 ---------- */
document.querySelectorAll('.level-card').forEach((card) => {
  card.addEventListener('click', () => {
    setMulticultural(false);
    openLevel(card.dataset.level);
  });
});

els.mcToggle.addEventListener('click', () => {
  if (!state.multicultural) {
    if (state.level && state.level !== 'multicultural') state.lastLevel = state.level;
    setMulticultural(true);
    openLevel('multicultural');
  } else {
    setMulticultural(false);
    if (state.lastLevel) openLevel(state.lastLevel);
    else showLevelScreen();
  }
});

els.backBtn.addEventListener('click', () => {
  setMulticultural(false);
  state.lastLevel = null;
  showLevelScreen();
});
