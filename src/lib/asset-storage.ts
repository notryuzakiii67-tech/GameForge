import "server-only";
import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { unlink, stat } from "node:fs/promises";
import { ApiError } from "@/lib/http";
import { isLocalStorage, localStoragePathForKey, s3ClientForAssetStorage, s3BucketForAssetStorage } from "@/lib/storage";
import { safeProjectPath } from "@/lib/zip";

const PRIVATE_CACHE = "private, no-store, max-age=0";

export async function createPrivateAssetUploadUrl(storageKey: string, expectedBytes: number): Promise<{ url: string; expiresInSeconds: number; fields: Record<string, string> }> {
  const safeKey = safeProjectPath(storageKey);
  if (isLocalStorage()) throw new ApiError(409, "LOCAL_STORAGE_UPLOAD", "Local development uses the GameForge upload endpoint, not a direct S3 URL.");
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) throw new ApiError(400, "INVALID_ASSET_SIZE", "Choose a non-empty asset file.");
  const result = await createPresignedPost(s3ClientForAssetStorage(), {
    Bucket: s3BucketForAssetStorage(),
    Key: safeKey,
    Expires: 300,
    Fields: { "Cache-Control": PRIVATE_CACHE, "Content-Type": "application/octet-stream" },
    Conditions: [
      ["content-length-range", expectedBytes, expectedBytes],
      { "Cache-Control": PRIVATE_CACHE },
      { "Content-Type": "application/octet-stream" },
    ],
  });
  return { url: result.url, expiresInSeconds: 300, fields: result.fields };
}

export async function getPrivateAssetObjectSize(storageKey: string): Promise<number> {
  const safeKey = safeProjectPath(storageKey);
  if (isLocalStorage()) {
    try { return (await stat(localStoragePathForKey(safeKey))).size; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ApiError(404, "ASSET_UPLOAD_MISSING", "The uploaded asset could not be found.");
      throw error;
    }
  }
  try {
    const result = await s3ClientForAssetStorage().send(new HeadObjectCommand({ Bucket: s3BucketForAssetStorage(), Key: safeKey }));
    return Number(result.ContentLength ?? 0);
  } catch (error) {
    if (error && typeof error === "object" && "name" in error && error.name === "NotFound") throw new ApiError(404, "ASSET_UPLOAD_MISSING", "The uploaded asset could not be found.");
    throw error;
  }
}

export async function deletePrivateAssetObject(storageKey: string): Promise<void> {
  const safeKey = safeProjectPath(storageKey);
  if (isLocalStorage()) {
    try { await unlink(localStoragePathForKey(safeKey)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }
  await s3ClientForAssetStorage().send(new DeleteObjectCommand({ Bucket: s3BucketForAssetStorage(), Key: safeKey }));
}
