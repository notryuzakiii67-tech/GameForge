import { describe, expect, it } from "vitest";
import { replaceWithAssetReference } from "@/lib/asset-replacement";

describe("guided project asset reference replacement", () => {
  const placeholder = "gameforge-asset://83b0e694-7908-4f28-a805-1f43be0ac7f8";

  it("replaces only the selected URL and returns the caret position", () => {
    const source = '<img src="./assets/old.png" alt="ship">';
    const start = source.indexOf("./assets/old.png");
    const end = start + "./assets/old.png".length;
    const result = replaceWithAssetReference(source, start, end, placeholder);
    expect(result.content).toBe(`<img src="${placeholder}" alt="ship">`);
    expect(result.cursor).toBe(start + placeholder.length);
  });

  it("inserts at the cursor when nothing is selected and clamps out-of-range selections", () => {
    expect(replaceWithAssetReference("ab", 1, 1, placeholder)).toEqual({ content: `a${placeholder}b`, cursor: 1 + placeholder.length });
    expect(replaceWithAssetReference("abc", 99, 999, placeholder)).toEqual({ content: `abc${placeholder}`, cursor: 3 + placeholder.length });
    expect(replaceWithAssetReference("abc", Number.NaN, Number.NaN, placeholder)).toEqual({ content: `${placeholder}abc`, cursor: placeholder.length });
  });
});
