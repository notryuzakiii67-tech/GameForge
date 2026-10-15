import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoGames } from "../src/lib/demo-games";

const root = process.cwd();
const game = (slug: string) => {
  const match = demoGames.find((entry) => entry.slug === slug);
  if (!match) throw new Error(`Missing demo registry entry: ${slug}`);
  return match;
};

describe("starter game catalog integrity", () => {
  it("marks browser-play-tested demos honestly and pins third-party source revisions", () => {
    expect(demoGames).toHaveLength(6);
    expect(demoGames.every((entry) => entry.verificationStatus === "tested")).toBe(true);
    expect(demoGames.some((entry) => entry.verificationStatus === "blocked")).toBe(false);
    for (const entry of demoGames) {
      expect(entry.verificationNote).toMatch(/headless Chromium/i);
      expect(entry.verificationNote).toMatch(/physical-device testing remains unverified/i);
    }

    for (const slug of ["2048", "web-arcade-maze", "tower-defense"]) {
      const entry = game(slug);
      expect(entry.sourceUrl).toMatch(/\/tree\/[0-9a-f]{40}(?:\/|$)/);
      expect(entry.sourceAttribution).toBeTruthy();
      expect(entry.license).toBeTruthy();
      expect(entry.verificationNote).toMatch(/remains unverified/i);
      expect(existsSync(path.join(root, "public/demos", slug, "index.html"))).toBe(true);
      expect(existsSync(path.join(root, "public/demos", slug, "THIRD_PARTY_NOTICES.md"))).toBe(true);
    }
  });

  it("uses viewport-appropriate player aspects and compact layouts for touch-sized frames", () => {
    for (const slug of ["neon-drift", "mosslight", "one-more-room", "web-arcade-maze"]) {
      expect(game(slug).playerAspect).toBe("square");
    }
    expect(game("2048").playerAspect).toBe("portrait");
    expect(game("tower-defense").playerAspect).toBe("portrait");

    const mobilePlayerStyles = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
    expect(mobilePlayerStyles).toContain(".player-stage.player-stage-portrait { min-height: 630px; }");
    for (const slug of ["mosslight", "one-more-room"]) {
      const html = readFileSync(path.join(root, "public/demos", slug, "index.html"), "utf8");
      expect(html).toContain("max-height:420px");
      expect(html).toContain("document.body.classList.add('playing')");
    }
  });

  it("keeps third-party runtimes local and gives only the maze its required pointer-lock capability", () => {
    const maze = game("web-arcade-maze");
    expect(maze.sandboxCapabilities).toEqual(["allow-pointer-lock"]);
    expect(maze.sandboxCapabilities).not.toContain("allow-same-origin");
    expect(game("2048").sandboxCapabilities ?? []).toEqual([]);
    expect(game("tower-defense").sandboxCapabilities ?? []).toEqual([]);

    const files = ["2048", "web-arcade-maze", "tower-defense"].map((slug) => readFileSync(path.join(root, "public/demos", slug, "index.html"), "utf8"));
    for (const html of files) {
      expect(html).not.toMatch(/<script[^>]+src=["']https?:\/\//i);
    }
    const mazeHtml = files[1];
    expect(mazeHtml).toContain("vendor/three.min.js");
    expect(mazeHtml).not.toMatch(/(?:https?:)?\/\/[^\s"']+soldier[^\s"']*\.glb/i);
  });
});
