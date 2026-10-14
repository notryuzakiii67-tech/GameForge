import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  studioName: z.string().trim().min(2).max(64),
  description: z.string().trim().max(800),
  website: z.string().trim().max(300).optional().or(z.literal("")),
});

function validateWebsite(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("bad");
    return url.toString();
  } catch {
    throw new ApiError(400, "INVALID_WEBSITE", "Studio websites must be a valid HTTPS URL.");
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const profiles = await query<{ studio_name: string; description: string; website: string | null; verification_status: string }>(
      `SELECT studio_name, description, website, verification_status FROM developer_profiles WHERE user_id = ? LIMIT 1`, [user.id]);
    const profile = profiles[0];
    return Response.json({ profile: profile ? {
      studioName: profile.studio_name,
      description: profile.description,
      website: profile.website,
      verificationStatus: profile.verification_status,
    } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = await readJson(request, schema);
    const website = validateWebsite(input.website);
    const existing = await query<{ id: string }>(`SELECT id FROM developer_profiles WHERE user_id = ?`, [user.id]);
    const timestamp = nowIso();
    if (existing[0]) {
      await execute(`UPDATE developer_profiles SET studio_name = ?, description = ?, website = ?, updated_at = ? WHERE user_id = ?`, [input.studioName, input.description, website, timestamp, user.id]);
    } else {
      await execute(`INSERT INTO developer_profiles(id, user_id, studio_name, description, website, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, [newId(), user.id, input.studioName, input.description, website, timestamp, timestamp]);
    }
    return Response.json({ profile: { studioName: input.studioName, description: input.description, website }, ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
