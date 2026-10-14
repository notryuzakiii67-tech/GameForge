import { createHash } from "node:crypto";
import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import { ApiError } from "@/lib/http";

export type ProjectFile = { path: string; content: string };
export type ValidatedBuild = {
  files: Record<string, Uint8Array>;
  entryPoint: string;
  fileSize: number;
  contentHash: string;
};

const DEFAULT_UPLOAD_LIMIT = 4 * 1024 * 1024;
const DEFAULT_EXPANDED_LIMIT = 40 * 1024 * 1024;
const DEFAULT_MAX_FILES = 300;
const MAX_SINGLE_FILE = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "html", "htm", "css", "js", "mjs", "cjs", "json", "map", "txt", "xml", "webmanifest",
  "png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg",
  "mp3", "wav", "ogg", "oga", "m4a", "aac", "mp4", "webm", "ogv",
  "woff", "woff2", "ttf", "otf", "eot",
  "wasm", "data", "pck", "unityweb", "bin", "dat", "asset", "gz", "br",
]);
const MAX_PROJECT_FILES = 80;
const MAX_PROJECT_BYTES = 1_000_000;

function configuredLimit(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 1024 ? Math.floor(parsed) : fallback;
}

export function gameUploadLimit(): number {
  return configuredLimit("MAX_UPLOAD_BYTES", DEFAULT_UPLOAD_LIMIT);
}

export function safeProjectPath(rawPath: string): string {
  if (typeof rawPath !== "string" || rawPath.length < 1 || rawPath.length > 240 || rawPath.includes("\0")) {
    throw new ApiError(400, "UNSAFE_PATH", "A project contains an invalid file path.");
  }
  const normalized = rawPath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith("//")) {
    throw new ApiError(400, "UNSAFE_PATH", "A project contains an absolute file path.");
  }
  const segments = normalized.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new ApiError(400, "UNSAFE_PATH", "A project contains a hidden or unsafe file path.");
  }
  if (segments.some((part) => /[<>:"|?*\u0000-\u001f]/.test(part))) {
    throw new ApiError(400, "UNSAFE_PATH", "A project contains an unsupported file name.");
  }
  return segments.join("/");
}

function validateExtension(filePath: string): void {
  const name = filePath.split("/").at(-1) ?? "";
  const extension = name.includes(".") ? name.split(".").at(-1)!.toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new ApiError(400, "DISALLOWED_FILE_TYPE", `The file “${name}” is not an allowed browser-game asset.`);
  }
}

function inspectCentralDirectory(zip: Uint8Array, maxFiles: number, maxExpanded: number): string[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const minimum = Math.max(0, zip.byteLength - 65_557);
  let eocd = -1;
  for (let i = zip.byteLength - 22; i >= minimum; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0 || eocd + 22 > zip.byteLength) throw new ApiError(400, "INVALID_ARCHIVE", "This file is not a supported ZIP archive.");
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  const diskEntries = view.getUint16(eocd + 8, true);
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const commentLength = view.getUint16(eocd + 20, true);
  if (eocd + 22 + commentLength > zip.byteLength || disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new ApiError(400, "UNSUPPORTED_ARCHIVE", "Multi-disk or malformed ZIP archives are not supported.");
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new ApiError(413, "ARCHIVE_TOO_LARGE", "ZIP64 archives are not supported by this upload flow.");
  }
  if (totalEntries === 0 || totalEntries > maxFiles || centralOffset + centralSize > eocd) {
    throw new ApiError(413, "ARCHIVE_LIMIT_EXCEEDED", "The ZIP contains too many files or has an invalid directory.");
  }

  const names: string[] = [];
  let cursor = centralOffset;
  let expandedTotal = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let index = 0; index < totalEntries; index++) {
    if (cursor + 46 > zip.byteLength || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new ApiError(400, "INVALID_ARCHIVE", "The ZIP directory is damaged.");
    }
    const madeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const expandedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const fileCommentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const recordLength = 46 + nameLength + extraLength + fileCommentLength;
    if (cursor + recordLength > zip.byteLength) throw new ApiError(400, "INVALID_ARCHIVE", "The ZIP directory is truncated.");
    if (flags & 0x0001) throw new ApiError(400, "ENCRYPTED_ARCHIVE", "Encrypted ZIP files are not supported.");
    if (method !== 0 && method !== 8) throw new ApiError(400, "UNSUPPORTED_COMPRESSION", "This ZIP uses an unsupported compression method.");
    if (compressedSize === 0xffffffff || expandedSize === 0xffffffff) throw new ApiError(413, "ARCHIVE_TOO_LARGE", "ZIP64 entries are not supported.");
    if (expandedSize > MAX_SINGLE_FILE) throw new ApiError(413, "FILE_TOO_LARGE", "An archive file is larger than the allowed limit.");
    expandedTotal += expandedSize;
    if (expandedTotal > maxExpanded) throw new ApiError(413, "ARCHIVE_LIMIT_EXCEEDED", "The uncompressed game build is larger than the allowed limit.");

    const rawName = decoder.decode(zip.subarray(cursor + 46, cursor + 46 + nameLength));
    const directory = rawName.endsWith("/");
    const path = safeProjectPath(directory ? rawName.slice(0, -1) : rawName);
    if (directory) {
      cursor += recordLength;
      continue;
    }
    const unixType = madeBy >> 8 === 3 ? (externalAttributes >>> 16) & 0xf000 : 0;
    if (unixType === 0xa000 || (unixType !== 0 && unixType !== 0x8000)) {
      throw new ApiError(400, "SPECIAL_FILE_REJECTED", "Links and special files are not allowed in game archives.");
    }
    validateExtension(path);
    names.push(path);
    cursor += recordLength;
  }
  if (names.length === 0) throw new ApiError(400, "EMPTY_ARCHIVE", "The ZIP archive does not contain any game files.");
  if (new Set(names).size !== names.length) throw new ApiError(400, "DUPLICATE_PATH", "The ZIP contains duplicate file paths.");
  return names;
}

