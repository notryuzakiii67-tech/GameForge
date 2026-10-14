import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { discoverModels, providerInfo, providerSchema } from "@/lib/ai/providers";
import { assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const schema = z.object({ provider: providerSchema, apiKey: z.string().min(8).max(512) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `ai-models:${user.id}`, 12, 60 * 60 * 1000);
    const input = await readJson(request, schema);
    const models = await discoverModels(input.provider, input.apiKey);
    return Response.json({ provider: input.provider, providerName: providerInfo[input.provider].name, status: "connected", models }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
