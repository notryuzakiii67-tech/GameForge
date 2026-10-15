(function attachMazeEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GameForgeMazeEngine = api;
})(typeof globalThis === "undefined" ? this : globalThis, function createMazeEngine() {
  "use strict";

  const MOSS_LIGHT = Object.freeze({
    id: "mosslight",
    width: 7,
    height: 5,
    start: Object.freeze({ x: 0, y: 0 }),
    exit: Object.freeze({ x: 6, y: 4 }),
    collectibles: Object.freeze([
      Object.freeze({ x: 4, y: 0 }),
      Object.freeze({ x: 6, y: 2 }),
      Object.freeze({ x: 4, y: 4 }),
    ]),
    // The former wall at 1,0 sealed the starting room completely.
    walls: Object.freeze(["1,1", "3,1", "5,1", "2,2", "5,2", "1,3", "3,3", "5,3", "2,4"]),
  });

  const ONE_MORE_ROOM = Object.freeze({
    id: "one-more-room",
    width: 8,
    height: 6,
    start: Object.freeze({ x: 0, y: 0 }),
    ghostStart: Object.freeze({ x: 7, y: 0 }),
    key: Object.freeze({ x: 5, y: 0 }),
    exit: Object.freeze({ x: 7, y: 5 }),
    // The old walls at 1,4 and 3,5 formed a full partition between both halves.
    // Keep the key reachable without crossing the exit tile first.
    walls: Object.freeze(["2,0", "4,0", "2,1", "4,1", "6,1", "0,2", "2,2", "6,2", "2,3", "4,3", "6,3", "4,4", "6,4", "1,5"]),
  });

  const DIRECTIONS = Object.freeze([
    Object.freeze({ x: 1, y: 0 }),
    Object.freeze({ x: -1, y: 0 }),
    Object.freeze({ x: 0, y: 1 }),
    Object.freeze({ x: 0, y: -1 }),
  ]);

  function cellKey(point) {
    return `${point.x},${point.y}`;
  }

  function inBounds(map, point) {
    return Number.isInteger(point.x) && Number.isInteger(point.y) &&
      point.x >= 0 && point.y >= 0 && point.x < map.width && point.y < map.height;
  }

  function isWall(map, point) {
    return map.walls.includes(cellKey(point));
  }

  function isWalkable(map, point) {
    return inBounds(map, point) && !isWall(map, point);
  }

  function canMove(map, from, dx, dy) {
    if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
    return isWalkable(map, { x: from.x + dx, y: from.y + dy });
  }

  function initialCollectibleMask(map, point) {
    return map.collectibles.reduce((mask, item, index) =>
      item.x === point.x && item.y === point.y ? mask | (1 << index) : mask, 0);
  }

  function findWinningPath(map) {
    if (!isWalkable(map, map.start) || !isWalkable(map, map.exit) || map.collectibles.length > 20) return null;
    if (map.collectibles.some((item) => !isWalkable(map, item))) return null;

    const fullMask = (1 << map.collectibles.length) - 1;
    const startMask = initialCollectibleMask(map, map.start);
    const stateId = (point, mask) => `${cellKey(point)}|${mask}`;
    const start = { point: { x: map.start.x, y: map.start.y }, mask: startMask };
    const startId = stateId(start.point, start.mask);
    const parent = new Map([[startId, null]]);
    const queue = [start];
    let head = 0;
    let finishId = null;

    while (head < queue.length) {
      const current = queue[head++];
      const currentId = stateId(current.point, current.mask);
      if (current.point.x === map.exit.x && current.point.y === map.exit.y && current.mask === fullMask) {
        finishId = currentId;
        break;
      }
      for (const direction of DIRECTIONS) {
        if (!canMove(map, current.point, direction.x, direction.y)) continue;
        const nextPoint = { x: current.point.x + direction.x, y: current.point.y + direction.y };
        const nextMask = current.mask | initialCollectibleMask(map, nextPoint);
        const nextId = stateId(nextPoint, nextMask);
        if (parent.has(nextId)) continue;
        parent.set(nextId, currentId);
        queue.push({ point: nextPoint, mask: nextMask });
      }
    }

    if (!finishId) return null;
    const path = [];
    for (let id = finishId; id !== null; id = parent.get(id)) {
      const key = id.slice(0, id.lastIndexOf("|"));
      const [x, y] = key.split(",").map(Number);
      path.push({ x, y });
    }
    return path.reverse();
  }

  function createMosslightState(map = MOSS_LIGHT) {
    return {
      player: { x: map.start.x, y: map.start.y },
      collected: [],
      moves: 0,
      active: false,
      outcome: "ready",
      notice: "",
    };
  }

  function restartMosslight(map = MOSS_LIGHT) {
    return { ...createMosslightState(map), active: true, outcome: "playing" };
  }

  function moveMosslight(state, dx, dy, map = MOSS_LIGHT) {
    if (!state.active || !canMove(map, state.player, dx, dy)) return state;
    const player = { x: state.player.x + dx, y: state.player.y + dy };
    const collected = state.collected.includes(cellKey(player)) ? state.collected :
      map.collectibles.some((item) => item.x === player.x && item.y === player.y)
        ? [...state.collected, cellKey(player)] : state.collected;
    const gotEverything = collected.length === map.collectibles.length;
    const atExit = player.x === map.exit.x && player.y === map.exit.y;
    const won = atExit && gotEverything;
    return {
      ...state,
      player,
      collected,
      moves: state.moves + 1,
      active: !won,
      outcome: won ? "won" : "playing",
      notice: atExit && !gotEverything ? "The moon gate needs all three fireflies." : "",
    };
  }

  function createOneMoreRoomState(map = ONE_MORE_ROOM) {
    return {
      player: { x: map.start.x, y: map.start.y },
      ghost: { x: map.ghostStart.x, y: map.ghostStart.y },
      hasKey: false,
      moves: 0,
      catches: 0,
      active: false,
      outcome: "ready",
      notice: "",
    };
  }

  function restartOneMoreRoom(map = ONE_MORE_ROOM) {
    return { ...createOneMoreRoomState(map), active: true, outcome: "playing" };
  }

  function moveGhost(ghost, hero, map, random = Math.random) {
    const options = DIRECTIONS
      .filter((direction) => canMove(map, ghost, direction.x, direction.y))
      .sort((a, b) =>
        Math.abs(ghost.x + a.x - hero.x) + Math.abs(ghost.y + a.y - hero.y) -
        (Math.abs(ghost.x + b.x - hero.x) + Math.abs(ghost.y + b.y - hero.y)));
    if (!options.length) return { x: ghost.x, y: ghost.y };
    const direction = random() < 0.68 ? options[0] : options[Math.floor(random() * options.length)];
    return { x: ghost.x + direction.x, y: ghost.y + direction.y };
  }

  function sameCell(a, b) {
    return a.x === b.x && a.y === b.y;
  }

  function moveOneMoreRoom(state, dx, dy, map = ONE_MORE_ROOM, random = Math.random) {
    if (!state.active || !canMove(map, state.player, dx, dy)) return state;
    const player = { x: state.player.x + dx, y: state.player.y + dy };
    const hasKey = state.hasKey || sameCell(player, map.key);
    const moves = state.moves + 1;
    if (sameCell(player, map.exit)) {
      return { ...state, player, hasKey, moves, active: false, outcome: hasKey ? "won" : "lost", notice: "" };
    }

    // A caught player is sent back, but keeps the key: the shadow can cost time,
    // never invalidate the only winning route.
    if (sameCell(player, state.ghost)) {
      return {
        ...state,
        player: { x: map.start.x, y: map.start.y },
        ghost: { x: map.ghostStart.x, y: map.ghostStart.y },
        hasKey,
        moves,
        catches: state.catches + 1,
        notice: "The shadow sent you back. Your key is safe.",
      };
    }

    const ghost = moveGhost(state.ghost, player, map, random);
    if (sameCell(ghost, player)) {
      return {
        ...state,
        player: { x: map.start.x, y: map.start.y },
        ghost: { x: map.ghostStart.x, y: map.ghostStart.y },
        hasKey,
        moves,
        catches: state.catches + 1,
        notice: "The shadow sent you back. Your key is safe.",
      };
    }
    return { ...state, player, ghost, hasKey, moves, notice: "" };
  }

  return Object.freeze({
    maps: Object.freeze({ mosslight: MOSS_LIGHT, oneMoreRoom: ONE_MORE_ROOM }),
    directions: DIRECTIONS,
    cellKey,
    inBounds,
    isWall,
    isWalkable,
    canMove,
    findWinningPath,
    createMosslightState,
    restartMosslight,
    moveMosslight,
    createOneMoreRoomState,
    restartOneMoreRoom,
    moveOneMoreRoom,
  });
});
