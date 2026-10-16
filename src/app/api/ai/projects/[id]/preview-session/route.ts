import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createProjectPreviewSession } from "@/lib/project-assets";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson, requireUuid } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ version: z.number().int().positive() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `project-preview-session:${user.id}`, 60, 60 * 60 * 1000);
    const { id } = await context.params;
    requireUuid(id, "project id");
    const input = await readJson(request, schema, 4_000);
    const session = await createProjectPreviewSession(user.id, id, input.version);
    return Response.json(session, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
