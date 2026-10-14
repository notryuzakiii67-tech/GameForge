import { query } from "@/lib/db";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim().slice(0, 100);
    const genre = url.searchParams.get("genre")?.trim().slice(0, 64);
    const clauses = ["p.visibility = 'public'", "p.status = 'published'"];
    const values: (string | number)[] = [];
    if (q) {
      clauses.push("(LOWER(p.title) LIKE ? OR LOWER(p.description) LIKE ?)");
      const pattern = `%${q.toLowerCase()}%`;
      values.push(pattern, pattern);
    }
    if (genre) {
      clauses.push("LOWER(p.genre) = ?");
      values.push(genre.toLowerCase());
    }
    const projects = await query<{
      id: string; title: string; description: string; genre: string; allow_remix: number; source_project_id: string | null;
      updated_at: string; username: string; display_name: string; version_number: number | null; summary: string | null;
    }>(
      `SELECT p.id, p.title, p.description, p.genre, p.allow_remix, p.source_project_id, p.updated_at,
              u.username, u.display_name, v.version_number, v.change_summary AS summary
       FROM ai_projects p JOIN users u ON u.id = p.owner_id
       LEFT JOIN ai_project_versions v ON v.id = (SELECT v2.id FROM ai_project_versions v2 WHERE v2.project_id = p.id ORDER BY v2.version_number DESC LIMIT 1)
       WHERE ${clauses.join(" AND ")} ORDER BY p.updated_at DESC LIMIT 36`, values);
    return Response.json({ projects: projects.map((project) => ({
      id: project.id,
      title: project.title,
      description: project.description,
      genre: project.genre,
      allowRemix: project.allow_remix === 1,
      sourceProjectId: project.source_project_id,
      updatedAt: project.updated_at,
      creator: { username: project.username, displayName: project.display_name },
      version: project.version_number,
      summary: project.summary,
    })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
