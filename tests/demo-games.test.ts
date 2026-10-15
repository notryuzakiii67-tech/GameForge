import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const mazeEngine = require("../public/demos/maze-engine.js");
const neonEngine = require("../public/demos/neon-drift/engine.js");
const arcadeMazeEngine = require("../public/demos/web-arcade-maze/maze-engine.js");
const towerDefenseEngine = require("../public/demos/tower-defense/engine.js");
const { mosslight, oneMoreRoom } = mazeEngine.maps;

function followPath(map: any, path: { x: number; y: number }[], initial: any, move: (state: any, dx: number, dy: number, map: any) => any) {
  let state = initial;
  for (let index = 1; index < path.length; index++) {
    const dx = path[index].x - path[index - 1].x;
    const dy = path[index].y - path[index - 1].y;
    state = move(state, dx, dy, map);
  }
  return state;
}

function pathAvoiding(map: any, from: { x: number; y: number }, to: { x: number; y: number }, forbidden?: { x: number; y: number }) {
  const startKey = `${from.x},${from.y}`;
  const targetKey = `${to.x},${to.y}`;
  const parents = new Map<string, string | null>([[startKey, null]]);
  const queue = [from];
  for (let head = 0; head < queue.length && !parents.has(targetKey); head++) {
    const current = queue[head];
    for (const direction of mazeEngine.directions) {
      if (!mazeEngine.canMove(map, current, direction.x, direction.y)) continue;
      const next = { x: current.x + direction.x, y: current.y + direction.y };
      if (forbidden && next.x === forbidden.x && next.y === forbidden.y) continue;
      const key = `${next.x},${next.y}`;
      if (parents.has(key)) continue;
      parents.set(key, `${current.x},${current.y}`);
      queue.push(next);
    }
  }
  if (!parents.has(targetKey)) return null;
  const path = [];
  for (let key: string | null = targetKey; key !== null; key = parents.get(key) ?? null) {
    const [x, y] = key.split(",").map(Number);
    path.push({ x, y });
  }
  return path.reverse();
}

