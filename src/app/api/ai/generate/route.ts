import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { generateProject, discoverModels, providerSchema } from "@/lib/ai/providers";
import { validateAiProject } from "@/lib/ai/validate";
import { execute, query, newId, nowIso } from "@/lib/db";
import { ApiError, assertSameOrigin, enforceRateLimit, errorResponse, readJson } from "@/lib/http";
import { safeProjectPath, validateAiFiles, type ProjectFile } from "@/lib/zip";
import { genres } from "@/lib/demo-games";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  provider: providerSchema,
  model: z.string().trim().min(1).max(150),
  apiKey: z.string().min(8).max(512),
  prompt: z.string().trim().min(8).max(4000),
  gameType: z.string().trim().min(1).max(64).default("Experimental"),
  projectId: z.string().uuid().optional(),
});

type ProjectRow = { id: string; owner_id: string; title: string; description: string; genre: string; visibility: string; status: string };

function safeLimit(envValue: string | undefined, fallback: number, max: number): number {
  const parsed = Number(envValue);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
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
    if (input.projectId) {
      const projects = await query<ProjectRow>(`SELECT id, owner_id, title, description, genre, visibility, status FROM ai_projects WHERE id = ? LIMIT 1`, [input.projectId]);
      project = projects[0];
      if (!project || project.owner_id !== user.id) throw new ApiError(404, "PROJECT_NOT_FOUND", "That private project could not be found.");
      if (project.status !== "draft") throw new ApiError(409, "PROJECT_NOT_EDITABLE", "Only private draft projects can be changed in AI Studio.");
      const previous = await query<{ manifest_json: string }>(`SELECT manifest_json FROM ai_project_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1`, [project.id]);
      if (!previous[0]) throw new ApiError(409, "VERSION_NOT_FOUND", "This project has no saved version to modify.");
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

    const models = await discoverModels(input.provider, input.apiKey);
    if (!models.some((model) => model.id === input.model)) throw new ApiError(400, "MODEL_NOT_AVAILABLE", "Choose a model currently available to this API key.");

    const requestedGameType = input.gameType ?? "Experimental";
    const gameType = genres.find((genre) => genre.toLowerCase() === requestedGameType.toLowerCase()) ?? "Experimental";
    generationId = newId();
    const startedAt = nowIso();
    try {
      await execute(
        `INSERT INTO ai_generations(id, user_id, project_id, provider, model, status, started_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?)`,
        [generationId, user.id, project?.id ?? null, input.provider, input.model, startedAt],
      );
    } catch (error) {
      const active = await query<{ count: number }>(`SELECT COUNT(*) AS count FROM ai_generations WHERE user_id = ? AND status = 'running'`, [user.id]);
      if (Number(active[0]?.count ?? 0) > 0) throw new ApiError(429, "AI_GENERATION_IN_PROGRESS", "One generation is already running for your account.");
      throw error;
    }

    const generated = await generateProject(input.provider, input.model, input.apiKey, input.prompt, previousFiles, requestedGameType);
    const files = previousFiles
      ? mergeFiles(previousFiles, generated.files, generated.deleteFiles)
      : validateAiProject(generated.files);
    const projectTitle = generated.title.trim().slice(0, 90) || project?.title || "Untitled game";
    const description = generated.description.trim().slice(0, 600);
    const timestamp = nowIso();
    const projectId = project?.id ?? newId();
    let versionNumber = 1;

    if (!project) {
      await execute(
        `INSERT INTO ai_projects(id, owner_id, title, description, genre, visibility, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'private', 'draft', ?, ?)`,
        [projectId, user.id, projectTitle, description, gameType, timestamp, timestamp],
      );
    } else {
      versionNumber = nextVersion;
      await execute(`UPDATE ai_projects SET title = ?, description = ?, genre = ?, updated_at = ? WHERE id = ? AND owner_id = ?`, [projectTitle, description, gameType, timestamp, projectId, user.id]);
    }

    const manifest = JSON.stringify(files);
    await execute(
      `INSERT INTO ai_project_versions(id, project_id, version_number, prompt_summary, provider, model, manifest_json, validation_status, change_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'validated', ?, ?)`,
      [newId(), projectId, versionNumber, input.prompt.slice(0, 500), input.provider, input.model, manifest, generated.summary, timestamp],
    );
    await execute(
      `UPDATE ai_generations SET project_id = ?, status = 'completed', completed_at = ?, input_token_count = ?, output_token_count = ? WHERE id = ?`,
      [projectId, timestamp, generated.inputTokens ?? null, generated.outputTokens ?? null, generationId],
    );
    return Response.json({
      project: { id: projectId, title: projectTitle, description, genre: gameType, status: "draft" },
      version: { number: versionNumber, summary: generated.summary, files, validationStatus: "validated" },
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
