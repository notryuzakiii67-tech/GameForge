import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError, errorResponse, requireUuid } from "@/lib/http";
import { gameResponseHeaders } from "@/lib/storage";
import { safeProjectPath, validateAiFiles } from "@/lib/zip";
import { hasPrivateAssetReferences } from "@/lib/asset-references";
import { getProjectVersionAssetIds } from "@/lib/project-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; version: string; filePath: string[] }> }) {
  try {
    const { id, version: rawVersion, filePath: parts } = await context.params;
    requireUuid(id, "project id");
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1) throw new ApiError(404, "VERSION_NOT_FOUND", "That project version could not be found.");
    const filePath = safeProjectPath(parts.join("/"));
    const rows = await query<{
      manifest_json: string; validation_status: string; owner_id: string; visibility: string; status: string;
    }>(
      `SELECT v.manifest_json, v.validation_status, p.owner_id, p.visibility, p.status
       FROM ai_project_versions v JOIN ai_projects p ON p.id = v.project_id
       WHERE p.id = ? AND v.version_number = ? LIMIT 1`, [id, version]);
    const record = rows[0];
    if (!record || record.validation_status !== "validated") throw new ApiError(404, "VERSION_NOT_FOUND", "That project version could not be found.");
    const user = await getCurrentUser();
    const publicProject = record.visibility === "public" && record.status === "published";
    if (!publicProject && user?.id !== record.owner_id && user?.role !== "admin" && user?.role !== "moderator") throw new ApiError(404, "PROJECT_NOT_FOUND", "That project could not be found.");
    let files;
    try {
      files = validateAiFiles(JSON.parse(record.manifest_json));
    } catch {
      throw new ApiError(409, "VERSION_INVALID", "This project version is not available for preview.");
    }
    const hasAssetReferences = hasPrivateAssetReferences(files);
    const boundAssetIds = await getProjectVersionAssetIds(record.owner_id, id, version);
    if (publicProject && (hasAssetReferences || boundAssetIds.length > 0)) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project could not be found.");
    if (!publicProject && (hasAssetReferences || boundAssetIds.length > 0)) {
      throw new ApiError(409, "PRIVATE_PREVIEW_SESSION_REQUIRED", "Use the GameForge Studio preview to resolve private assets with a temporary project-scoped grant.");
    }
    const file = files.find((entry) => entry.path === filePath);
    if (!file) throw new ApiError(404, "PROJECT_FILE_NOT_FOUND", "This project file could not be found.");
    const headers = gameResponseHeaders(filePath);
    if (!publicProject) headers.set("Cache-Control", "private, no-store");
    return new Response(new TextEncoder().encode(file.content), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