export function validateGameZip(input: Uint8Array): ValidatedBuild {
  const maxUpload = gameUploadLimit();
  const maxExpanded = configuredLimit("MAX_EXPANDED_BYTES", DEFAULT_EXPANDED_LIMIT);
  if (input.byteLength < 22) throw new ApiError(400, "INVALID_ARCHIVE", "The uploaded file is not a complete ZIP archive.");
  if (input.byteLength > maxUpload) throw new ApiError(413, "UPLOAD_TOO_LARGE", `ZIP uploads are limited to ${Math.floor(maxUpload / 1024 / 1024)} MB.`);
  const expectedNames = inspectCentralDirectory(input, configuredLimit("MAX_ARCHIVE_FILES", DEFAULT_MAX_FILES), maxExpanded);

  const files: Record<string, Uint8Array> = {};
  const expected = new Set(expectedNames);
  let expandedTotal = 0;
  let extractionError: ApiError | undefined;
  try {
    const unzip = new Unzip((file) => {
      if (!expected.has(file.name) || extractionError) return;
      const chunks: Uint8Array[] = [];
      let fileSize = 0;
      file.ondata = (error, chunk, final) => {
        if (error) {
          extractionError = new ApiError(400, "INVALID_ARCHIVE", "The ZIP could not be safely extracted.");
          return;
        }
        fileSize += chunk.byteLength;
        expandedTotal += chunk.byteLength;
        if (fileSize > MAX_SINGLE_FILE || expandedTotal > maxExpanded) {
          extractionError = new ApiError(413, "ARCHIVE_LIMIT_EXCEEDED", "The uncompressed game build is larger than the allowed limit.");
          void file.terminate();
          return;
        }
        chunks.push(chunk);
        if (final) {
          const output = new Uint8Array(fileSize);
          let offset = 0;
          for (const part of chunks) {
            output.set(part, offset);
            offset += part.byteLength;
          }
          files[file.name] = output;
        }
      };
      try {
        file.start();
      } catch {
        extractionError = new ApiError(400, "UNSUPPORTED_COMPRESSION", "This ZIP uses an unsupported compression method.");
      }
    });
    unzip.register(UnzipInflate);
    unzip.register(UnzipPassThrough);
    unzip.push(input, true);
  } catch {
    throw extractionError ?? new ApiError(400, "INVALID_ARCHIVE", "The ZIP could not be safely extracted.");
  }
  if (extractionError) throw extractionError;
  for (const filePath of expectedNames) {
    if (!files[filePath]) throw new ApiError(400, "INVALID_ARCHIVE", "The ZIP is missing a declared game file.");
  }
  const total = expandedTotal;
  const entryPoint = Object.keys(files).find((name) => name.toLowerCase() === "index.html")
    ?? Object.keys(files).find((name) => name.toLowerCase().endsWith("/index.html"));
  if (!entryPoint) throw new ApiError(400, "ENTRY_POINT_MISSING", "Add an index.html file at the ZIP root or one folder below it.");
  const contentHash = createHash("sha256").update(input).digest("hex");
  return { files, entryPoint, fileSize: total, contentHash };
}

export function validateAiFiles(raw: unknown, requireEntryPoint = true): ProjectFile[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PROJECT_FILES) {
    throw new ApiError(400, "INVALID_PROJECT", `A generated project must contain between 1 and ${MAX_PROJECT_FILES} files.`);
  }
  const seen = new Set<string>();
  let byteTotal = 0;
  const files = raw.map((entry): ProjectFile => {
    if (!entry || typeof entry !== "object" || typeof (entry as { path?: unknown }).path !== "string" || typeof (entry as { content?: unknown }).content !== "string") {
      throw new ApiError(400, "INVALID_PROJECT", "The generated project contains a malformed file.");
    }
    const path = safeProjectPath((entry as { path: string }).path);
    validateExtension(path);
    if (seen.has(path)) throw new ApiError(400, "DUPLICATE_PATH", "The generated project contains duplicate file paths.");
    seen.add(path);
    const content = (entry as { content: string }).content;
    const byteLength = Buffer.byteLength(content, "utf8");
    byteTotal += byteLength;
    if (byteTotal > MAX_PROJECT_BYTES) throw new ApiError(413, "PROJECT_TOO_LARGE", "AI projects are limited to 1 MB of source and assets.");
    return { path, content };
  });
  if (requireEntryPoint && !files.some((file) => file.path.toLowerCase() === "index.html" || file.path.toLowerCase().endsWith("/index.html"))) {
    throw new ApiError(400, "ENTRY_POINT_MISSING", "The generated project needs an index.html entry point.");
  }
  return files;
}

export function textFilesToBuild(files: ProjectFile[]): ValidatedBuild {
  const validated = validateAiFiles(files);
  const mapped = Object.fromEntries(validated.map((file) => [file.path, new TextEncoder().encode(file.content)]));
  const entryPoint = Object.keys(mapped).find((name) => name.toLowerCase() === "index.html")
    ?? Object.keys(mapped).find((name) => name.toLowerCase().endsWith("/index.html"))!;
  const contentHash = createHash("sha256");
  for (const [filePath, bytes] of Object.entries(mapped).sort(([left], [right]) => left.localeCompare(right))) {
    contentHash.update(filePath).update(bytes);
  }
  const fileSize = Object.values(mapped).reduce((sum, file) => sum + file.byteLength, 0);
  return { files: mapped, entryPoint, fileSize, contentHash: contentHash.digest("hex") };
}
