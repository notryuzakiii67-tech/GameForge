(function attachTowerDefenseEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GameForgeTowerDefenseEngine = api;
})(typeof globalThis === "undefined" ? this : globalThis, function createTowerDefenseEngine() {
  "use strict";

  const width = 520;
  const height = 520;
  const size = 13;
  const tile = width / size;
  const towerCost = 30;
  const spawnInterval = 0.6;
  const maxStep = 0.05;
  const path = [
    [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [5, 2], [5, 3], [5, 4], [5, 5],
    [4, 5], [3, 5], [2, 5], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [1, 10], [1, 11],
    [2, 11], [3, 11], [4, 11], [5, 11], [6, 11], [7, 11], [8, 11], [9, 11], [10, 11], [11, 11],
  ];

  function pathPoints() {
    return path.map(([column, row]) => ({ x: column * tile + tile / 2, y: row * tile + tile / 2 }));
  }

  function createState() {
    const grid = Array.from({ length: size }, () => new Array(size).fill(0));
    for (const [column, row] of path) grid[row][column] = -1;
    return {
      grid,
      towers: [],
      enemies: [],
      bullets: [],
      money: 100,
      lives: 20,
      wave: 0,
      running: false,
      paused: false,
      over: false,
      spawnQ: 0,
      spawnTimer: 0,
      pathPoints: pathPoints(),
      message: "Click an empty tile to build a tower (30). Then Start Wave.",
      events: [],
    };
  }

  function inside(column, row) {
    return Number.isInteger(column) && Number.isInteger(row) && column >= 0 && column < size && row >= 0 && row < size;
  }

  function buildTower(state, column, row) {
    if (!inside(column, row) || state.over || state.grid[row][column] !== 0) return false;
    if (state.money < towerCost) {
      state.message = "Not enough money!";
      return false;
    }
    state.money -= towerCost;
    state.grid[row][column] = 1;
    state.towers.push({ x: column * tile + tile / 2, y: row * tile + tile / 2, range: tile * 2.4, cooldown: 0, fireRate: 28 / 60, damage: 10 });
    state.message = "Tower built. Start a wave when you are ready.";
    state.events = [{ type: "tower-built", column, row }];
    return true;
  }

  function startWave(state) {
    if (state.over || state.running) return false;
    state.wave += 1;
    state.spawnQ = 6 + state.wave * 2;
    state.spawnTimer = 0;
    state.running = true;
    state.paused = false;
    state.message = `Wave ${state.wave} incoming!`;
    state.events = [{ type: "wave-start", wave: state.wave }];
    return true;
  }

  function togglePause(state) {
    if (state.over || !state.running) return false;
    state.paused = !state.paused;
    state.message = state.paused ? `Wave ${state.wave} paused.` : `Wave ${state.wave} incoming!`;
    state.events = [{ type: state.paused ? "paused" : "resumed", wave: state.wave }];
    return true;
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function distanceToSegment(point, from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return distance(point, from);
    const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
  }

  function spawnEnemy(state) {
    const hp = 20 + state.wave * 8;
    const first = state.pathPoints[0];
    state.enemies.push({ segment: 0, x: first.x, y: first.y, hp, maxHp: hp, speed: 1.1 + state.wave * 0.05, radius: 11, dead: false });
    state.events.push({ type: "enemy-spawned", wave: state.wave });
  }

  function stepGame(state, elapsedSeconds) {
    state.events = [];
    if (!state.running || state.paused || state.over) return state;
    const dt = Math.max(0, Math.min(maxStep, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0));
    if (dt === 0) return state;

    if (state.spawnQ > 0) {
      state.spawnTimer += dt;
      while (state.spawnQ > 0 && state.spawnTimer + 1e-9 >= spawnInterval) {
        state.spawnTimer -= spawnInterval;
        state.spawnQ -= 1;
        spawnEnemy(state);
      }
    }

    for (const enemy of state.enemies) {
      enemy.segment += (enemy.speed * 30 * dt) / tile;
      const lastSegment = state.pathPoints.length - 1;
      if (enemy.segment >= lastSegment) {
        enemy.dead = true;
        state.lives -= 1;
        state.events.push({ type: "base-hit", lives: state.lives });
        if (state.lives <= 0) {
          state.over = true;
          state.running = false;
          state.paused = false;
          state.message = "Base destroyed! Restart to play again.";
        }
        continue;
      }
      const segmentIndex = Math.floor(enemy.segment);
      const from = state.pathPoints[segmentIndex];
      const to = state.pathPoints[segmentIndex + 1];
      const fraction = enemy.segment - segmentIndex;
      enemy.x = from.x + (to.x - from.x) * fraction;
      enemy.y = from.y + (to.y - from.y) * fraction;
    }

    for (const tower of state.towers) {
      tower.cooldown = Math.max(0, tower.cooldown - dt);
      if (tower.cooldown > 0) continue;
      let target = null;
      let nearest = tower.range;
      for (const enemy of state.enemies) {
        if (enemy.dead) continue;
        const currentDistance = distance(tower, enemy);
        if (currentDistance < nearest) {
          nearest = currentDistance;
          target = enemy;
        }
      }
      if (target) {
        state.bullets.push({ x: tower.x, y: tower.y, target, damage: tower.damage, speed: 360, done: false });
        tower.cooldown = tower.fireRate;
      }
    }

    for (const bullet of state.bullets) {
      if (!bullet.target || bullet.target.dead) {
        bullet.done = true;
        continue;
      }
      const from = { x: bullet.x, y: bullet.y };
      const dx = bullet.target.x - bullet.x;
      const dy = bullet.target.y - bullet.y;
      const remaining = Math.hypot(dx, dy);
      const travel = Math.min(remaining, bullet.speed * dt);
      const to = remaining === 0 ? from : { x: bullet.x + (dx / remaining) * travel, y: bullet.y + (dy / remaining) * travel };
      if (distanceToSegment(bullet.target, from, to) <= bullet.target.radius + 3) {
        bullet.target.hp -= bullet.damage;
        bullet.done = true;
        if (bullet.target.hp <= 0 && !bullet.target.dead) {
          bullet.target.dead = true;
          state.money += 8;
          state.events.push({ type: "enemy-destroyed", reward: 8, money: state.money });
        }
      } else {
        bullet.x = to.x;
        bullet.y = to.y;
      }
    }

    state.enemies = state.enemies.filter((enemy) => !enemy.dead);
    state.bullets = state.bullets.filter((bullet) => !bullet.done);
    if (state.over) return state;

    if (state.running && state.spawnQ === 0 && state.enemies.length === 0) {
      state.running = false;
      state.paused = false;
      state.message = `Wave ${state.wave} cleared! Build and start the next wave.`;
      state.events.push({ type: "wave-cleared", wave: state.wave });
    }
    return state;
  }

  return Object.freeze({
    width,
    height,
    gridSize: size,
    tileSize: tile,
    towerCost,
    spawnInterval,
    maxStep,
    path,
    createState,
    buildTower,
    startWave,
    togglePause,
    stepGame,
    distanceToSegment,
  });
});
