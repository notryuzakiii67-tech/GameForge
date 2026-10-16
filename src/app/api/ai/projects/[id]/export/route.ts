import { createHash } from "node:crypto";
import path from "node:path";
import { zipSync } from "fflate";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError, errorResponse, requireUuid } from "@/lib/http";
import { getOwnedProjectAssetRecords } from "@/lib/project-assets";
import { getObject } from "@/lib/storage";
import { hasPrivateAssetReferences, replacePrivateAssetReferences } from "@/lib/asset-references";
import { validateAiProject } from "@/lib/ai/validate";
import { safeProjectPath } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EXPORT_BYTES = 100 * 1024 * 1024;

function archiveAssetPath(assetId: string, filename: string): string {
  return safeProjectPath(`assets/${assetId.slice(0, 8)}-${filename}`);
}

function encodeRelativePath(value: string): string {
  return value.split("/").map((segment) => segment === "." || segment === ".." ? segment : encodeURIComponent(segment)).join("/");
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    requireUuid(id, "project id");
    const projects = await query<{ owner_id: string; title: string; visibility: string; status: string }>(`SELECT owner_id, title, visibility, status FROM ai_projects WHERE id = ? LIMIT 1`, [id]);
    const project = projects[0];
    if (!project) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project is not available.");
    const user = await getCurrentUser();
    const isPublic = project.visibility === "public" && project.status === "published";
    if (!isPublic && user?.id !== project.owner_id) throw new ApiError(404, "PROJECT_NOT_FOUND", "That project is not available.");
    const versions = await query<{ manifest_json: string; version_number: number }>(`SELECT manifest_json, version_number FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1`, [id]);
    if (!versions[0]) throw new ApiError(404, "VERSION_NOT_FOUND", "This project has no downloadable version.");
    let files;
    try { files = validateAiProject(JSON.parse(versions[0].manifest_json)); }
    catch { throw new ApiError(409, "PROJECT_VERSION_INVALID", "This project version could not be exported."); }

    const bindingCounts = await query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM project_asset_bindings WHERE project_id = ? AND version_number = ?`, [id, versions[0].version_number]);
    if (isPublic && (Number(bindingCounts[0]?.count ?? 0) > 0 || hasPrivateAssetReferences(files))) {
      throw new ApiError(409, "PRIVATE_ASSET_PUBLICATION_BLOCKED", "A public project cannot export private asset bindings or private asset references.");
    }

    const boundAssets = isPublic ? [] : await getOwnedProjectAssetRecords(project.owner_id, id, Number(versions[0].version_number));
    const assetPathById = new Map(boundAssets.map((asset) => [asset.assetId, archiveAssetPath(asset.assetId, asset.filename)]));
    if (hasPrivateAssetReferences(files) && files.some((file) => {
      let missing = false;
      replacePrivateAssetReferences(file.content, (assetId) => {
        if (!assetPathById.has(assetId)) missing = true;
        return assetPathById.get(assetId) ?? "";
      });
      return missing;
    })) {
      throw new ApiError(409, "ASSET_REFERENCE_UNBOUND", "This project contains an asset placeholder that is not bound to the selected version.");
    }

    let totalBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.content, "utf8"), 0);
    const archiveEntries: Record<string, Uint8Array> = {};
    for (const file of files) {
      const content = replacePrivateAssetReferences(file.content, (assetId) => {
        const target = assetPathById.get(assetId);
        if (!target) throw new ApiError(409, "ASSET_REFERENCE_UNBOUND", "This project contains an asset placeholder that is not bound to the selected version.");
        const relative = path.posix.relative(path.posix.dirname(file.path), target);
        return encodeRelativePath(relative);
      });
      archiveEntries[file.path] = new TextEncoder().encode(content);
    }
    for (const asset of boundAssets) {
      totalBytes += asset.sizeBytes;
      if (totalBytes > MAX_EXPORT_BYTES) throw new ApiError(413, "EXPORT_TOO_LARGE", "This project’s source and bound assets exceed the 100 MiB ZIP export limit. Remove some bindings or download the assets individually.");
      const stored = await getObject(asset.storageKey);
      if (stored.body.byteLength !== asset.sizeBytes) throw new ApiError(409, "ASSET_STORAGE_MISMATCH", `The private asset “${asset.filename}” failed its stored-size check.`);
      const actualHash = createHash("sha256").update(stored.body).digest("hex");
      if (actualHash !== asset.contentHash) throw new ApiError(409, "ASSET_INTEGRITY_MISMATCH", `The private asset “${asset.filename}” failed its stored-content integrity check.`);
      archiveEntries[assetPathById.get(asset.assetId)!] = stored.body;
    }

    const archive = zipSync(archiveEntries, { level: 6 });
    const slug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "gameforge-project";
    return new Response(archive as BodyInit, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${slug}-v${versions[0].version_number}.zip"`,
        "Content-Length": String(archive.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
