// 집중 모드: 전체 화면 + 이탈 감지(마우스가 화면 밖 / 다른 탭·창 / 전체 화면 해제) + 집중 시간
// 기록은 메모리에만 두고 화면에만 보여 준다. localStorage 등 어디에도 저장하지 않는다.

const MESSAGES = {
  mouse: {
    title: '마우스가 화면 밖으로 나갔어요',
    text: '마우스를 화면 안으로 다시 가져오면 이어서 읽을 수 있어요.',
    button: null,
  },
  tab: {
    title: '다른 탭이나 창에 다녀왔어요',
    text: '준비되면 아래 버튼을 눌러 다시 집중해 주세요.',
    button: '다시 집중하기',
  },
  fullscreen: {
    title: '전체 화면이 꺼졌어요',
    text: '아래 버튼을 누르면 전체 화면으로 돌아가요.',
    button: '전체 화면으로 돌아가기',
  },
};

const formatTime = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
};

export function createFocusMode({
  startBtn, endBtn, statusBar, timeEl, countEl, noteEl, resultEl,
  overlay, overlayBadge, overlayTitle, overlayText, overlayBtn, onAway,
}) {
  const canFullscreen = Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);

  let active = false;
  let startAt = 0;        // 집중 시작 시각
  let awayTotal = 0;      // 끝난 이탈들의 시간 합
  let awayStart = null;   // 진행 중인 이탈의 시작 시각
  let awayCount = 0;
  let awayReason = null;  // 'mouse' | 'tab' | 'fullscreen' (안내가 떠 있는 동안 유지)
  let timer = null;

  // 이탈 시간을 빼고 계산. setInterval 횟수가 아니라 시각 차이로 계산해 탭이 숨겨져도 정확함
  function focusMs(now = Date.now()) {
    const currentAway = awayStart !== null ? now - awayStart : 0;
    return now - startAt - awayTotal - currentAway;
  }

  function render() {
    timeEl.textContent = formatTime(focusMs());
    countEl.textContent = String(awayCount);
  }

  /* ---------- 안내 화면 ---------- */
  function showOverlay(reason) {
    const msg = MESSAGES[reason];
    overlayBadge.textContent = `이탈 ${awayCount}번째`;
    overlayTitle.textContent = msg.title;
    overlayText.textContent = msg.text;
    overlayBtn.hidden = !msg.button;
    overlayBtn.textContent = msg.button ?? '';
    overlay.hidden = false;
    document.body.classList.add('is-away');
    if (msg.button) overlayBtn.focus({ preventScroll: true });
  }

  function hideOverlay() {
    overlay.hidden = true;
    document.body.classList.remove('is-away');
    awayReason = null;
  }

  /* ---------- 이탈 시작·끝 ---------- */
  // 버튼이 필요한 이유(tab, fullscreen)가 마우스 이탈보다 우선한다
  const PRIORITY = { mouse: 1, tab: 2, fullscreen: 3 };

  function startAway(reason) {
    if (!active) return;
    if (awayStart === null && awayReason === null) {
      awayStart = Date.now();
      awayCount += 1;
      onAway?.();
    } else if (awayStart === null) {
      // 안내가 떠 있는 채로(복귀 버튼 대기 중) 다시 나간 경우: 같은 이탈로 보고 시간만 다시 잼
      awayStart = Date.now();
    }
    if (!awayReason || PRIORITY[reason] > PRIORITY[awayReason]) awayReason = reason;
    showOverlay(awayReason);
    render();
  }

  function endAway() {
    if (awayStart === null) return;
    awayTotal += Date.now() - awayStart;
    awayStart = null;
    render();
  }

  /* ---------- 감지 ---------- */
  function onMouseOut(e) {
    if (e.relatedTarget) return;                              // 페이지 안 다른 요소로 이동
    if (document.activeElement?.tagName === 'SELECT') return; // 언어 선택 목록이 열릴 때 오감지 방지
    startAway('mouse');
  }
  function onMouseOver() {
    if (awayReason === 'mouse') {
      endAway();
      hideOverlay();
    }
  }
  function onVisibility() {
    if (document.hidden) startAway('tab');
    else if (awayReason === 'tab') endAway();   // 돌아왔으면 시간은 멈추고, 안내는 버튼으로 닫음
  }
  function onWindowBlur() { startAway('tab'); }
  function onWindowFocus() { if (awayReason === 'tab') endAway(); }
  function onFullscreenChange() {
    if (active && canFullscreen && !document.fullscreenElement) startAway('fullscreen');
  }

  async function enterFullscreen() {
    if (!canFullscreen || document.fullscreenElement) return;
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      noteEl.textContent = '전체 화면으로 바꾸지 못했어요. 전체 화면 없이 집중 모드를 이어 갈게요.';
      noteEl.hidden = false;
    }
  }

  overlayBtn.addEventListener('click', async () => {
    endAway();
    hideOverlay();
    await enterFullscreen();
  });

  function listen(on) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    document[method]('mouseout', onMouseOut);
    document[method]('mouseover', onMouseOver);
    document[method]('visibilitychange', onVisibility);
    document[method]('fullscreenchange', onFullscreenChange);
    window[method]('blur', onWindowBlur);
    window[method]('focus', onWindowFocus);
  }

  /* ---------- 시작·끝 ---------- */
  async function start() {
    if (active) return;
    active = true;
    startAt = Date.now();
    awayTotal = 0;
    awayStart = null;
    awayCount = 0;
    awayReason = null;

    resultEl.hidden = true;
    startBtn.hidden = true;
    statusBar.hidden = false;
    noteEl.hidden = true;
    if (!canFullscreen) {
      noteEl.textContent = '이 기기는 전체 화면을 지원하지 않아요. 전체 화면 없이 집중 모드를 시작할게요.';
      noteEl.hidden = false;
    }

    render();
    timer = setInterval(render, 500);
    listen(true);
    await enterFullscreen();
  }

  function end({ silent = false } = {}) {
    if (!active) return;
    endAway();
    const finalMs = focusMs();
    active = false;               // 전체 화면 해제를 이탈로 세지 않도록 먼저 끈다
    listen(false);
    clearInterval(timer);
    timer = null;
    hideOverlay();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});

    statusBar.hidden = true;
    startBtn.hidden = false;
    noteEl.hidden = true;
    if (!silent) {
      resultEl.textContent = `집중 시간 ${formatTime(finalMs)} · 이탈 ${awayCount}회 — 이 기록은 화면에만 보이고 저장되지 않아요.`;
      resultEl.hidden = false;
    }
  }

  startBtn.addEventListener('click', start);
  endBtn.addEventListener('click', () => end());

  return { start, end, isActive: () => active };
}
