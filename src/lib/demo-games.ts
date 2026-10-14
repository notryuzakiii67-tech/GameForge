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
    tags: ["arcade", "keyboard", "quick play"],
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
    tags: ["adventure", "puzzle", "keyboard"],
  },
];

export const genres = [
  "Action", "Adventure", "Arcade", "Platformer", "Puzzle", "Horror", "Survival", "Racing", "Strategy", "Simulation",
  "RPG", "Roguelike", "Idle", "Rhythm", "Sports", "Multiplayer", "Narrative", "Sandbox", "Experimental", "Educational",
];

export function findDemoGame(slug: string): GameCardData | undefined {
  return demoGames.find((game) => game.slug === slug);
}
