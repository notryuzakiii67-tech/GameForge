import { describe, expect, it } from "vitest";
import { extractPrivateAssetReferences, hasPrivateAssetReferences, replacePrivateAssetReferences } from "@/lib/asset-references";

const ASSET_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("versioned private asset placeholders", () => {
  it("finds only complete unique UUID references and replaces them without changing other text", () => {
    const source = `<img src="gameforge-asset://${ASSET_ID}"><script>const again = 'gameforge-asset://${ASSET_ID}';</script>`;
    expect(extractPrivateAssetReferences(source)).toEqual([ASSET_ID]);
    expect(hasPrivateAssetReferences([{ content: source }])).toBe(true);
    expect(replacePrivateAssetReferences(source, (id) => `/private-preview/${id}`)).toBe(
      `<img src="/private-preview/${ASSET_ID}"><script>const again = '/private-preview/${ASSET_ID}';</script>`,
    );
  });

  it("rejects malformed identifiers and suffixes instead of treating them as arbitrary URLs", () => {
    expect(() => extractPrivateAssetReferences("gameforge-asset://not-a-uuid")).toThrowError(expect.objectContaining({ code: "INVALID_ASSET_REFERENCE" }));
    expect(() => extractPrivateAssetReferences(`gameforge-asset://${ASSET_ID}/private`)).toThrowError(expect.objectContaining({ code: "INVALID_ASSET_REFERENCE" }));
  });
});
