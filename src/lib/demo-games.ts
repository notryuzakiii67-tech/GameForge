export type VerificationStatus = "tested" | "not-fully-tested" | "blocked";
export type PlayerAspect = "wide" | "square" | "portrait";

export type GameCardData = {
  id: string;
  slug: string;
  title: string;
  developer: string;
  developerUsername?: string;
  genre: string;
  description: string;
  cover: string;
  accent: string;
  status: string;
  isDemo: boolean;
  averageRating: number | null;
  ratingCount: number;
  fileVersion?: number;
  entryPoint?: string;
  tags?: string[];
  controls?: string;
  instructions?: string;
  license?: string;
  sourceUrl?: string;
  sourceAttribution?: string;
  verificationStatus?: VerificationStatus;
  verificationNote?: string;
  sandboxCapabilities?: string[];
  playerAspect?: PlayerAspect;
};

export const demoGames: GameCardData[] = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "neon-drift",
    title: "Neon Drift",
    developer: "GameForge Starter Studio",
    genre: "Arcade",
    description: "Thread through the neon field, scoop up energy orbs, and see how long you can stay in the flow.",
    cover: "/art/neon-drift.svg",
    accent: "#8b7cff",
    status: "published",
    isDemo: true,
    averageRating: null,
    ratingCount: 0,
    fileVersion: 1,
    entryPoint: "index.html",
    controls: "WASD / arrow keys or touch buttons; P pauses; Start / Resume restarts or resumes",
    instructions: "Collect glowing energy orbs, dodge pulse rings, and survive the 45-second run. The local run state resets when the iframe is reloaded.",
    license: "GameForge demonstration content",
    verificationStatus: "tested",
    verificationNote: "2026-10-15 headless Chromium through the GameForge player: a full 45-second run reached the timeout result; mobile touch emulation moved the player and Pause/Resume responded. Touch testing exposed a negative canvas particle radius; filtering expired particles and clamping the radius fixed the browser exception, and the touch flow was rerun without errors. Physical-device testing remains unverified.",
    playerAspect: "square",
    tags: ["arcade", "keyboard", "touch", "quick play"],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "mosslight",
    title: "Mosslight",
    developer: "GameForge Starter Studio",
    genre: "Puzzle",
    description: "A pocket-sized forest puzzle about guiding fireflies through a quiet clearing.",
    cover: "/art/mosslight.svg",
    accent: "#80d7a8",
    status: "published",
    isDemo: true,
    averageRating: null,
    ratingCount: 0,
    fileVersion: 1,
    entryPoint: "index.html",
    controls: "Arrow keys or tap an adjacent tile",
    instructions: "Collect every firefly before reaching the gate. The maze is fixed and has an automated BFS-verified winning path.",
    license: "GameForge demonstration content",
    verificationStatus: "tested",
    verificationNote: "2026-10-15 headless Chromium through the GameForge player: completed the 14-move BFS-verified path-to-win using touch emulation at a mobile viewport; the compact player layout kept the board and touch controls visible, with no game-resource or JavaScript errors. Physical-device testing remains unverified.",
    playerAspect: "square",
    tags: ["puzzle", "cozy", "touch"],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    slug: "one-more-room",
    title: "One More Room",
    developer: "GameForge Starter Studio",
    genre: "Adventure",
    description: "Find the tiny brass key, dodge the restless tiles, and slip into the next room.",
    cover: "/art/one-more-room.svg",
    accent: "#f1aa73",
    status: "published",
    isDemo: true,
    averageRating: null,
    ratingCount: 0,
    fileVersion: 1,
    entryPoint: "index.html",
    controls: "WASD / arrow keys or on-screen direction buttons",
    instructions: "Find the key, avoid the shadow, and reach the door. Catching the shadow resets both actors; the key remains collected until restart.",
    license: "GameForge demonstration content",
    verificationStatus: "tested",
    verificationNote: "2026-10-15 headless Chromium through the GameForge player: touch emulation completed a 20-move route that collected the brass key without crossing the exit first and unlocked the door. The test fixed ghost randomness for reproducibility; the production AI remains random. No browser errors. Physical-device testing remains unverified.",
    playerAspect: "square",
    tags: ["adventure", "puzzle", "keyboard"],
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    slug: "2048",
    title: "2048",
    developer: "Gabriele Cirulli · GameForge adaptation",
    genre: "Puzzle",
    description: "Slide and merge matching numbers, build a 2048 tile, and keep playing if you want to chase a higher score.",
    cover: "/art/2048.svg",
    accent: "#edc22e",
    status: "published",
    isDemo: true,
    averageRating: null,
    ratingCount: 0,
    fileVersion: 1,
    entryPoint: "index.html",
    controls: "Arrow keys / WASD, swipe to move, R to restart",
    instructions: "Join equal tiles to reach 2048. You can continue after winning. The current board and best score exist only in this isolated frame's memory and reset when the game reloads.",
    license: "MIT · Clear Sans font Apache-2.0 (notices bundled)",
    sourceUrl: "https://github.com/gabrielecirulli/2048/tree/478b6ec346e3787f589e4af751378d06ded4cbbc",
    sourceAttribution: "2048 by Gabriele Cirulli; adapted for GameForge. Clear Sans by Intel/Monotype.",
    verificationStatus: "tested",
    verificationNote: "2026-10-15 headless Chromium through the GameForge player: deterministic arrow-key play visibly merged tiles, reached the terminal loss screen, and New Game reset the score and two-tile board. Mobile touch emulation also sent swipes that updated the board. Physical-device testing remains unverified.",
    playerAspect: "portrait",
    tags: ["puzzle", "numbers", "keyboard", "touch"],
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    slug: "web-arcade-maze",
    title: "The Maze",
    developer: "duysqubix · Web Arcade adaptation",
    genre: "Horror",
    description: "A procedurally generated first-person maze. Something listens for your footsteps and hunts through the corridors.",
    cover: "/art/web-arcade-maze.svg",
    accent: "#b85040",
    status: "published",
    isDemo: true,
    averageRating: null,
    ratingCount: 0,
    fileVersion: 1,
    entryPoint: "index.html",
    controls: "WASD to move, drag or mouse to look, Shift to sprint, N for a new maze, Esc to pause",
    instructions: "Reach the green beacon at the far corner without being caught. Pointer lock is used when available, with drag-to-look as a fallback. The game requires a keyboard and mouse. New mazes are rejected and retried unless full reachability validation succeeds.",
    license: "MIT · Three.js MIT (notices bundled)",
    sourceUrl: "https://github.com/duysqubix/web-arcade/tree/a8b8f278b9a11d0778b21ff0e5cfea27531bd4d8/games/maze",
    sourceAttribution: "The Maze from Web Arcade by duysqubix; modified by GameForge. Three.js r160.",
    verificationStatus: "tested",
    verificationNote: "2026-10-15 headless Chromium through the GameForge player: WebGL initialized, pointer lock succeeded, and WASD movement in a deterministic validated 16×16 maze ended in the monster-death screen; Retry returned to a fresh validated run without browser errors. The winning route was not completed. 128 seeded mazes also passed reciprocal-wall/BFS checks. Physical-device testing remains unverified; this game requires keyboard and mouse.",
    sandboxCapabilities: ["allow-pointer-lock"],
    playerAspect: "square",
    tags: ["horror", "maze", "3D", "keyboard", "mouse"],
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    slug: "tower-defense",
    title: "Tower Defense",
    developer: "gamelabz · GameForge adaptation",
    genre: "Strategy",
    description: "Place towers along a winding path, earn money for every creep destroyed, and survive escalating waves.",
    cover: "/art/tower-defense.svg",
    accent: "#4cc9f0",
    status: "published",
    isDemo: true,
    averageRating: null,
    ratingCount: 0,
    fileVersion: 1,
    entryPoint: "index.html",
    controls: "Click an empty tile to build; use Start Wave, Pause / Resume, P, and Restart",
    instructions: "Build towers for 30 coins, then start a wave. Towers target and fire at enemies in range. You earn coins for kills; lose when the base reaches zero lives. P pauses and resumes an active wave.",
    license: "MIT (upstream notice bundled)",
    sourceUrl: "https://github.com/gamelabz/html5-game-tower-defense/tree/8caa9483da02a1c729ae1bf54f38e7fa158c5783",
    sourceAttribution: "HTML5 Tower Defense by gamelabz; modified by GameForge.",
    verificationStatus: "tested",
    verificationNote: "2026-10-15 headless Chromium through the GameForge player: placed a tower, paused/resumed, cleared wave 1, then restarted to the initial 100 coins, 20 lives, and no towers. A mobile touch-emulation check also placed a tower and exercised wave/pause/resume controls; no browser errors. Physical-device testing remains unverified.",
    playerAspect: "portrait",
    tags: ["strategy", "tower defense", "waves", "mouse"],
  },
];

export const genres = [
  "Action", "Adventure", "Arcade", "Platformer", "Puzzle", "Horror", "Survival", "Racing", "Strategy", "Simulation",
  "RPG", "Roguelike", "Idle", "Rhythm", "Sports", "Multiplayer", "Narrative", "Sandbox", "Experimental", "Educational",
];

export function findDemoGame(slug: string): GameCardData | undefined {
  return demoGames.find((game) => game.slug === slug);
}