describe("bundled maze game movement and solvability", () => {
  it("starts on open tiles and can move in all four directions when unobstructed", () => {
    const openMap = { width: 3, height: 3, start: { x: 1, y: 1 }, exit: { x: 2, y: 2 }, collectibles: [], walls: [] };
    const state = mazeEngine.restartMosslight(openMap);
    expect(state.player).toEqual({ x: 1, y: 1 });
    expect(mazeEngine.moveMosslight(state, 0, -1, openMap).player).toEqual({ x: 1, y: 0 });
    expect(mazeEngine.moveMosslight(state, 0, 1, openMap).player).toEqual({ x: 1, y: 2 });
    expect(mazeEngine.moveMosslight(state, -1, 0, openMap).player).toEqual({ x: 0, y: 1 });
    expect(mazeEngine.moveMosslight(state, 1, 0, openMap).player).toEqual({ x: 2, y: 1 });
    const mossStart = mazeEngine.restartMosslight(mosslight);
    expect(mossStart.player).toEqual({ x: 0, y: 0 });
    expect(mazeEngine.moveMosslight(mossStart, 0, 1, mosslight).player).toEqual({ x: 0, y: 1 });
    const room = mazeEngine.restartOneMoreRoom(oneMoreRoom);
    expect(mazeEngine.moveOneMoreRoom(room, 1, 0, oneMoreRoom, () => 0).player).toEqual({ x: 1, y: 0 });
  });

  it("blocks walls, diagonal moves, and every grid boundary without changing state", () => {
    const state = mazeEngine.restartMosslight(mosslight);
    expect(mazeEngine.moveMosslight(state, -1, 0, mosslight)).toBe(state);
    expect(mazeEngine.moveMosslight(state, 0, -1, mosslight)).toBe(state);
    expect(mazeEngine.moveMosslight(state, 1, 1, mosslight)).toBe(state);
    const atWall = mazeEngine.moveMosslight(state, 1, 0, mosslight);
    expect(mazeEngine.moveMosslight(atWall, 0, 1, mosslight)).toBe(atWall);

    const room = { ...mazeEngine.restartOneMoreRoom(oneMoreRoom), player: { x: 7, y: 5 } };
    expect(mazeEngine.moveOneMoreRoom(room, 1, 0, oneMoreRoom, () => 0)).toBe(room);
    expect(mazeEngine.moveOneMoreRoom(room, 0, 1, oneMoreRoom, () => 0)).toBe(room);
  });

  it("finds valid paths through all fireflies and the exit in both fixed mazes", () => {
    const mossPath = mazeEngine.findWinningPath(mosslight);
    expect(mossPath).not.toBeNull();
    expect(mossPath?.[0]).toEqual(mosslight.start);
    expect(mossPath?.at(-1)).toEqual(mosslight.exit);
    for (let index = 1; index < (mossPath?.length ?? 0); index++) {
      expect(mazeEngine.canMove(mosslight, mossPath![index - 1], mossPath![index].x - mossPath![index - 1].x, mossPath![index].y - mossPath![index - 1].y)).toBe(true);
    }
    for (const light of mosslight.collectibles) expect(mossPath?.some((point: any) => point.x === light.x && point.y === light.y)).toBe(true);

    const roomPath = mazeEngine.findWinningPath({ ...oneMoreRoom, collectibles: [oneMoreRoom.key] });
    expect(roomPath?.[0]).toEqual(oneMoreRoom.start);
    expect(roomPath?.at(-1)).toEqual(oneMoreRoom.exit);
    expect(roomPath?.some((point: any) => point.x === oneMoreRoom.key.x && point.y === oneMoreRoom.key.y)).toBe(true);
  });

  it("supports a complete Mosslight win and a locked-gate notice", () => {
    let state = mazeEngine.restartMosslight(mosslight);
    const firstMove = mazeEngine.moveMosslight(state, 1, 0, mosslight);
    expect(firstMove.moves).toBe(1);

    const prematureExit = { ...state, player: { x: 5, y: 4 } };
    const locked = mazeEngine.moveMosslight(prematureExit, 1, 0, mosslight);
    expect(locked.outcome).toBe("playing");
    expect(locked.active).toBe(true);
    expect(locked.notice).toMatch(/fireflies/i);

    const path = mazeEngine.findWinningPath(mosslight)!;
    state = followPath(mosslight, path, state, mazeEngine.moveMosslight);
    expect(state.outcome).toBe("won");
    expect(state.active).toBe(false);
    expect(state.collected).toHaveLength(mosslight.collectibles.length);
  });

  it("handles One More Room win/loss, shadow collision, and a clean restart", () => {
    const noKey = { ...mazeEngine.restartOneMoreRoom(oneMoreRoom), player: { x: 7, y: 4 } };
    const loss = mazeEngine.moveOneMoreRoom(noKey, 0, 1, oneMoreRoom, () => 0);
    expect(loss.outcome).toBe("lost");
    expect(loss.active).toBe(false);

    const withKey = { ...noKey, hasKey: true };
    const win = mazeEngine.moveOneMoreRoom(withKey, 0, 1, oneMoreRoom, () => 0);
    expect(win.outcome).toBe("won");
    expect(win.active).toBe(false);

    const keyRoute = pathAvoiding(oneMoreRoom, oneMoreRoom.start, oneMoreRoom.key, oneMoreRoom.exit);
    const exitRoute = pathAvoiding(oneMoreRoom, oneMoreRoom.key, oneMoreRoom.exit);
    expect(keyRoute).not.toBeNull();
    expect(keyRoute?.some((point) => point.x === oneMoreRoom.exit.x && point.y === oneMoreRoom.exit.y)).toBe(false);
    expect(exitRoute).not.toBeNull();
    const route = [...keyRoute!, ...exitRoute!.slice(1)];
    let routeState = mazeEngine.restartOneMoreRoom(oneMoreRoom);
    for (let index = 1; index < route.length; index++) {
      routeState = mazeEngine.moveOneMoreRoom(
        routeState,
        route[index].x - route[index - 1].x,
        route[index].y - route[index - 1].y,
        oneMoreRoom,
        () => 0.99,
      );
    }
    expect(routeState.outcome).toBe("won");
    expect(routeState.hasKey).toBe(true);

    const caught = { ...mazeEngine.restartOneMoreRoom(oneMoreRoom), player: { x: 6, y: 0 }, hasKey: true };
    const reset = mazeEngine.moveOneMoreRoom(caught, 1, 0, oneMoreRoom, () => 0);
    expect(reset.player).toEqual(oneMoreRoom.start);
    expect(reset.ghost).toEqual(oneMoreRoom.ghostStart);
    expect(reset.hasKey).toBe(true);
    expect(reset.catches).toBe(1);

    const restarted = mazeEngine.restartOneMoreRoom(oneMoreRoom);
    expect(restarted.player).toEqual(oneMoreRoom.start);
    expect(restarted.ghost).toEqual(oneMoreRoom.ghostStart);
    expect(restarted.hasKey).toBe(false);
    expect(restarted.moves).toBe(0);
    expect(restarted.outcome).toBe("playing");
  });

  it("rejects malformed or unsolvable custom mazes", () => {
    expect(mazeEngine.findWinningPath({ ...mosslight, start: { x: -1, y: 0 } })).toBeNull();
    expect(mazeEngine.findWinningPath({ ...mosslight, walls: [...mosslight.walls, "1,0"] })).toBeNull();
  });
});

