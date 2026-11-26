// 읽기 도구: 다문화 낱말 밑줄·뜻 말풍선, 글자 크게 보기, 음성 읽어 주기

// 낱말 풀이 표의 열 제목에서 이 글자를 찾아 언어별 뜻 열을 고른다
const LANGS = {
  vi: { label: '베트남어', match: '베트남어', speech: 'vi-VN', htmlLang: 'vi' },
  zh: { label: '중국어', match: '중국어', speech: 'zh-CN', htmlLang: 'zh' },
};

const SIZES = [
  { key: 'normal', label: '보통' },
  { key: 'large', label: '크게' },
  { key: 'xlarge', label: '아주 크게' },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function initReaderTools({ reader, langSelect, fontBtn, speakBtn, popover }) {
  let glossary = new Map();   // 낱말 → { word, easy, meanings: { vi, zh } }
  let openTerm = null;        // 지금 말풍선이 열린 밑줄 낱말 버튼

  /* ---------- 글자 크게 보기 ---------- */
  let sizeIndex = 0;
  function applySize() {
    const size = SIZES[sizeIndex];
    reader.dataset.size = size.key;
    fontBtn.textContent = `가+ 글자 크기: ${size.label}`;
    fontBtn.setAttribute('aria-pressed', String(sizeIndex > 0));
    if (openTerm) positionPopover(openTerm);
  }
  fontBtn.addEventListener('click', () => {
    sizeIndex = (sizeIndex + 1) % SIZES.length;
    applySize();
  });
  applySize();

  /* ---------- 낱말 풀이 표 읽기 ---------- */
  function parseGlossary() {
    const heading = [...reader.querySelectorAll('h2')].find((h) => h.textContent.includes('낱말 풀이'));
    if (!heading) return new Map();
    let table = heading.nextElementSibling;
    while (table && table.tagName !== 'TABLE' && !/^H[1-2]$/.test(table.tagName)) {
      table = table.nextElementSibling;
    }
    if (!table || table.tagName !== 'TABLE') return new Map();

    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    const col = (keyword) => headers.findIndex((h) => h.includes(keyword));
    const easyCol = col('뜻');
    const langCols = Object.fromEntries(
      Object.entries(LANGS).map(([code, info]) => [code, col(info.match)]),
    );

    const map = new Map();
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const cells = [...tr.children].map((td) => td.textContent.trim());
      const word = cells[0];
      if (!word) return;
      map.set(word, {
        word,
        easy: easyCol >= 0 ? cells[easyCol] : '',
        meanings: Object.fromEntries(
          Object.entries(langCols).map(([code, i]) => [code, i >= 0 ? cells[i] : '']),
        ),
      });
    });
    return map;
  }

  /* ---------- 본문 낱말에 밑줄 ---------- */
  function makeTerm(word) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'term';
    btn.dataset.word = word;
    btn.textContent = word;
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', `${word}, 눌러서 뜻 보기`);
    return btn;
  }

  function underlineTerms() {
    if (!glossary.size) return;
    const words = [...glossary.keys()].sort((a, b) => b.length - a.length);
    const pattern = words.map(escapeRe).join('|');
    const testRe = new RegExp(pattern);
    const globalRe = new RegExp(pattern, 'g');

    // 제목·표(낱말 풀이)·버튼 안의 글자는 건드리지 않음
    const walker = document.createTreeWalker(reader, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest('h1, h2, h3, table, button, code, pre')) {
          return NodeFilter.FILTER_REJECT;
        }
        return testRe.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    nodes.forEach((node) => {
      const text = node.nodeValue;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of text.matchAll(globalRe)) {
        frag.append(text.slice(last, m.index), makeTerm(m[0]));
        last = m.index + m[0].length;
      }
      frag.append(text.slice(last));
      node.replaceWith(frag);
    });
  }

  /* ---------- 뜻 말풍선 ---------- */
  const pop = {
    word: popover.querySelector('.pop-word'),
    easy: popover.querySelector('.pop-easy'),
    langLabel: popover.querySelector('.pop-lang-label'),
    meaning: popover.querySelector('.pop-meaning'),
    sayLabel: popover.querySelector('.pop-say-label'),
    close: popover.querySelector('.popover-close'),
  };

  function fillPopover(entry) {
    const lang = LANGS[langSelect.value] ?? LANGS.vi;
    pop.word.textContent = entry.word;
    pop.easy.textContent = entry.easy;
    pop.langLabel.textContent = lang.label;
    pop.meaning.textContent = entry.meanings[langSelect.value] || '(뜻 없음)';
    pop.meaning.lang = lang.htmlLang;
    pop.sayLabel.textContent = lang.label;
  }

  function positionPopover(btn) {
    const rect = btn.getBoundingClientRect();
    const width = popover.offsetWidth;
    const left = Math.min(
      Math.max(8, rect.left + window.scrollX),
      window.scrollX + document.documentElement.clientWidth - width - 8,
    );
    popover.style.left = `${left}px`;
    popover.style.top = `${rect.bottom + window.scrollY + 8}px`;
  }

  function openPopover(btn) {
    const entry = glossary.get(btn.dataset.word);
    if (!entry) return;
    if (openTerm && openTerm !== btn) openTerm.setAttribute('aria-expanded', 'false');
    openTerm = btn;
    btn.setAttribute('aria-expanded', 'true');
    fillPopover(entry);
    popover.hidden = false;
    positionPopover(btn);
    pop.close.focus({ preventScroll: true });
  }

  function closePopover({ returnFocus = false } = {}) {
    if (popover.hidden) return;
    popover.hidden = true;
    if (openTerm) {
      openTerm.setAttribute('aria-expanded', 'false');
      if (returnFocus) openTerm.focus({ preventScroll: true });
    }
    openTerm = null;
  }

  reader.addEventListener('click', (e) => {
    const term = e.target.closest('.term');
    if (!term) return;
    if (openTerm === term) closePopover();
    else openPopover(term);
  });
  pop.close.addEventListener('click', () => closePopover({ returnFocus: true }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover({ returnFocus: true });
  });
  document.addEventListener('click', (e) => {
    if (!popover.hidden && !popover.contains(e.target) && !e.target.closest('.term')) closePopover();
  });
  window.addEventListener('resize', () => { if (openTerm) positionPopover(openTerm); });
  langSelect.addEventListener('change', () => {
    if (openTerm) fillPopover(glossary.get(openTerm.dataset.word));
  });
  popover.addEventListener('click', (e) => {
    const sayBtn = e.target.closest('[data-say]');
    if (!sayBtn || !openTerm) return;
    const entry = glossary.get(openTerm.dataset.word);
    if (sayBtn.dataset.say === 'ko') sayOnce(entry.word, 'ko-KR');
    else sayOnce(entry.meanings[langSelect.value] ?? '', (LANGS[langSelect.value] ?? LANGS.vi).speech);
  });

  /* ---------- 음성 읽어 주기 ---------- */
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let speaking = false;
  let session = 0;
  let queue = [];
  let queueIndex = 0;

  if (!synth) {
    speakBtn.disabled = true;
    speakBtn.title = '이 브라우저는 음성 읽기를 지원하지 않아요';
    popover.querySelectorAll('[data-say]').forEach((b) => { b.disabled = true; });
  }

  const cleanForSpeech = (t) => t.replace(/[➕🔊🌏]/g, '').replace(/\s+/g, ' ').trim();

  // 읽을 덩어리: 제목·문단·목록 항목 (표는 외국어가 섞여 있어 건너뜀)
  function speechBlocks() {
    return [...reader.querySelectorAll('h1, h2, h3, p, li')].filter(
      (el) => !el.closest('table, .activity, .quiz') && !(el.tagName === 'LI' && el.querySelector('p')),
    );
  }

  function clearHighlight() {
    reader.querySelectorAll('.speaking').forEach((el) => el.classList.remove('speaking'));
  }

  function updateSpeakBtn() {
    speakBtn.textContent = speaking ? '⏹ 읽기 멈춤' : '🔊 읽어 주기';
    speakBtn.setAttribute('aria-pressed', String(speaking));
  }

  function speakNext(mySession) {
    if (mySession !== session) return;
    clearHighlight();
    if (queueIndex >= queue.length) { stopSpeaking(); return; }
    const el = queue[queueIndex++];
    const text = cleanForSpeech(el.textContent);
    if (!text) { speakNext(mySession); return; }
    el.classList.add('speaking');
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = reader.dataset.level === 'multicultural' ? 0.85 : 1;
    u.onend = () => speakNext(mySession);
    u.onerror = () => { if (mySession === session) stopSpeaking(); };
    synth.speak(u);
  }

  function startSpeaking() {
    if (!synth) return;
    synth.cancel();
    session += 1;
    queue = speechBlocks();
    queueIndex = 0;
    speaking = true;
    updateSpeakBtn();
    speakNext(session);
  }

  function stopSpeaking() {
    session += 1;
    speaking = false;
    if (synth) synth.cancel();
    clearHighlight();
    updateSpeakBtn();
  }

  function sayOnce(text, lang) {
    if (!synth || !text) return;
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.85;
    synth.speak(u);
  }

  speakBtn.addEventListener('click', () => (speaking ? stopSpeaking() : startSpeaking()));
  window.addEventListener('pagehide', stopSpeaking);

  /* ---------- 밖에서 부르는 함수 ---------- */
  return {
    onContentLoaded({ multicultural }) {
      glossary = multicultural ? parseGlossary() : new Map();
      if (multicultural) underlineTerms();
    },
    reset() {
      stopSpeaking();
      closePopover();
      glossary = new Map();
    },
    closePopover: () => closePopover(),
  };
}
