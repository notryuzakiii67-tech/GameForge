import { afterEach, describe, expect, it, vi } from "vitest";

const presign = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@aws-sdk/s3-presigned-post", () => ({ createPresignedPost: presign }));

import { createPrivateAssetUploadUrl } from "@/lib/asset-storage";

const mutableEnv = process.env as unknown as Record<string, string | undefined>;
const oldEnv = Object.fromEntries(["NODE_ENV", "S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT"].map((name) => [name, mutableEnv[name]]));

afterEach(() => {
  vi.clearAllMocks();
  for (const [name, value] of Object.entries(oldEnv)) {
    if (value === undefined) delete mutableEnv[name]; else mutableEnv[name] = value;
  }
});

describe("private S3 upload signing", () => {
  it("uses an exact-size presigned POST policy with private cache metadata", async () => {
    mutableEnv.NODE_ENV = "test";
    mutableEnv.S3_BUCKET = "gameforge-private-assets";
    mutableEnv.S3_REGION = "us-east-1";
    mutableEnv.S3_ACCESS_KEY_ID = "test-access-key";
    mutableEnv.S3_SECRET_ACCESS_KEY = "test-secret-key";
    presign.mockResolvedValue({ url: "https://storage.invalid/upload", fields: { key: "assets/private/test" } });

    const result = await createPrivateAssetUploadUrl("assets/private/user/asset", 12_345);
    expect(result).toMatchObject({ url: "https://storage.invalid/upload", expiresInSeconds: 300, fields: { key: "assets/private/test" } });
    const options = presign.mock.calls[0]?.[1] as { Bucket: string; Key: string; Expires: number; Fields: Record<string, string>; Conditions: unknown[] };
    expect(options).toMatchObject({
      Bucket: "gameforge-private-assets",
      Key: "assets/private/user/asset",
      Expires: 300,
      Fields: { "Cache-Control": "private, no-store, max-age=0", "Content-Type": "application/octet-stream" },
    });
    expect(options.Conditions).toContainEqual(["content-length-range", 12_345, 12_345]);
    expect(options.Conditions).toContainEqual({ "Cache-Control": "private, no-store, max-age=0" });
    expect(options.Conditions).toContainEqual({ "Content-Type": "application/octet-stream" });
  });

  it("rejects unsafe storage keys without requesting a signature", async () => {
    mutableEnv.NODE_ENV = "test";
    mutableEnv.S3_BUCKET = "gameforge-private-assets";
    mutableEnv.S3_REGION = "us-east-1";
    mutableEnv.S3_ACCESS_KEY_ID = "test-access-key";
    mutableEnv.S3_SECRET_ACCESS_KEY = "test-secret-key";
    await expect(createPrivateAssetUploadUrl("assets/private/../public/file", 10)).rejects.toMatchObject({ code: "UNSAFE_PATH", status: 400 });
    expect(presign).not.toHaveBeenCalled();
  });
});