describe("Neon Drift simulation", () => {
  it("starts cleanly with a timed run, orbs, hazards, and mapped keyboard input", () => {
    const state = neonEngine.startGame(() => 0.37);
    expect(state.phase).toBe("playing");
    expect(state.time).toBe(45);
    expect(state.score).toBe(0);
    expect(state.orbs).toHaveLength(7);
    expect(state.hazards).toHaveLength(3);
    expect(neonEngine.vectorForKeys(new Set(["arrowright", "w"]))).toEqual({ x: Math.SQRT1_2, y: -Math.SQRT1_2 });
    expect(neonEngine.vectorForKeys(new Set(["a", "d"]))).toEqual({ x: 0, y: 0 });
  });

  it("moves consistently at 30, 60, and 120 frames per second and clamps at the track edges", () => {
    const run = (fps: number) => {
      let state = { ...neonEngine.makeReadyState(), phase: "playing", orbs: [], hazards: [] };
      for (let frame = 0; frame < fps; frame++) state = neonEngine.stepGame(state, { x: 1, y: 0 }, 1 / fps, () => 0.4);
      return state;
    };
    const thirty = run(30);
    const sixty = run(60);
    const oneTwenty = run(120);
    expect(Math.max(thirty.player.x, sixty.player.x, oneTwenty.player.x) - Math.min(thirty.player.x, sixty.player.x, oneTwenty.player.x)).toBeLessThan(6);
    let atEdge = { ...neonEngine.makeReadyState(), phase: "playing", orbs: [], hazards: [], player: { x: 787, y: 250, r: 10, vx: 0, vy: 0 } };
    atEdge = neonEngine.stepGame(atEdge, { x: 1, y: 0 }, 0.05, () => 0.3);
    expect(atEdge.player.x).toBeLessThanOrEqual(788);
  });

  it("collects orbs, detects swept collisions, applies a penalty, and ends on timeout", () => {
    let state = {
      ...neonEngine.makeReadyState(), phase: "playing", score: 0, time: 20,
      player: { x: 100, y: 100, r: 10, vx: 0, vy: 0 },
      orbs: [{ x: 108, y: 100, r: 7, phase: 0 }],
      hazards: [{ x: 125, y: 100, r: 24, phase: 0, speed: 0 }],
    };
    state = neonEngine.stepGame(state, { x: 1, y: 0 }, 0.05, () => 0.4);
    expect(state.score).toBe(10);
    expect(state.events.some((event: any) => event.type === "orb")).toBe(true);
    expect(state.events.some((event: any) => event.type === "collision")).toBe(true);
    expect(state.time).toBeLessThan(17.1);
    expect(state.player.x).toBe(neonEngine.width / 2);

    const timedOut = neonEngine.stepGame({ ...state, phase: "playing", time: 0.02, hazards: [] }, { x: 0, y: 0 }, 0.05);
    expect(timedOut.phase).toBe("over");
    expect(timedOut.outcome).toBe("time");
    expect(timedOut.time).toBe(0);
  });

  it("pauses without advancing time, resumes, and restart clears all run state", () => {
    let state = neonEngine.startGame(() => 0.6);
    state = neonEngine.stepGame(state, { x: 1, y: 0 }, 0.02, () => 0.6);
    const paused = neonEngine.pauseGame(state);
    expect(paused.phase).toBe("paused");
    expect(neonEngine.stepGame(paused, { x: 1, y: 0 }, 0.5)).toBe(paused);
    expect(neonEngine.resumeGame(paused).phase).toBe("playing");
    const restarted = neonEngine.startGame(() => 0.6);
    expect(restarted.phase).toBe("playing");
    expect(restarted.score).toBe(0);
    expect(restarted.time).toBe(45);
    expect(restarted.player).toMatchObject({ x: 400, y: 250, vx: 0, vy: 0 });
  });
});

