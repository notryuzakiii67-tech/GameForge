import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function create2048Harness() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(`
    function TestInputManager() { this.handlers = {}; }
    TestInputManager.prototype.on = function (name, callback) { this.handlers[name] = callback; };
    function TestActuator() { this.lastMetadata = null; this.continued = 0; }
    TestActuator.prototype.actuate = function (_grid, metadata) { this.lastMetadata = metadata; };
    TestActuator.prototype.continueGame = function () { this.continued += 1; };
  `, context);
  for (const filename of ["grid.js", "tile.js", "session_score_manager.js", "game_manager.js"]) {
    const source = readFileSync(path.join(root, "public/demos/2048/js", filename), "utf8");
    vm.runInContext(source, context, { filename });
  }
  vm.runInContext("Math.random = function () { return 0.99; };", context);
  return context;
}

describe("2048 candidate integration", () => {
  it("starts with two tiles, merges once per tile, updates score, and adds a new tile", () => {
    const context = create2048Harness();
    const game = new context.GameManager(4, context.TestInputManager, context.TestActuator, context.SessionScoreManager);
    const startTiles = game.grid.availableCells().length;
    expect(startTiles).toBe(14);

    game.grid = new context.Grid(4);
    for (let x = 0; x < 4; x++) game.grid.insertTile(new context.Tile({ x, y: 0 }, 2));
    game.score = 0;
    game.over = false;
    game.won = false;
    game.keepPlaying = false;
    game.move(3);

    expect(game.grid.cells[0][0].value).toBe(4);
    expect(game.grid.cells[1][0].value).toBe(4);
    expect(game.score).toBe(8);
    expect(game.grid.availableCells().length).toBe(13);
    expect(game.actuator.lastMetadata.score).toBe(8);
  });

  it("does not spawn tiles on a no-op move and keeps persistence explicitly session-only", () => {
    const context = create2048Harness();
    const game = new context.GameManager(4, context.TestInputManager, context.TestActuator, context.SessionScoreManager);
    game.grid = new context.Grid(4);
    game.grid.insertTile(new context.Tile({ x: 0, y: 0 }, 2));
    game.score = 0;
    game.move(3);
    expect(game.grid.availableCells().length).toBe(15);
    expect(game.score).toBe(0);

    const session = new context.SessionScoreManager();
    session.setBestScore(64);
    session.setBestScore(32);
    session.setGameState({ grid: "deliberately not persisted" });
    expect(session.getBestScore()).toBe(64);
    expect(session.getGameState()).toBeNull();
    expect(context.window.fakeStorage).toBeUndefined();
  });

  it("handles reaching 2048, continue, and a full clean restart", () => {
    const context = create2048Harness();
    const game = new context.GameManager(4, context.TestInputManager, context.TestActuator, context.SessionScoreManager);
    game.grid = new context.Grid(4);
    game.grid.insertTile(new context.Tile({ x: 0, y: 0 }, 1024));
    game.grid.insertTile(new context.Tile({ x: 1, y: 0 }, 1024));
    game.score = 0;
    game.won = false;
    game.over = false;
    game.keepPlaying = false;
    game.move(3);
    expect(game.won).toBe(true);
    expect(game.actuator.lastMetadata.terminated).toBe(true);
    game.inputManager.handlers.keepPlaying();
    expect(game.keepPlaying).toBe(true);
    expect(game.isGameTerminated()).toBe(false);

    game.score = 300;
    game.inputManager.handlers.restart();
    expect(game.score).toBe(0);
    expect(game.won).toBe(false);
    expect(game.over).toBe(false);
    expect(game.grid.availableCells().length).toBe(14);
    expect(game.storageManager.getGameState()).toBeNull();
  });
});
