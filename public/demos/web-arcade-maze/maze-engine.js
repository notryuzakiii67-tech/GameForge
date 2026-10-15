(function attachArcadeMazeEngine(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GameForgeArcadeMazeEngine = api;
})(typeof globalThis === "undefined" ? this : globalThis, function createArcadeMazeEngine() {
  "use strict";

  const DIRECTIONS = [
    { wall: "N", opposite: "S", dx: 0, dy: -1 },
    { wall: "S", opposite: "N", dx: 0, dy: 1 },
    { wall: "E", opposite: "W", dx: 1, dy: 0 },
    { wall: "W", opposite: "E", dx: -1, dy: 0 },
  ];

  function validDimensions(width, height) {
    return Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= 256 && height <= 256;
  }

  function validateGrid(grid) {
    if (!Array.isArray(grid) || grid.length < 1 || !Array.isArray(grid[0]) || grid[0].length < 1) return false;
    const height = grid.length;
    const width = grid[0].length;
    if (!validDimensions(width, height) || grid.some((row) => !Array.isArray(row) || row.length !== width)) return false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const cell = grid[y][x];
        if (!cell || cell.x !== x || cell.y !== y || DIRECTIONS.some(({ wall }) => typeof cell[wall] !== "boolean")) return false;
        if ((y === 0 && !cell.N) || (y === height - 1 && !cell.S) || (x === 0 && !cell.W) || (x === width - 1 && !cell.E)) return false;
        if (x < width - 1 && cell.E !== grid[y][x + 1].W) return false;
        if (y < height - 1 && cell.S !== grid[y + 1][x].N) return false;
      }
    }
    return true;
  }

  function rawCellNeighbors(grid, cell) {
    const height = grid.length;
    const width = grid[0].length;
    if (!cell || !Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.x >= width || cell.y < 0 || cell.y >= height) return [];
    const current = grid[cell.y][cell.x];
    const neighbors = [];
    for (const direction of DIRECTIONS) {
      const nx = cell.x + direction.dx;
      const ny = cell.y + direction.dy;
      if (!current[direction.wall] && nx >= 0 && nx < width && ny >= 0 && ny < height) neighbors.push({ x: nx, y: ny });
    }
    return neighbors;
  }

  function cellNeighbors(grid, cell) {
    return validateGrid(grid) ? rawCellNeighbors(grid, cell) : [];
  }

  function bfsPath(grid, from, to) {
    if (!validateGrid(grid) || !from || !to) return null;
    const height = grid.length;
    const width = grid[0].length;
    const inside = (point) => Number.isInteger(point.x) && Number.isInteger(point.y) && point.x >= 0 && point.x < width && point.y >= 0 && point.y < height;
    if (!inside(from) || !inside(to)) return null;
    if (from.x === to.x && from.y === to.y) return [];

    const indexOf = (point) => point.y * width + point.x;
    const parents = new Int32Array(width * height).fill(-1);
    const visited = new Uint8Array(width * height);
    const queue = [{ x: from.x, y: from.y }];
    let head = 0;
    visited[indexOf(from)] = 1;

    while (head < queue.length) {
      const current = queue[head++];
      if (current.x === to.x && current.y === to.y) {
        const path = [];
        let cursor = current;
        while (cursor.x !== from.x || cursor.y !== from.y) {
          path.push(cursor);
          const parentIndex = parents[indexOf(cursor)];
          cursor = { x: parentIndex % width, y: Math.floor(parentIndex / width) };
        }
        path.reverse();
        return path;
      }
      for (const neighbor of rawCellNeighbors(grid, current)) {
        const index = indexOf(neighbor);
        if (!visited[index]) {
          visited[index] = 1;
          parents[index] = indexOf(current);
          queue.push(neighbor);
        }
      }
    }
    return null;
  }

  function isFullyReachable(grid, start = { x: 0, y: 0 }) {
    if (!validateGrid(grid)) return false;
    const width = grid[0].length;
    const height = grid.length;
    const path = bfsPath(grid, start, { x: width - 1, y: height - 1 });
    if (path === null) return false;
    const seen = new Uint8Array(width * height);
    const queue = [{ x: start.x, y: start.y }];
    seen[start.y * width + start.x] = 1;
    let count = 0;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      count++;
      for (const neighbor of rawCellNeighbors(grid, current)) {
        const index = neighbor.y * width + neighbor.x;
        if (!seen[index]) {
          seen[index] = 1;
          queue.push(neighbor);
        }
      }
    }
    return count === width * height;
  }

  function randomIndex(random, length) {
    const value = Number(random());
    const normalized = Number.isFinite(value) ? Math.max(0, Math.min(0.999999999999, value)) : 0;
    return Math.floor(normalized * length);
  }

  function isInsideWall(x, z, walls) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Array.isArray(walls)) return true;
    return walls.some((wall) => !wall || ![wall.minX, wall.maxX, wall.minZ, wall.maxZ].every(Number.isFinite)
      || (x > wall.minX && x < wall.maxX && z > wall.minZ && z < wall.maxZ));
  }

  function resolveCollisionMove(position, dx, dz, walls) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)
      || !Number.isFinite(dx) || !Number.isFinite(dz) || !Array.isArray(walls)) return null;
    let x = position.x;
    let z = position.z;
    if (!isInsideWall(x + dx, z, walls)) x += dx;
    if (!isInsideWall(x, z + dz, walls)) z += dz;
    return { x, z };
  }

  function isWithinDistance(from, to, radius) {
    if (!from || !to || ![from.x, from.z, to.x, to.z, radius].every(Number.isFinite) || radius < 0) return false;
    const dx = from.x - to.x;
    const dz = from.z - to.z;
    return dx * dx + dz * dz < radius * radius;
  }

  function generateMaze(width, height, random = Math.random) {
    if (!validDimensions(width, height) || typeof random !== "function") throw new TypeError("Maze dimensions or random source are invalid.");
    const grid = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => ({
      x, y, visited: false, N: true, S: true, E: true, W: true,
    })));
    const stack = [grid[0][0]];
    grid[0][0].visited = true;
    while (stack.length) {
      const cell = stack[stack.length - 1];
      const neighbors = [];
      for (const direction of DIRECTIONS) {
        const nx = cell.x + direction.dx;
        const ny = cell.y + direction.dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && !grid[ny][nx].visited) {
          neighbors.push({ direction, cell: grid[ny][nx] });
        }
      }
      if (!neighbors.length) {
        stack.pop();
        continue;
      }
      const choice = neighbors[randomIndex(random, neighbors.length)];
      cell[choice.direction.wall] = false;
      choice.cell[choice.direction.opposite] = false;
      choice.cell.visited = true;
      stack.push(choice.cell);
    }
    return grid;
  }

  function generateSolvableMaze(width, height, random = Math.random, maxAttempts = 5, candidateGenerator = generateMaze) {
    if (!validDimensions(width, height) || typeof random !== "function" || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 50 || typeof candidateGenerator !== "function") {
      throw new TypeError("Maze generation options are invalid.");
    }
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let candidate;
      try {
        candidate = candidateGenerator(width, height, random);
      } catch {
        continue;
      }
      if (validateGrid(candidate) && isFullyReachable(candidate)) return candidate;
    }
    throw new Error(`Maze generation failed solvability validation after ${maxAttempts} attempts.`);
  }

  return Object.freeze({
    generateMaze,
    generateSolvableMaze,
    validateGrid,
    cellNeighbors,
    bfsPath,
    isFullyReachable,
    isInsideWall,
    resolveCollisionMove,
    isWithinDistance,
  });
});