describe("Web Arcade randomized maze validation", () => {
  it("blocks wall/boundary penetration, permits axis sliding, and checks win/catch distances", () => {
    const wall = { minX: 4, maxX: 5, minZ: 0, maxZ: 4 };
    expect(arcadeMazeEngine.isInsideWall(4.5, 2, [wall])).toBe(true);
    expect(arcadeMazeEngine.isInsideWall(3, 2, [wall])).toBe(false);
    expect(arcadeMazeEngine.resolveCollisionMove({ x: 3, z: 2 }, 1.5, 0, [wall])).toEqual({ x: 3, z: 2 });
    expect(arcadeMazeEngine.resolveCollisionMove({ x: 3, z: 2 }, 1.5, 3, [wall])).toEqual({ x: 3, z: 5 });
    const edgeWall = { minX: 0, maxX: 0.4, minZ: -10, maxZ: 10 };
    expect(arcadeMazeEngine.resolveCollisionMove({ x: 0.6, z: 2 }, -0.3, 0, [edgeWall])).toEqual({ x: 0.6, z: 2 });
    expect(arcadeMazeEngine.resolveCollisionMove({ x: Number.NaN, z: 2 }, 1, 0, [wall])).toBeNull();
    expect(arcadeMazeEngine.isWithinDistance({ x: 0, z: 0 }, { x: 0.9, z: 0 }, 1)).toBe(true);
    expect(arcadeMazeEngine.isWithinDistance({ x: 0, z: 0 }, { x: 1, z: 0 }, 1)).toBe(false);
    expect(arcadeMazeEngine.isWithinDistance({ x: 0, z: 0 }, { x: 0, z: 0 }, -1)).toBe(false);
  });

  function seededRandom(seed: number) {
    let value = seed >>> 0;
    return () => {
      value = (1664525 * value + 1013904223) >>> 0;
      return value / 0x100000000;
    };
  }

  it("generates reachable 16×16 mazes across 128 deterministic seeds with valid reciprocal walls", () => {
    for (let seed = 0; seed < 128; seed++) {
      const maze = arcadeMazeEngine.generateSolvableMaze(16, 16, seededRandom(seed), 1);
      expect(arcadeMazeEngine.validateGrid(maze)).toBe(true);
      expect(arcadeMazeEngine.isFullyReachable(maze)).toBe(true);
      const path = arcadeMazeEngine.bfsPath(maze, { x: 0, y: 0 }, { x: 15, y: 15 });
      expect(path?.at(-1)).toEqual({ x: 15, y: 15 });
      let previous = { x: 0, y: 0 };
      for (const next of path ?? []) {
        expect(arcadeMazeEngine.cellNeighbors(maze, previous)).toContainEqual(next);
        previous = next;
      }
    }
  });

  it("rejects unsolvable candidates, retries a bounded number of times, and preserves edge checks", () => {
    const blocked = Array.from({ length: 2 }, (_, y) => Array.from({ length: 2 }, (_, x) => ({
      x, y, visited: true, N: true, S: true, E: true, W: true,
    })));
    expect(arcadeMazeEngine.validateGrid(blocked)).toBe(true);
    expect(arcadeMazeEngine.isFullyReachable(blocked)).toBe(false);
    let attempts = 0;
    expect(() => arcadeMazeEngine.generateSolvableMaze(2, 2, () => 0, 4, () => { attempts++; return blocked; })).toThrow(/after 4 attempts/);
    expect(attempts).toBe(4);
    expect(arcadeMazeEngine.bfsPath(blocked, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
    expect(arcadeMazeEngine.generateSolvableMaze(1, 1, () => Number.NaN, 1)).toHaveLength(1);
    expect(() => arcadeMazeEngine.generateSolvableMaze(0, 2)).toThrow(/invalid/i);
  });
});

describe("HTML5 Tower Defense simulation", () => {
  it("builds only on empty in-bounds cells, spends currency, and starts a single wave", () => {
    const state = towerDefenseEngine.createState();
    expect(towerDefenseEngine.buildTower(state, 0, 1)).toBe(false);
    expect(towerDefenseEngine.buildTower(state, -1, 4)).toBe(false);
    expect(towerDefenseEngine.buildTower(state, 4, 3)).toBe(true);
    expect(state.money).toBe(70);
    expect(state.towers).toHaveLength(1);
    expect(towerDefenseEngine.buildTower(state, 4, 3)).toBe(false);
    state.money = 0;
    expect(towerDefenseEngine.buildTower(state, 4, 4)).toBe(false);
    expect(state.message).toMatch(/not enough money/i);

    state.money = 70;
    expect(towerDefenseEngine.startWave(state)).toBe(true);
    expect(state.wave).toBe(1);
    expect(state.spawnQ).toBe(8);
    expect(towerDefenseEngine.startWave(state)).toBe(false);
  });

  it("spawns enemies on elapsed time, pauses cleanly, and resumes without a time jump", () => {
    const state = towerDefenseEngine.createState();
    towerDefenseEngine.startWave(state);
    for (let frame = 0; frame < 12; frame++) towerDefenseEngine.stepGame(state, 0.05);
    expect(state.enemies).toHaveLength(1);
    expect(state.spawnQ).toBe(7);
    expect(towerDefenseEngine.togglePause(state)).toBe(true);
    const position = { segment: state.enemies[0].segment, spawnTimer: state.spawnTimer, count: state.enemies.length };
    towerDefenseEngine.stepGame(state, 0.5);
    expect(state.enemies).toHaveLength(position.count);
    expect(state.enemies[0].segment).toBe(position.segment);
    expect(state.spawnTimer).toBe(position.spawnTimer);
    expect(towerDefenseEngine.togglePause(state)).toBe(true);
    towerDefenseEngine.stepGame(state, 0.05);
    expect(state.enemies[0].segment).toBeGreaterThan(position.segment);
  });

  it("keeps enemy speed stable at common frame rates, resolves projectile hits, and awards kills", () => {
    const run = (fps: number) => {
      const state = towerDefenseEngine.createState();
      state.wave = 1;
      state.running = true;
      state.enemies.push({ segment: 0, x: 20, y: 60, hp: 100, maxHp: 100, speed: 1.1, radius: 11, dead: false });
      for (let frame = 0; frame < fps; frame++) towerDefenseEngine.stepGame(state, 1 / fps);
      return state.enemies[0].segment;
    };
    expect(Math.max(run(30), run(60), run(120)) - Math.min(run(30), run(60), run(120))).toBeLessThan(1e-8);

    const battle = towerDefenseEngine.createState();
    battle.wave = 1;
    battle.running = true;
    towerDefenseEngine.buildTower(battle, 4, 3);
    battle.spawnQ = 0;
    battle.enemies.push({ segment: 7, x: 220, y: 140, hp: 5, maxHp: 5, speed: 0, radius: 11, dead: false });
    for (let frame = 0; frame < 5; frame++) towerDefenseEngine.stepGame(battle, 0.05);
    expect(battle.enemies).toHaveLength(0);
    expect(battle.money).toBe(78);
    expect(battle.message).toMatch(/wave 1 cleared/i);
  });

  it("ends when the base loses its final life and resets to a clean game", () => {
    const state = towerDefenseEngine.createState();
    state.wave = 2;
    state.running = true;
    state.spawnQ = 0;
    state.lives = 1;
    state.enemies.push({
      segment: state.pathPoints.length - 1 - 0.01,
      x: 0, y: 0, hp: 10, maxHp: 10, speed: 3, radius: 11, dead: false,
    });
    towerDefenseEngine.stepGame(state, 0.05);
    expect(state.lives).toBe(0);
    expect(state.over).toBe(true);
    expect(state.running).toBe(false);
    const restarted = towerDefenseEngine.createState();
    expect(restarted.money).toBe(100);
    expect(restarted.lives).toBe(20);
    expect(restarted.wave).toBe(0);
    expect(restarted.towers).toHaveLength(0);
    expect(restarted.over).toBe(false);
  });
});
