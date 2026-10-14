import { Script } from "node:vm";
import { ApiError } from "@/lib/http";
import { safeProjectPath, validateAiFiles, type ProjectFile } from "@/lib/zip";

export function validateAiProject(rawFiles: unknown): ProjectFile[] {
  const files = validateAiFiles(rawFiles, true);
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  for (const file of files) {
    if (!/\.(?:html?|js|mjs|cjs)$/i.test(file.path)) continue;
    const scripts: string[] = [];
    if (/\.(?:m?js|cjs)$/i.test(file.path)) scripts.push(file.content);
    else {
      const scriptTag = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
      for (const match of file.content.matchAll(scriptTag)) {
        if (/\bsrc\s*=/i.test(match[1])) continue;
        const type = /\btype\s*=\s*["']module["']/i.test(match[1]);
        if (!type) scripts.push(match[2]);
        else if (/\bimport\s*\(/.test(match[2])) throw new ApiError(400, "GENERATED_IMPORT_REJECTED", "Generated games can’t dynamically import unlisted code.");
      }
    }
    try {
      scripts.forEach((source, index) => new Script(source, { filename: `${file.path}#script-${index + 1}` }));
    } catch {
      throw new ApiError(400, "GENERATED_SYNTAX_ERROR", `There is a JavaScript syntax error in ${file.path}. Ask the studio to fix it and try again.`);
    }
    const externalScript = /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//i.test(file.content);
    if (externalScript) throw new ApiError(400, "EXTERNAL_CODE_REJECTED", "AI projects can’t load executable code from external websites.");
  }
  for (const file of files) {
    for (const match of file.content.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      const referenced = match[1];
      if (/^(?:https?:|\/\/|javascript:|data:text\/html)/i.test(referenced)) {
        throw new ApiError(400, "EXTERNAL_RESOURCE_REJECTED", "AI projects may not load external resources.");
      }
    }
  }
  const indexPath = files.find((file) => file.path.toLowerCase() === "index.html")?.path
    ?? files.find((file) => file.path.toLowerCase().endsWith("/index.html"))?.path;
  if (!indexPath) throw new ApiError(400, "ENTRY_POINT_MISSING", "The generated project needs an index.html file.");
  safeProjectPath(indexPath);
  const html = byPath.get(indexPath) ?? "";
  if (html.length < 20) throw new ApiError(400, "INVALID_PROJECT", "The project entry point is empty.");
  return files;
}
