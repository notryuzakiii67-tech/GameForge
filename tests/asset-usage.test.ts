import { describe, expect, it } from "vitest";
import { assetUsageGuide } from "@/lib/asset-usage";

const id = "83b0e694-7908-4f28-a805-1f43be0ac7f8";

describe("format-aware private asset usage guides", () => {
  it("provides image and audio references with browser-safe interaction guidance", () => {
    const image = assetUsageGuide("image", "PNG", id);
    expect(image.snippet).toContain(`gameforge-asset://${id}`);
    expect(image.purpose).toContain("2D image");
    const audio = assetUsageGuide("audio", "OGG Vorbis", id);
    expect(audio.snippet).toContain(`new Audio("gameforge-asset://${id}")`);
    expect(audio.notes).toContain("user gesture");
  });

  it("warns that a model renderer must already be bundled with the game", () => {
    const model = assetUsageGuide("model", "GLB", id);
    expect(model.snippet).toContain(`const modelUrl = "gameforge-asset://${id}"`);
    expect(model.notes).toContain("already bundled");
    expect(model.notes).toContain("external CDN");
  });
});
