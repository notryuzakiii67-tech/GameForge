(() => {
  'use strict';

  const engine = window.GameForgeTowerDefenseEngine;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const moneyEl = document.getElementById('money');
  const livesEl = document.getElementById('lives');
  const waveEl = document.getElementById('wave');
  const messageEl = document.getElementById('message');
  const startEl = document.getElementById('start');
  const pauseEl = document.getElementById('pause');
  const restartEl = document.getElementById('restart');

  const W = engine.width;
  const H = engine.height;
  const N = engine.gridSize;
  const T = engine.tileSize;
  let state = engine.createState();
  let lastFrame = 0;

  function updateHud() {
    moneyEl.textContent = String(state.money);
    livesEl.textContent = String(state.lives);
    waveEl.textContent = String(state.wave);
    messageEl.textContent = state.message;
    startEl.disabled = state.running || state.over;
    pauseEl.disabled = !state.running || state.over;
    pauseEl.textContent = state.paused ? 'Resume' : 'Pause';
    pauseEl.setAttribute('aria-pressed', String(state.paused));
  }

  function draw() {
    const gradient = ctx.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, '#13243a');
    gradient.addColorStop(1, '#0d1530');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    for (let row = 0; row < N; row++) {
      for (let column = 0; column < N; column++) {
        const x = column * T;
        const y = row * T;
        if (state.grid[row][column] === -1) {
          ctx.fillStyle = '#3a2e1a';
          ctx.fillRect(x, y, T, T);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,0.03)';
          ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
        }
      }
    }

    const base = state.pathPoints[state.pathPoints.length - 1];
    ctx.save();
    ctx.shadowBlur = 16;
    ctx.shadowColor = '#80ed99';
    ctx.fillStyle = '#80ed99';
    ctx.beginPath();
    ctx.arc(base.x, base.y, T * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    for (const tower of state.towers) {
      ctx.save();
      ctx.shadowBlur = 10;
      ctx.shadowColor = '#4cc9f0';
      ctx.fillStyle = '#4cc9f0';
      ctx.beginPath();
      ctx.arc(tower.x, tower.y, T * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#0d1530';
      ctx.beginPath();
      ctx.arc(tower.x, tower.y, T * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const enemy of state.enemies) {
      ctx.save();
      ctx.shadowBlur = 8;
      ctx.shadowColor = '#ff5e7e';
      ctx.fillStyle = '#ff5e7e';
      ctx.beginPath();
      ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#0d1530';
      ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 5, enemy.radius * 2, 3);
      ctx.fillStyle = '#80ed99';
      ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 5, enemy.radius * 2 * Math.max(0, enemy.hp / enemy.maxHp), 3);
    }

    for (const bullet of state.bullets) {
      ctx.fillStyle = '#ffe66d';
      ctx.beginPath();
      ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function loop(timestamp) {
    const elapsed = lastFrame ? Math.max(0, (timestamp - lastFrame) / 1000) : 0;
    lastFrame = timestamp;
    if (state.running && !state.paused && !state.over) engine.stepGame(state, elapsed);
    updateHud();
    draw();
    window.requestAnimationFrame(loop);
  }

  canvas.addEventListener('click', (event) => {
    if (state.over) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const column = Math.floor((event.clientX - rect.left) * (W / rect.width) / T);
    const row = Math.floor((event.clientY - rect.top) * (H / rect.height) / T);
    if (engine.buildTower(state, column, row)) updateHud();
    else if (state.message === 'Not enough money!') updateHud();
  });

  startEl.addEventListener('click', () => {
    if (engine.startWave(state)) updateHud();
  });
  pauseEl.addEventListener('click', () => {
    if (engine.togglePause(state)) updateHud();
  });
  restartEl.addEventListener('click', () => {
    state = engine.createState();
    lastFrame = 0;
    updateHud();
    draw();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 'p' && engine.togglePause(state)) {
      event.preventDefault();
      updateHud();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.running && !state.paused && engine.togglePause(state)) updateHud();
  });

  updateHud();
  draw();
  window.requestAnimationFrame(loop);
})();
