import { ApiError } from "@/lib/http";

const ASSET_PREFIX = "gameforge-asset://";
const UUID_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ASSET_URI = new RegExp(`${ASSET_PREFIX}(${UUID_SOURCE})`, "gi");
const ASSET_URI_START = /gameforge-asset:\/\//gi;
const VALID_TERMINATOR = /[\s\"'`<>),;\]}]/;

/** Find only explicit GameForge asset URIs; malformed attempts fail closed. */
export function extractPrivateAssetReferences(content: string): string[] {
  const ids: string[] = [];
  for (const start of content.matchAll(ASSET_URI_START)) {
    const index = start.index ?? 0;
    const afterPrefix = content.slice(index + ASSET_PREFIX.length);
    const match = afterPrefix.match(new RegExp(`^(${UUID_SOURCE})`, "i"));
    if (!match) throw new ApiError(400, "INVALID_ASSET_REFERENCE", "Use a complete GameForge asset reference with its exact UUID.");
    const terminator = afterPrefix[match[1].length];
    if (terminator !== undefined && !VALID_TERMINATOR.test(terminator)) {
      throw new ApiError(400, "INVALID_ASSET_REFERENCE", "GameForge asset references must contain only the asset UUID.");
    }
    ids.push(match[1].toLowerCase());
  }
  return [...new Set(ids)];
}

/** Resolve project placeholders without exposing a storage key or account cookie. */
export function replacePrivateAssetReferences(
  content: string,
  resolve: (assetId: string) => string,
): string {
  return content.replace(ASSET_URI, (_match, rawId: string) => resolve(rawId.toLowerCase()));
}

export function hasPrivateAssetReferences(files: Array<{ content: string }>): boolean {
  return files.some((file) => extractPrivateAssetReferences(file.content).length > 0);
}

export function privateAssetReference(assetId: string): string {
  return `${ASSET_PREFIX}${assetId.toLowerCase()}`;
}
