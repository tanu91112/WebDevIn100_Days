// Whack-a-Mole — script.js
(() => {
  const board = document.getElementById('board');
  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const overlay = document.getElementById('overlay');
  const finalScoreEl = document.getElementById('finalScore');
  const restartBtn = document.getElementById('restartBtn');
  const closeModal = document.getElementById('closeModal');
  const highscoreEl = document.getElementById('highscore');
  const holesSelect = document.getElementById('holesSelect');
  const speedRange = document.getElementById('speedRange');
  const themeToggle = document.getElementById('themeToggle');

  // state
  let holes = [];
  let activeIndex = null;
  let spawnTimer = null;
  let hideTimer = null;
  let running = false;
  let paused = false;

  const state = {
    score: 0,
    lives: 3,
    highscore: Number(localStorage.getItem('wam_high') || 0),
    baseInterval: Number(speedRange.value), // ms between spawns
    upTime: 800, // default mole visible duration (ms)
    multiplier: 1,
  };

  highscoreEl.textContent = state.highscore;

  // Theme
  const savedTheme = localStorage.getItem('wam_theme');
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeToggle.checked = true;
  }

  themeToggle.addEventListener('change', () => {
    const dark = themeToggle.checked;
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('wam_theme', dark ? 'dark' : 'light');
  });

  // sound generator (small click and miss sounds)
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = AudioCtx ? new AudioCtx() : null;
  function playBeep(freq = 440, time = 0.06) {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.value = 0.0001;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + time);
    o.stop(audioCtx.currentTime + time + 0.02);
  }

  // Helpers
  function setScore(v){
    state.score = v;
    scoreEl.textContent = state.score;
    if (state.score > state.highscore){
      state.highscore = state.score;
      localStorage.setItem('wam_high', state.highscore);
      highscoreEl.textContent = state.highscore;
    }
  }
  function setLives(v){
    state.lives = v;
    livesEl.textContent = state.lives;
    if (state.lives <= 0) gameOver();
  }

  // Board build
  function buildBoard(count){
    board.innerHTML = '';
    holes = [];
    // grid layout: adapt columns based on count
    const cols = count <= 6 ? 3 : count === 9 ? 3 : 4;
    board.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    for (let i=0;i<count;i++){
      const hole = document.createElement('div');
      hole.className = 'hole';
      hole.setAttribute('data-index', i);
      hole.setAttribute('tabindex', 0);
      hole.setAttribute('aria-label', `Mole hole ${i+1}`);
      const mole = document.createElement('div');
      mole.className = 'mole';
      mole.setAttribute('role','button');
      mole.setAttribute('aria-pressed','false');
      mole.setAttribute('data-index', i);
      // optional cute face
      mole.innerHTML = `<svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true">
        <g fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="2" stroke-linecap="round">
          <path d="M6 12c2-4 6 0 8 0s6-4 8 0"/>
          <circle cx="10" cy="9" r="1.4"/>
          <circle cx="22" cy="9" r="1.4"/>
        </g>
      </svg>`;
      hole.appendChild(mole);
      board.appendChild(hole);
      holes.push({hole, mole, index:i, shown:false, clicked:false});
      // event
      mole.addEventListener('click', onMoleClick);
      // keyboard support
      hole.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' '){
          // simulate click if mole is shown
          const idx = Number(hole.dataset.index);
          if (holes[idx].shown) onMoleClick({currentTarget: holes[idx].mole});
        }
      });
    }
  }

  function onMoleClick(e){
    const mole = e.currentTarget;
    const idx = Number(mole.dataset.index);
    const entry = holes[idx];
    if (!entry || !entry.shown) return;
    if (entry.clicked) return; // already hit
    entry.clicked = true;
    // animate hit
    mole.classList.remove('show');
    entry.shown = false;
    entry.mole.setAttribute('aria-pressed','true');
    playBeep(900, 0.08);
    setScore(state.score + 1);
    increaseDifficulty();
    // clear hide timer only if the active one belongs to this index
    if (idx === activeIndex) {
      clearTimeout(hideTimer);
      activeIndex = null;
      scheduleNext();
    }
  }

  // spawn logic
  function pickRandomHole(){
    if (holes.length === 0) return null;
    let i;
    do {
      i = Math.floor(Math.random()*holes.length);
    } while (holes[i].shown && holes.some(h=>!h.shown) && holes.length>1);
    return i;
  }

  function showMoleAt(idx){
    if (idx == null) return;
    const entry = holes[idx];
    entry.shown = true;
    entry.clicked = false;
    entry.mole.classList.add('show');
    entry.mole.setAttribute('aria-pressed','false');
    activeIndex = idx;
    // hide after upTime
    hideTimer = setTimeout(()=>{ hideMole(idx, /*missed*/ !entry.clicked); }, state.upTime);
  }

  function hideMole(idx, missed = true){
    const entry = holes[idx];
    if (!entry) return;
    entry.shown = false;
    entry.mole.classList.remove('show');
    entry.mole.setAttribute('aria-pressed','false');
    if (missed){
      // if not clicked, lose life
      setLives(Math.max(0, state.lives - 1));
      playBeep(160, 0.09);
    } else {
      playBeep(520, 0.05);
    }
    activeIndex = null;
    scheduleNext();
  }

  function scheduleNext(){
    if (!running || paused) return;
    clearTimeout(spawnTimer);
    const interval = Math.max(150, state.baseInterval - Math.floor(state.score * state.multiplier));
    spawnTimer = setTimeout(()=> {
      const idx = pickRandomHole();
      if (idx == null) return scheduleNext();
      showMoleAt(idx);
    }, interval);
  }

  function increaseDifficulty(){
    // gradually reduce upTime and interval multiplier as score climbs
    state.upTime = Math.max(220, 800 - Math.floor(state.score * 18));
    // increase multiplier slowly to make interval drop
    state.multiplier = 6 + Math.floor(state.score / 10);
  }

  // Game flow
  function startGame(){
    if (running) return;
    // prepare state
    setScore(0);
    setLives(3);
    state.baseInterval = Number(speedRange.value);
    state.upTime = 800;
    state.multiplier = 1;
    running = true;
    paused = false;
    startBtn.textContent = 'Restart';
    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = false;
    // build board from selection
    buildBoard(Number(holesSelect.value));
    scheduleNext();
  }

  function pauseGame(){
    if (!running) return;
    paused = !paused;
    if (paused){
      pauseBtn.textContent = 'Resume';
      clearTimeout(spawnTimer);
      clearTimeout(hideTimer);
    } else {
      pauseBtn.textContent = 'Pause';
      scheduleNext();
      // if a mole was visible but its hide timer cleared, ensure it hides naturally later
      if (activeIndex != null) hideTimer = setTimeout(()=> hideMole(activeIndex, true), state.upTime);
    }
  }

  function stopGame(){
    running = false;
    paused = false;
    clearTimeout(spawnTimer);
    clearTimeout(hideTimer);
    activeIndex = null;
    startBtn.textContent = 'Start';
    pauseBtn.textContent = 'Pause';
    pauseBtn.disabled = true;
    // clear shown moles
    holes.forEach(h => { h.shown = false; h.clicked = false; h.mole.classList.remove('show'); });
  }

  function gameOver(){
    stopGame();
    finalScoreEl.textContent = state.score;
    overlay.classList.remove('hidden');
    document.getElementById('modalTitle').textContent = 'Game Over';
    playBeep(120, 0.4);
  }

  // UI wiring
  startBtn.addEventListener('click', () => {
    if (running) {
      // confirm restart quickly
      if (!confirm('Restart the game?')) return;
      stopGame();
      startGame();
    } else startGame();
  });

  pauseBtn.addEventListener('click', pauseGame);
  restartBtn.addEventListener('click', () => {
    overlay.classList.add('hidden');
    startGame();
  });
  closeModal.addEventListener('click', () => overlay.classList.add('hidden'));

  // sliders & selects
  holesSelect.addEventListener('change', () => {
    if (running) {
      // rebuild board while retaining score/lives
      buildBoard(Number(holesSelect.value));
    } else buildBoard(Number(holesSelect.value));
  });

  speedRange.addEventListener('input', () => {
    state.baseInterval = Number(speedRange.value);
  });

  // initial build
  buildBoard(Number(holesSelect.value));
  pauseBtn.disabled = true;

  // accessibility: keyboard global shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'p') pauseGame();
    if (e.key === 's') startBtn.click();
  });

  // expose some debug for future features
  window.wamState = state;
})();
