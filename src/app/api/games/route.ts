import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";
import { genres } from "@/lib/demo-games";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(2).max(80),
  description: z.string().trim().max(5000).default(""),
  genre: z.string().trim().max(64).default("Experimental"),
  tags: z.array(z.string().trim().min(1).max(24)).max(12).default([]),
  controls: z.string().trim().max(1000).default(""),
  instructions: z.string().trim().max(2000).default(""),
  remixEnabled: z.boolean().default(false),
  license: z.enum(["all-rights-reserved", "cc-by-4.0", "cc-by-sa-4.0", "cc0-1.0"]).default("all-rights-reserved"),
});

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "game";
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `game-create:${user.id}`, 8, 60 * 60 * 1000);
    const input = await readJson(request, createSchema);
    const requestedGenre = input.genre ?? "Experimental";
    const genre = genres.find((item) => item.toLowerCase() === requestedGenre.toLowerCase()) ?? "Experimental";
    const id = newId();
    const baseSlug = slugify(input.title);
    let slug = baseSlug;
    if ((await query<{ id: string }>(`SELECT id FROM games WHERE slug = ? LIMIT 1`, [slug])).length) slug = `${baseSlug}-${id.slice(0, 6)}`;
    const tags = [...new Set((input.tags ?? []).map((tag) => tag.toLowerCase()))].slice(0, 12);
    const timestamp = nowIso();
    await execute(
      `INSERT INTO games(id, developer_id, title, slug, description, genre, tags_json, status, visibility,
                         controls, instructions, license, remix_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', 'private', ?, ?, ?, ?, ?, ?)`,
      [id, user.id, input.title, slug, input.description ?? "", genre, JSON.stringify(tags), input.controls ?? "", input.instructions ?? "", input.license ?? "all-rights-reserved", input.remixEnabled ? 1 : 0, timestamp, timestamp],
    );
    return Response.json({ game: { id, slug, title: input.title, status: "draft" } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error instanceof z.ZodError ? new ApiError(400, "INVALID_INPUT", "Please review your game details.") : error);
  }
}
