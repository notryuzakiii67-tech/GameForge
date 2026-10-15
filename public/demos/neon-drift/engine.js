(function attachNeonDriftEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GameForgeNeonDriftEngine = api;
})(typeof globalThis === "undefined" ? this : globalThis, function createNeonDriftEngine() {
  "use strict";

  const WIDTH = 800;
  const HEIGHT = 500;
  const PLAYER_RADIUS = 10;
  const PLAYER_SPEED = 380;
  const MAX_STEP = 0.05;
  const INITIAL_TIME = 45;

  function makeReadyState() {
    return {
      phase: "ready",
      score: 0,
      time: INITIAL_TIME,
      player: { x: WIDTH / 2, y: HEIGHT / 2, r: PLAYER_RADIUS, vx: 0, vy: 0 },
      orbs: [],
      hazards: [],
      events: [],
    };
  }

  function randomBetween(random, min, max) {
    return min + Math.max(0, Math.min(0.999999999, random())) * (max - min);
  }

  function spawnPoint(random, radius, occupied, keepCenter = false) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const point = { x: randomBetween(random, 38, WIDTH - 38), y: randomBetween(random, 38, HEIGHT - 38) };
      if (keepCenter && Math.hypot(point.x - WIDTH / 2, point.y - HEIGHT / 2) < 80) continue;
      if (occupied.every((other) => Math.hypot(point.x - other.x, point.y - other.y) > radius + (other.r || 0) + 26)) return point;
    }
    for (let y = 60; y < HEIGHT - 30; y += 40) {
      for (let x = 60; x < WIDTH - 30; x += 40) {
        if (keepCenter && Math.hypot(x - WIDTH / 2, y - HEIGHT / 2) < 80) continue;
        if (occupied.every((other) => Math.hypot(x - other.x, y - other.y) > radius + (other.r || 0) + 26)) return { x, y };
      }
    }
    return { x: 70, y: 70 };
  }

  function spawnOrb(random, occupied) {
    const point = spawnPoint(random, 7, occupied, true);
    return { ...point, r: 7, phase: randomBetween(random, 0, Math.PI * 2) };
  }

  function spawnHazard(random, occupied) {
    const radius = randomBetween(random, 18, 30);
    const point = spawnPoint(random, radius, occupied, true);
    return { ...point, r: radius, phase: randomBetween(random, 0, Math.PI * 2), speed: randomBetween(random, 0.55, 1.1) };
  }

  function startGame(random = Math.random) {
    const state = makeReadyState();
    state.phase = "playing";
    for (let index = 0; index < 7; index++) state.orbs.push(spawnOrb(random, [state.player, ...state.orbs]));
    for (let index = 0; index < 3; index++) state.hazards.push(spawnHazard(random, [state.player, ...state.orbs, ...state.hazards]));
    return state;
  }

  function vectorForKeys(keys) {
    const pressed = keys instanceof Set ? keys : new Set(keys || []);
    let x = Number(pressed.has("arrowright") || pressed.has("d")) - Number(pressed.has("arrowleft") || pressed.has("a"));
    let y = Number(pressed.has("arrowdown") || pressed.has("s")) - Number(pressed.has("arrowup") || pressed.has("w"));
    if (x && y) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    return { x, y };
  }

  function distanceToSegment(point, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(point.x - from.x, point.y - from.y);
    const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
  }

  function isGameOver(state, outcome) {
    return { ...state, phase: "over", outcome, time: Math.max(0, state.time), events: [...state.events, { type: "game-over", outcome }] };
  }

  function stepGame(state, input, elapsedSeconds, random = Math.random) {
    if (state.phase !== "playing") return state;
    const dt = Math.max(0, Math.min(MAX_STEP, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0));
    if (dt === 0) return state;

    let time = Math.max(0, state.time - dt);
    const events = [];
    let hazards = state.hazards.map((hazard) => ({ ...hazard, phase: hazard.phase + dt * hazard.speed }));
    const player = { ...state.player };
    const direction = input || { x: 0, y: 0 };
    const from = { x: player.x, y: player.y };
    const alpha = 1 - Math.exp(-8 * dt);
    player.vx += (direction.x * PLAYER_SPEED - player.vx) * alpha;
    player.vy += (direction.y * PLAYER_SPEED - player.vy) * alpha;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    if (player.x < PLAYER_RADIUS + 2 || player.x > WIDTH - PLAYER_RADIUS - 2) player.vx = 0;
    if (player.y < PLAYER_RADIUS + 2 || player.y > HEIGHT - PLAYER_RADIUS - 2) player.vy = 0;
    player.x = Math.max(PLAYER_RADIUS + 2, Math.min(WIDTH - PLAYER_RADIUS - 2, player.x));
    player.y = Math.max(PLAYER_RADIUS + 2, Math.min(HEIGHT - PLAYER_RADIUS - 2, player.y));

    let score = state.score;
    let orbs = [...state.orbs];
    for (let index = orbs.length - 1; index >= 0; index--) {
      const orb = orbs[index];
      if (distanceToSegment(orb, from, player) < player.r + orb.r + 4) {
        score += 10;
        events.push({ type: "orb", x: orb.x, y: orb.y });
        orbs.splice(index, 1);
        orbs.push(spawnOrb(random, [player, ...orbs, ...hazards]));
      }
    }

    let collidedIndex = -1;
    for (let index = 0; index < hazards.length; index++) {
      const hazard = hazards[index];
      const pulse = 1 + Math.sin(hazard.phase) * 0.12;
      if (distanceToSegment(hazard, from, player) < player.r + hazard.r * pulse * 0.6) {
        collidedIndex = index;
        time = Math.max(0, time - 3);
        events.push({ type: "collision", x: hazard.x, y: hazard.y });
        player.x = WIDTH / 2;
        player.y = HEIGHT / 2;
        player.vx = 0;
        player.vy = 0;
        break;
      }
    }
    if (collidedIndex >= 0) {
      hazards[collidedIndex] = spawnHazard(random, [player, ...orbs, ...hazards.filter((_, index) => index !== collidedIndex)]);
    }

    const next = { ...state, score, time, player, orbs, hazards, events };
    if (time <= 0) return isGameOver(next, "time");
    return next;
  }

  function pauseGame(state) {
    return state.phase === "playing" ? { ...state, phase: "paused", events: [] } : state;
  }

  function resumeGame(state) {
    return state.phase === "paused" ? { ...state, phase: "playing", events: [] } : state;
  }

  return Object.freeze({
    width: WIDTH,
    height: HEIGHT,
    initialTime: INITIAL_TIME,
    makeReadyState,
    startGame,
    vectorForKeys,
    distanceToSegment,
    stepGame,
    pauseGame,
    resumeGame,
  });
});
