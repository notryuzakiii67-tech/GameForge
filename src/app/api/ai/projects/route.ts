import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const projects = await query<{
      id: string; title: string; description: string; visibility: string; status: string; source_project_id: string | null;
      allow_remix: number; updated_at: string; version_number: number | null; change_summary: string | null;
    }>(
      `SELECT p.id, p.title, p.description, p.visibility, p.status, p.source_project_id, p.allow_remix, p.updated_at,
              v.version_number, v.change_summary
       FROM ai_projects p LEFT JOIN ai_project_versions v ON v.id = (
         SELECT v2.id FROM ai_project_versions v2 WHERE v2.project_id = p.id ORDER BY v2.version_number DESC LIMIT 1
       ) WHERE p.owner_id = ? ORDER BY p.updated_at DESC LIMIT 100`,
      [user.id],
    );
    return Response.json({ projects: projects.map((project) => ({
      id: project.id,
      title: project.title,
      description: project.description,
      visibility: project.visibility,
      status: project.status,
      sourceProjectId: project.source_project_id,
      allowRemix: project.allow_remix === 1,
      updatedAt: project.updated_at,
      version: project.version_number,
      summary: project.change_summary,
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
