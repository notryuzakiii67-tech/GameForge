import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { GamePlayer } from "@/components/GamePlayer";

describe("game player startup boundary", () => {
  it("waits for hydration before requesting the game iframe", () => {
    const markup = renderToStaticMarkup(
      <GamePlayer
        title="Tower Defense"
        src="/demos/tower-defense/index.html"
        controls="Mouse"
        demo
      />,
    );

    expect(markup).not.toContain("<iframe");
    expect(markup).not.toContain('src="/demos/tower-defense/index.html"');
    expect(markup).toContain("Loading game files");
  });

  it("allows opaque-origin demo frames to load local assets without relaxing the sandbox", async () => {
    const routes = await nextConfig.headers?.();
    const demoRoute = routes?.find((route) => route.source === "/demos/:path*");
    const resourcePolicy = demoRoute?.headers.find((header) => header.key === "Cross-Origin-Resource-Policy");
    const contentPolicy = demoRoute?.headers.find((header) => header.key === "Content-Security-Policy");

    expect(resourcePolicy?.value).toBe("cross-origin");
    expect(contentPolicy?.value).toContain("sandbox allow-scripts");
    expect(contentPolicy?.value).not.toContain("allow-same-origin");
  });
});
