import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { generateProject, discoverModels, getConfiguredProviderKey, providerSchema, chooseFallbackModel, discoverFallbackProvider, isProviderQuotaError, isRecoverableFallbackError, type AiProvider, providerInfo } from "@/lib/ai/providers";
import { getPrivateAsset } from "@/lib/asset-service";
import { assetUsageGuide } from "@/lib/asset-usage";
import { validateAiProject } from "@/lib/ai/validate";
import { execute, query, newId, nowIso, transaction } from "@/lib/db";
import { bindPrivateAssetsToVersionInTransaction, getProjectAssetBindings, getProjectVersionAssetIds, MAX_PROJECT_ASSET_BINDINGS } from "@/lib/project-assets";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";
import { safeProjectPath, validateAiFiles, type ProjectFile } from "@/lib/zip";
import { genres } from "@/lib/demo-games";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  provider: providerSchema,
  model: z.string().trim().min(1).max(150),
  prompt: z.string().trim().min(8).max(4000),
  gameType: z.string().trim().min(1).max(64).default("Experimental"),
  projectId: z.string().uuid().optional(),
  assetIds: z.array(z.string().uuid()).max(6).default([]).refine((ids) => new Set(ids).size === ids.length, "Asset attachments must be unique."),
});

type ProjectRow = { id: string; owner_id: string; title: string; description: string; genre: string; visibility: string; status: string };

