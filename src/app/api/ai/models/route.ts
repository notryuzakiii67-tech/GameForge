import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { chooseFallbackModel, discoverModelsWithQuotaFallback, providerInfo, providerSchema } from "@/lib/ai/providers";
import { assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const schema = z.object({ provider: providerSchema });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `ai-models:${user.id}`, 12, 60 * 60 * 1000);
    const input = await readJson(request, schema);
    const discovery = await discoverModelsWithQuotaFallback(input.provider);
    return Response.json({
      provider: discovery.provider,
      requestedProvider: input.provider,
      providerName: providerInfo[discovery.provider].name,
      fallbackFrom: discovery.fallbackFrom,
      recommendedModel: chooseFallbackModel(discovery.provider, discovery.models),
      status: "connected",
      models: discovery.models,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
