import { zipSync } from "fflate";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ApiError, errorResponse, requireUuid } from "@/lib/http";
import { validateAiProject } from "@/lib/ai/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const files = validateAiProject(JSON.parse(versions[0].manifest_json));
    const archive = zipSync(Object.fromEntries(files.map((file) => [file.path, new TextEncoder().encode(file.content)])), { level: 6 });
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
