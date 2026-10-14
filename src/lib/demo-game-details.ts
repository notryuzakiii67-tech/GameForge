import { findDemoGame } from "@/lib/demo-games";
import type { GameDetails } from "@/lib/games";

export function demoGameDetails(slug: string): GameDetails | null {
  const game = findDemoGame(slug);
  if (!game) return null;
  return {
    ...game,
    developerId: "00000000-0000-4000-8000-000000000010",
    developerUsername: "gameforge_demo",
    version: "1.0.0",
    publishedAt: null,
    updatedAt: "",
    controls: game.slug === "mosslight" ? "Arrow keys or tap an adjacent tile" : "WASD or arrow keys",
    instructions: game.description,
    platform: ["Browser"],
    warnings: [],
    license: "GameForge demonstration content",
    remixEnabled: false,
    versionNumber: 1,
    storageKey: null,
    screenshots: [],
    favoriteCount: 0,
    reviewCount: 0,
    isDemo: true,
  };
}
