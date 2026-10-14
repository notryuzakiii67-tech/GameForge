import { describe, expect, it, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { zipSync } from "fflate";
import { validateAiProject } from "@/lib/ai/validate";
import { ApiError } from "@/lib/http";
import { gameUploadLimit, safeProjectPath, validateAiFiles, validateGameZip } from "@/lib/zip";

const previousUploadLimit = process.env.MAX_UPLOAD_BYTES;
const previousExpandedLimit = process.env.MAX_EXPANDED_BYTES;

afterEach(() => {
  if (previousUploadLimit === undefined) delete process.env.MAX_UPLOAD_BYTES; else process.env.MAX_UPLOAD_BYTES = previousUploadLimit;
  if (previousExpandedLimit === undefined) delete process.env.MAX_EXPANDED_BYTES; else process.env.MAX_EXPANDED_BYTES = previousExpandedLimit;
});

function archive(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, new TextEncoder().encode(content)])), { level: 6 });
}

function expectApiError(run: () => unknown, code: string) {
  try { run(); } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code} error`);
}

describe("uploaded game archives", () => {
  it("accepts a small browser build and records its entry point and digest", () => {
    const result = validateGameZip(archive({ "index.html": "<!doctype html><html><body><canvas></canvas></body></html>", "game.js": "console.log('play');" }));
    expect(result.entryPoint).toBe("index.html");
    expect(result.files["game.js"]).toBeInstanceOf(Uint8Array);
    expect(result.fileSize).toBeGreaterThan(0);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects invalid zip data and builds without an entry point", () => {
    expectApiError(() => validateGameZip(new Uint8Array([1, 2, 3, 4])), "INVALID_ARCHIVE");
    expectApiError(() => validateGameZip(archive({ "game.js": "console.log('no html');" })), "ENTRY_POINT_MISSING");
  });

  it("rejects path traversal and disallowed executable file types before extraction", () => {
    expectApiError(() => validateGameZip(archive({ "../outside.js": "x", "index.html": "<html></html>" })), "UNSAFE_PATH");
    expectApiError(() => validateGameZip(archive({ "index.html": "<html></html>", "payload.exe": "not a game" })), "DISALLOWED_FILE_TYPE");
  });

  it("falls back to a safe upload cap when the environment setting is invalid", () => {
    process.env.MAX_UPLOAD_BYTES = "not-a-number";
    expect(gameUploadLimit()).toBe(4 * 1024 * 1024);
  });

  it("enforces compressed upload and uncompressed size budgets", () => {
    process.env.MAX_UPLOAD_BYTES = "1024";
    expectApiError(() => validateGameZip(archive({ "index.html": randomBytes(2000).toString("base64") })), "UPLOAD_TOO_LARGE");
    process.env.MAX_UPLOAD_BYTES = "4194304";
    process.env.MAX_EXPANDED_BYTES = "2048";
    expectApiError(() => validateGameZip(archive({ "index.html": "x".repeat(4096) })), "ARCHIVE_LIMIT_EXCEEDED");
  });

  it("rejects hidden and absolute paths", () => {
    expectApiError(() => safeProjectPath("/tmp/index.html"), "UNSAFE_PATH");
    expectApiError(() => safeProjectPath(".env"), "UNSAFE_PATH");
    expectApiError(() => safeProjectPath("assets/../index.html"), "UNSAFE_PATH");
  });
});

describe("AI project validation", () => {
  it("accepts a self-contained playable project", () => {
    const files = validateAiProject([{ path: "index.html", content: "<!doctype html><html><body><button>Play</button><script>document.querySelector('button').onclick=()=>{};</script></body></html>" }]);
    expect(files).toHaveLength(1);
  });

  it("validates path, type, external resource, entry point, and JavaScript syntax", () => {
    expectApiError(() => validateAiFiles([{ path: "../../secrets.js", content: "" }]), "UNSAFE_PATH");
    expectApiError(() => validateAiFiles([{ path: "index.html", content: "<html></html>" }, { path: "server.sh", content: "echo nope" }]), "DISALLOWED_FILE_TYPE");
    expectApiError(() => validateAiProject([{ path: "index.html", content: '<html><script src="https://example.com/game.js"></script></html>' }]), "EXTERNAL_CODE_REJECTED");
    expectApiError(() => validateAiProject([{ path: "index.html", content: '<html><img src="https://example.com/image.png"></html>' }]), "EXTERNAL_RESOURCE_REJECTED");
    expectApiError(() => validateAiProject([{ path: "index.html", content: "<html><script>function broken( {</script></html>" }]), "GENERATED_SYNTAX_ERROR");
    expectApiError(() => validateAiFiles([{ path: "style.css", content: "body{}" }]), "ENTRY_POINT_MISSING");
  });
});