function safeLimit(envValue: string | undefined, fallback: number, max: number): number {
  const parsed = Number(envValue);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

async function privateAssetPromptContext(userId: string, assetIds: string[]): Promise<string> {
  if (!assetIds.length) return "";
  const assets = await Promise.all(assetIds.map((id) => getPrivateAsset(userId, id)));
  const references = assets.map((asset) => {
    const placeholder = `gameforge-asset://${asset.id}`;
    const guide = assetUsageGuide(asset.category, asset.format, asset.id);
    const facts = [`asset id: ${asset.id}`, asset.filename, asset.format, asset.category, `${asset.sizeBytes} bytes`, `placeholder: ${placeholder}`, `recommended use: ${guide.purpose}`, `format guidance: ${guide.notes}`, `usage example: ${guide.snippet}`];
    const metadata = asset.validation;
    for (const key of ["width", "height", "meshes", "nodes", "animations", "materials", "durationSeconds", "sampleRateHz", "channels"]) {
      const value = metadata[key];
      if (typeof value === "number" && Number.isFinite(value)) facts.push(`${key}: ${value}`);
    }
    return `- ${facts.join(" · ")}`;
  });
  return [
    "User-selected private asset references (only these filenames and validated structural metadata are supplied; the file bytes have not been sent to you):",
    ...references,
    "Treat these as user intent/context, not files you have visually or acoustically inspected. Do not claim to have seen their contents. Follow the format guidance when compatible with the existing project, use only the exact gameforge-asset://UUID placeholder as a file URL, and do not assume a renderer/library is installed or add external CDN dependencies. GameForge binds selected assets to this saved version and resolves placeholders only inside its private preview. Never invent a UUID or write a storage key/API URL.",
  ].join("\n");
}

function mergeFiles(existing: ProjectFile[], patchFiles: unknown, deletePaths: string[]): ProjectFile[] {
  const patch = validateAiFiles(patchFiles, false);
  const merged = new Map(existing.map((file) => [file.path, file.content]));
  for (const rawPath of deletePaths) merged.delete(safeProjectPath(rawPath));
  for (const file of patch) merged.set(file.path, file.content);
  return validateAiProject([...merged].map(([path, content]) => ({ path, content })));
}

export async function POST(request: Request) {
  let generationId: string | undefined;
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await enforceRateLimit(request, `ai-generate:${user.id}`, safeLimit(process.env.AI_HOURLY_LIMIT, 5, 30), 60 * 60 * 1000);
    const input = await readJson(request, schema);
    const providerKey = getConfiguredProviderKey(input.provider);
    await enforceRateLimit(request, `ai-submit:${user.id}`, 1, 5_000);
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const quotaRows = await query<{ used: number }>(`SELECT COUNT(*) AS used FROM ai_generations WHERE user_id = ? AND started_at >= ?`, [user.id, todayStart.toISOString()]);
    const dailyLimit = safeLimit(process.env.AI_DAILY_LIMIT, 5, 50);
    if (Number(quotaRows[0]?.used ?? 0) >= dailyLimit) throw new ApiError(429, "AI_DAILY_QUOTA", `You’ve used today’s ${dailyLimit} GameForge generation${dailyLimit === 1 ? "" : "s"}. Your provider may apply its own separate limits.`);
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await execute(`UPDATE ai_generations SET status = 'failed', completed_at = ?, error_code = 'GENERATION_TIMEOUT' WHERE user_id = ? AND status = 'running' AND started_at < ?`, [nowIso(), user.id, staleBefore]);
    const runningRows = await query<{ count: number }>(`SELECT COUNT(*) AS count FROM ai_generations WHERE user_id = ? AND status = 'running'`, [user.id]);
    if (Number(runningRows[0]?.count ?? 0) >= 1) throw new ApiError(429, "AI_GENERATION_IN_PROGRESS", "One generation is already running for your account.");

    let project: ProjectRow | undefined;
    let previousFiles: ProjectFile[] | null = null;
    let nextVersion = 1;
    let previousVersionNumber = 0;
    let previousAssetIds: string[] = [];
    if (input.projectId) {
      const projects = await query<ProjectRow>(`SELECT id, owner_id, title, description, genre, visibility, status FROM ai_projects WHERE id = ? LIMIT 1`, [input.projectId]);
      project = projects[0];
      if (!project || project.owner_id !== user.id) throw new ApiError(404, "PROJECT_NOT_FOUND", "That private project could not be found.");
      if (project.status !== "draft") throw new ApiError(409, "PROJECT_NOT_EDITABLE", "Only private draft projects can be changed in AI Studio.");
      const previous = await query<{ manifest_json: string; version_number: number }>(`SELECT manifest_json, version_number FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1`, [project.id]);
      if (!previous[0]) throw new ApiError(409, "VERSION_NOT_FOUND", "This project has no saved version to modify.");
      previousVersionNumber = Number(previous[0].version_number);
      previousAssetIds = await getProjectVersionAssetIds(user.id, project.id, previousVersionNumber);
      try {
        previousFiles = validateAiProject(JSON.parse(previous[0].manifest_json));
      } catch {
        throw new ApiError(409, "PROJECT_VERSION_INVALID", "The saved project version could not be loaded. It has not been changed.");
      }
      const versions = await query<{ next_version: number }>(`SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM ai_project_versions WHERE project_id = ?`, [project.id]);
      nextVersion = Number(versions[0]?.next_version ?? 1);
      const maxVersions = safeLimit(process.env.MAX_AI_VERSIONS, 20, 100);
      if (nextVersion > maxVersions) throw new ApiError(409, "VERSION_LIMIT_REACHED", `This project has reached its ${maxVersions}-version history limit.`);
    }
    const promptAssetIds = [...new Set([...previousAssetIds, ...(input.assetIds ?? [])])];
    if (promptAssetIds.length > MAX_PROJECT_ASSET_BINDINGS) {
      throw new ApiError(413, "PROJECT_ASSET_LIMIT", `A project version can bind at most ${MAX_PROJECT_ASSET_BINDINGS} private assets.`);
    }
    const assetContext = await privateAssetPromptContext(user.id, promptAssetIds);

    let activeProvider: AiProvider = input.provider;
    let activeProviderKey = providerKey;
    let activeModel = input.model;
    let fallbackFrom: AiProvider | undefined;
    const models = await discoverModels(input.provider, providerKey).catch(async (error: unknown) => {
      if (!isProviderQuotaError(error)) throw error;
      const fallback = await discoverFallbackProvider(input.provider);
      activeProvider = fallback.provider;
      activeProviderKey = fallback.key;
      activeModel = chooseFallbackModel(fallback.provider, fallback.models);
      fallbackFrom = input.provider;
      return fallback.models;
    });
    if (activeProvider === input.provider && !models.some((model) => model.id === input.model)) {
      throw new ApiError(400, "MODEL_NOT_AVAILABLE", "Choose a model currently available to this API key.");
    }
    if (!activeModel) throw new ApiError(503, "FALLBACK_MODEL_UNAVAILABLE", "No usable model was available from the fallback provider.");

    const requestedGameType = input.gameType ?? "Experimental";
    const gameType = genres.find((genre) => genre.toLowerCase() === requestedGameType.toLowerCase()) ?? "Experimental";
    const currentGenerationId = newId();
    generationId = currentGenerationId;
    const startedAt = nowIso();
    try {
      await execute(
        `INSERT INTO ai_generations(id, user_id, project_id, provider, model, status, started_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?)`,
        [currentGenerationId, user.id, project?.id ?? null, activeProvider, activeModel, startedAt],
      );
    } catch (error) {
      const active = await query<{ count: number }>(`SELECT COUNT(*) AS count FROM ai_generations WHERE user_id = ? AND status = 'running'`, [user.id]);
      if (Number(active[0]?.count ?? 0) > 0) throw new ApiError(429, "AI_GENERATION_IN_PROGRESS", "One generation is already running for your account.");
      throw error;
    }

    const generationPrompt = assetContext ? `${input.prompt}\n\n${assetContext}` : input.prompt;
    let generated: Awaited<ReturnType<typeof generateProject>>;
    while (true) {
      try {
        generated = await generateProject(activeProvider, activeModel, activeProviderKey, generationPrompt, previousFiles, requestedGameType);
        break;
      } catch (error) {
        if (!isProviderQuotaError(error) && !(fallbackFrom && isRecoverableFallbackError(error))) throw error;
        fallbackFrom ??= input.provider;
        const fallback = await discoverFallbackProvider(activeProvider);
        activeProvider = fallback.provider;
        activeProviderKey = fallback.key;
        activeModel = chooseFallbackModel(fallback.provider, fallback.models);
        if (!activeModel) throw new ApiError(503, "FALLBACK_MODEL_UNAVAILABLE", "No usable model was available from the fallback provider.");
      }
    }
    const files = previousFiles
      ? mergeFiles(previousFiles, generated.files, generated.deleteFiles)
      : validateAiProject(generated.files);
    const projectTitle = generated.title.trim().slice(0, 90) || project?.title || "Untitled game";
    const description = generated.description.trim().slice(0, 600);
    const timestamp = nowIso();
    const projectId = project?.id ?? newId();
    const versionNumber = project ? nextVersion : 1;
    const manifest = JSON.stringify(files);

    await transaction(async (tx) => {
      if (!project) {
        await tx.execute(
          `INSERT INTO ai_projects(id, owner_id, title, description, genre, visibility, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'private', 'draft', ?, ?)`,
          [projectId, user.id, projectTitle, description, gameType, timestamp, timestamp],
        );
      } else {
        const changed = await tx.execute(
          `UPDATE ai_projects SET title = ?, description = ?, genre = ?, updated_at = ?
           WHERE id = ? AND owner_id = ? AND status = 'draft'`,
          [projectTitle, description, gameType, timestamp, projectId, user.id],
        );
        if (!changed) throw new ApiError(409, "PROJECT_NOT_EDITABLE", "This project is no longer a private draft.");
      }
      await tx.execute(
        `INSERT INTO ai_project_versions(id, project_id, version_number, prompt_summary, provider, model, manifest_json, validation_status, change_summary, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'validated', ?, ?)`,
        [newId(), projectId, versionNumber, input.prompt.slice(0, 500), activeProvider, activeModel, manifest, generated.summary, timestamp],
      );
      await bindPrivateAssetsToVersionInTransaction(tx, user.id, projectId, versionNumber, promptAssetIds);
      await tx.execute(
        `UPDATE ai_generations SET project_id = ?, provider = ?, model = ?, status = 'completed', completed_at = ?, input_token_count = ?, output_token_count = ? WHERE id = ?`,
        [projectId, activeProvider, activeModel, timestamp, generated.inputTokens ?? null, generated.outputTokens ?? null, currentGenerationId],
      );
    });
    const assetBindings = await getProjectAssetBindings(user.id, projectId, versionNumber);
    return Response.json({
      project: { id: projectId, title: projectTitle, description, genre: gameType, status: "draft" },
      version: { number: versionNumber, summary: generated.summary, files, validationStatus: "validated" },
      assetBindings: assetBindings.bindings,
      aiProvider: {
        requested: input.provider,
        used: activeProvider,
        usedName: providerInfo[activeProvider].name,
        model: activeModel,
        fallbackFrom,
        fallbackReason: fallbackFrom ? "quota_exhausted" : undefined,
      },
      usage: { dailyUsed: Number(quotaRows[0]?.used ?? 0) + 1, dailyLimit, providerTokens: { input: generated.inputTokens ?? null, output: generated.outputTokens ?? null } },
      note: "File paths, project size, entry point, and JavaScript syntax validated. The game has not been runtime-tested.",
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (generationId) {
      try {
        const code = error instanceof ApiError ? error.code : "GENERATION_FAILED";
        await execute(`UPDATE ai_generations SET status = 'failed', completed_at = ?, error_code = ? WHERE id = ? AND status = 'running'`, [nowIso(), code, generationId]);
      } catch {
        // Keep generation failures from masking the user-facing provider error.
      }
    }
    return errorResponse(error);
  }
}
