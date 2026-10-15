import { findDemoGame } from "@/lib/demo-games";
import type { GameDetails } from "@/lib/games";

export function demoGameDetails(slug: string): GameDetails | null {
  const game = findDemoGame(slug);
  if (!game || game.verificationStatus === "blocked") return null;
  return {
    ...game,
    developerId: "00000000-0000-4000-8000-000000000010",
    developerUsername: game.sourceUrl ? undefined : "gameforge_demo",
    version: "1.0.0",
    publishedAt: null,
    updatedAt: "",
    controls: game.controls ?? "WASD or arrow keys",
    instructions: game.instructions ?? game.description,
    platform: game.slug === "web-arcade-maze" ? ["Desktop browser"] : ["Browser"],
    warnings: game.slug === "web-arcade-maze" ? ["Horror themes", "Sudden jumpscare and loud sounds"] : [],
    license: game.license ?? "GameForge demonstration content",
    remixEnabled: false,
    versionNumber: 1,
    storageKey: null,
    screenshots: [],
    favoriteCount: 0,
    reviewCount: 0,
    isDemo: true,
  };
}
