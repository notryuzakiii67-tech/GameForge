import { query } from "@/lib/db";
import { ApiError, errorResponse, requireUuid } from "@/lib/http";
import { getProjectAssetBindings, resolveProjectPreviewGrant } from "@/lib/project-assets";
import { replacePrivateAssetReferences } from "@/lib/asset-references";
import { gameResponseHeaders } from "@/lib/storage";
import { safeProjectPath, validateAiFiles } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string; version: string; token: string; filePath: string[] }> }) {
  try {
    const { id, version: rawVersion, token, filePath: parts } = await context.params;
    requireUuid(id, "project id");
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1) throw new ApiError(404, "VERSION_NOT_FOUND", "That project version could not be found.");
    const grant = await resolveProjectPreviewGrant(id, version, token);
    const filePath = safeProjectPath(parts.join("/"));
    const rows = await query<{ manifest_json: string; validation_status: string }>(
      `SELECT manifest_json, validation_status FROM ai_project_versions WHERE project_id = ? AND version_number = ? LIMIT 1`,
      [id, version],
    );
    if (!rows[0] || rows[0].validation_status !== "validated") throw new ApiError(404, "VERSION_NOT_FOUND", "That project version could not be found.");
    let files;
    try { files = validateAiFiles(JSON.parse(rows[0].manifest_json)); }
    catch { throw new ApiError(409, "VERSION_INVALID", "This project version is not available for preview."); }
    const file = files.find((entry) => entry.path === filePath);
    if (!file) throw new ApiError(404, "PROJECT_FILE_NOT_FOUND", "This project file could not be found.");
    const { bindings } = await getProjectAssetBindings(grant.ownerId, id, version);
    const boundIds = new Set(bindings.map((asset) => asset.assetId));
    const origin = new URL(request.url).origin;
    const content = replacePrivateAssetReferences(file.content, (assetId) => {
      if (!boundIds.has(assetId)) throw new ApiError(409, "ASSET_REFERENCE_UNBOUND", "This version references a private asset that is not bound to it.");
      const query = new URLSearchParams({ version: String(version), token, asset: assetId });
      return `${origin}/api/ai/projects/${encodeURIComponent(id)}/preview-asset?${query.toString()}`;
    });
    const headers = gameResponseHeaders(filePath);
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Referrer-Policy", "no-referrer");
    return new Response(new TextEncoder().encode(content), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
