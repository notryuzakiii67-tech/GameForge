import { createHash } from "node:crypto";
import { ApiError } from "@/lib/http";

export type AssetCategory = "image" | "model" | "audio";
export type AssetInspection = {
  filename: string;
  extension: string;
  format: string;
  category: AssetCategory;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  validationState: "valid_compatible";
  details: Record<string, string | number | boolean>;
};

const DEFAULT_MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_SIDE = 16_384;
const MAX_IMAGE_PIXELS = 100_000_000;
const MAX_GLTF_COLLECTION = 5_000;
const SUPPORTED_FORMATS = "PNG, JPEG, WebP, self-contained glTF 2.0/GLB 2.0, PCM WAV, or OGG Vorbis/Opus";

function configuredLimit(name: string, fallback: number, max: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, max) : fallback;
}

export function maxAssetBytes(): number {
  return configuredLimit("MAX_ASSET_BYTES", DEFAULT_MAX_ASSET_BYTES, 50 * 1024 * 1024);
}

function invalid(message: string, code = "ASSET_INVALID"): never {
  throw new ApiError(400, code, message);
}

function supported(name: string): never {
  throw new ApiError(415, "ASSET_UNSUPPORTED", `“${name}” is not supported. Supported formats: ${SUPPORTED_FORMATS}.`);
}

export function normalizeAssetFilename(rawName: string): string {
  const lastPart = rawName.replace(/\\/g, "/").split("/").at(-1) ?? "asset";
  const normalized = lastPart.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "");
  const safe = normalized.replace(/[^\p{L}\p{N} ._()\-]/gu, "_").trim().slice(0, 120);
  return safe && safe !== "." && safe !== ".." ? safe : "asset";
}

export function assetCategoryForFilename(rawName: string): { filename: string; extension: string; category: AssetCategory } {
  const filename = normalizeAssetFilename(rawName);
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return { filename, extension, category: "image" };
  if (["glb", "gltf"].includes(extension)) return { filename, extension, category: "model" };
  if (["wav", "ogg"].includes(extension)) return { filename, extension, category: "audio" };
  return supported(filename);
}

function dimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE || width * height > MAX_IMAGE_PIXELS) {
    invalid("Image dimensions are invalid or exceed the 16,384-pixel side / 100-megapixel limit.", "ASSET_COMPLEXITY_LIMIT");
  }
}

let crcTable: Uint32Array | undefined;
function pngCrc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Uint8Array): Record<string, string | number | boolean> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 45 || !signature.every((value, index) => bytes[index] === value)) invalid("The file does not have a valid PNG signature.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const crcOffset = dataStart + length;
    if (crcOffset + 4 > bytes.length) invalid("The PNG has a truncated chunk.");
    if (!sawHeader && (type !== "IHDR" || length !== 13)) invalid("The PNG must begin with a complete IHDR chunk.");
    if (pngCrc32(bytes.subarray(offset + 4, crcOffset)) !== view.getUint32(crcOffset, false)) invalid(`The PNG ${type} chunk failed its checksum.`);
    if (type === "IHDR") {
      if (sawHeader) invalid("The PNG contains more than one image header.");
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      dimensions(width, height);
      const bitDepth = bytes[dataStart + 8] ?? 0;
      const colorType = bytes[dataStart + 9] ?? 255;
      if (![1, 2, 4, 8, 16].includes(bitDepth) || ![0, 2, 3, 4, 6].includes(colorType)) invalid("The PNG uses an unsupported color encoding.");
      sawHeader = true;
    } else if (type === "IDAT") {
      if (!sawHeader || length === 0) invalid("The PNG image-data chunk is malformed.");
      sawImageData = true;
    } else if (type === "IEND") {
      if (length !== 0 || !sawImageData) invalid("The PNG is missing image data or has a malformed end chunk.");
      sawEnd = true;
      offset = crcOffset + 4;
      break;
    }
    offset = crcOffset + 4;
  }
  if (!sawHeader || !sawImageData || !sawEnd || offset !== bytes.length) invalid("The PNG file is incomplete or contains trailing data.");
  return { width, height, pixelCount: width * height, checks: "PNG chunk boundaries and CRCs" };
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function inspectJpeg(bytes: Uint8Array): Record<string, string | number | boolean> {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) invalid("The file does not have a complete JPEG signature and end marker.");
  let offset = 2;
  let width = 0;
  let height = 0;
  let sawFrame = false;
  let sawScan = false;
  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) invalid("The JPEG marker stream is malformed.");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined) break;
    if (marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) invalid("The JPEG marker is truncated.");
    const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) invalid("The JPEG contains a truncated segment.");
    if (marker !== undefined && JPEG_SOF.has(marker)) {
      if (segmentLength < 8) invalid("The JPEG frame header is incomplete.");
      height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0);
      width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      dimensions(width, height);
      sawFrame = true;
    }
    offset += segmentLength;
    if (marker === 0xda) { sawScan = true; break; }
  }
  if (!sawFrame || !sawScan) invalid("The JPEG is missing a frame or image scan.");
  return { width, height, pixelCount: width * height, checks: "JPEG marker structure and dimensions" };
}

function inspectWebp(bytes: Uint8Array): Record<string, string | number | boolean> {
  if (bytes.length < 30 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WEBP") invalid("The file does not have a valid WebP container signature.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) + 8 !== bytes.length) invalid("The WebP container length does not match the file size.");
  let offset = 12;
  let width = 0;
  let height = 0;
  while (offset + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length + (length & 1) > bytes.length) invalid("The WebP contains a truncated chunk.");
    if (type === "VP8X" && length >= 10) {
      width = 1 + (bytes[start + 4] ?? 0) + ((bytes[start + 5] ?? 0) << 8) + ((bytes[start + 6] ?? 0) << 16);
      height = 1 + (bytes[start + 7] ?? 0) + ((bytes[start + 8] ?? 0) << 8) + ((bytes[start + 9] ?? 0) << 16);
    } else if (type === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
      const b1 = bytes[start + 1] ?? 0; const b2 = bytes[start + 2] ?? 0; const b3 = bytes[start + 3] ?? 0; const b4 = bytes[start + 4] ?? 0;
      width = 1 + (((b2 & 0x3f) << 8) | b1);
      height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    } else if (type === "VP8 " && length >= 10 && bytes[start + 3] === 0x9d && bytes[start + 4] === 0x01 && bytes[start + 5] === 0x2a) {
      width = (view.getUint16(start + 6, true) & 0x3fff);
      height = (view.getUint16(start + 8, true) & 0x3fff);
    }
    if (width && height) break;
    offset = start + length + (length & 1);
  }
  if (!width || !height) invalid("The WebP does not contain a supported VP8/VP8L image frame.");
  dimensions(width, height);
  return { width, height, pixelCount: width * height, checks: "RIFF/WebP chunk structure and dimensions" };
}

function inspectWav(bytes: Uint8Array): Record<string, string | number | boolean> {
  if (bytes.length < 44 || String.fromCharCode(...bytes.subarray(0, 4)) !== "RIFF" || String.fromCharCode(...bytes.subarray(8, 12)) !== "WAVE") invalid("The file does not have a valid RIFF/WAVE header.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = view.getUint32(4, true) + 8;
  if (riffEnd !== bytes.length) invalid("The WAV RIFF length does not match the uploaded file size.");
  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let blockAlign = 0;
  let byteRate = 0;
  let dataBytes = 0;
  let formatChunks = 0;
  while (offset + 8 <= riffEnd) {
    const type = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const nextOffset = start + length + (length & 1);
    if (nextOffset > riffEnd) invalid("The WAV contains a truncated chunk.");
    if (type === "fmt ") {
      formatChunks += 1;
      if (formatChunks > 1 || length < 16) invalid("The WAV format chunk is duplicated or incomplete.");
      format = view.getUint16(start, true);
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
      byteRate = view.getUint32(start + 8, true);
      blockAlign = view.getUint16(start + 12, true);
      bitsPerSample = view.getUint16(start + 14, true);
    } else if (type === "data") {
      dataBytes += length;
    }
    offset = nextOffset;
  }
  if (offset !== riffEnd || formatChunks !== 1 || ![1, 3].includes(format) || channels < 1 || channels > 8 || sampleRate < 8_000 || sampleRate > 192_000 ||
      (format === 1 && ![8, 16, 24, 32].includes(bitsPerSample)) || (format === 3 && ![32, 64].includes(bitsPerSample)) || dataBytes <= 0) {
    invalid("Only PCM or IEEE-float WAV audio with a valid format and data chunk is supported.");
  }
  const expectedBlockAlign = channels * bitsPerSample / 8;
  if (blockAlign !== expectedBlockAlign || byteRate !== sampleRate * blockAlign || dataBytes % blockAlign !== 0) invalid("The WAV byte rate, block alignment, or sample data length is inconsistent.");
  const durationSeconds = dataBytes / byteRate;
  return { codec: format === 1 ? "PCM" : "IEEE float", channels, sampleRate, bitsPerSample, audioBytes: dataBytes, durationSeconds, checks: "RIFF/WAVE chunk structure and PCM format" };
}

function oggPageCrc(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0;
  for (let index = start; index < end; index += 1) {
    const byte = index >= start + 22 && index < start + 26 ? 0 : bytes[index] ?? 0;
    crc = (crc ^ (byte << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) crc = ((crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0)) >>> 0;
  }
  return crc >>> 0;
}

function inspectOgg(bytes: Uint8Array): Record<string, string | number | boolean> {
  if (bytes.length < 27) invalid("The OGG file is incomplete.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let pages = 0;
  let serial: number | null = null;
  let expectedSequence = 0;
  let ended = false;
  const firstPacket = new Uint8Array(Math.min(bytes.length, 64 * 1024));
  let packetBytes = 0;
  let firstPacketLength = 0;
  let firstPacketComplete = false;
  let channels = 0;
  let sampleRate = 0;
  while (offset < bytes.length) {
    if (offset + 27 > bytes.length || String.fromCharCode(...bytes.subarray(offset, offset + 4)) !== "OggS" || bytes[offset + 4] !== 0) invalid("The OGG page header is malformed.");
    const pageFlags = bytes[offset + 5] ?? 0;
    if (pageFlags & 0xf8) invalid("The OGG page contains unsupported header flags.");
    const pageSerial = view.getUint32(offset + 14, true);
    const sequence = view.getUint32(offset + 18, true);
    if (serial === null) {
      serial = pageSerial;
      if (!(pageFlags & 0x02) || sequence !== 0) invalid("The OGG stream does not begin with a valid BOS page.");
    } else if (pageSerial !== serial || sequence !== expectedSequence || ended) invalid("The OGG page sequence or stream serial is inconsistent.");
    expectedSequence = sequence + 1;
    const segmentCount = bytes[offset + 26] ?? 0;
    const tableStart = offset + 27;
    if (tableStart + segmentCount > bytes.length) invalid("The OGG segment table is truncated.");
    let bodyLength = 0;
    for (let index = 0; index < segmentCount; index += 1) bodyLength += bytes[tableStart + index] ?? 0;
    const bodyStart = tableStart + segmentCount;
    const pageEnd = bodyStart + bodyLength;
    if (pageEnd > bytes.length) invalid("The OGG page body is truncated.");
    if (oggPageCrc(bytes, offset, pageEnd) !== view.getUint32(offset + 22, true)) invalid("An OGG page failed its checksum.");
    let segmentOffset = bodyStart;
    for (let index = 0; index < segmentCount; index += 1) {
      const segmentLength = bytes[tableStart + index] ?? 0;
      if (!firstPacketComplete) {
        const copyLength = Math.min(segmentLength, firstPacket.length - packetBytes);
        if (copyLength > 0) firstPacket.set(bytes.subarray(segmentOffset, segmentOffset + copyLength), packetBytes);
        packetBytes += copyLength;
        firstPacketLength += segmentLength;
        if (segmentLength < 255) firstPacketComplete = true;
      }
      segmentOffset += segmentLength;
    }
    ended = Boolean(pageFlags & 0x04);
    pages += 1;
    offset = pageEnd;
  }
  const packet = firstPacket.subarray(0, packetBytes);
  const signature = new TextDecoder().decode(packet.subarray(0, Math.min(packet.length, 8)));
  const packetView = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  let codec = "";
  if (signature === "OpusHead") {
    if (!firstPacketComplete || firstPacketLength < 19 || packet[8] === undefined || packet[8]! > 15 || !packet[9]) invalid("The OGG Opus identification header is incomplete or invalid.");
    channels = packet[9] ?? 0;
    const mappingFamily = packet[18] ?? 0;
    if ((mappingFamily === 0 && (channels > 2 || firstPacketLength !== 19)) || (mappingFamily !== 0 && firstPacketLength < 21 + channels)) invalid("The OGG Opus channel mapping is invalid.");
    const inputRate = packetView.getUint32(12, true);
    sampleRate = inputRate || 48_000;
    codec = "Opus";
  } else if (packet[0] === 1 && new TextDecoder().decode(packet.subarray(1, 7)) === "vorbis") {
    if (!firstPacketComplete || firstPacketLength !== 30 || packetView.getUint32(7, true) !== 0 || !packet[11] || !(packet[29]! & 1)) invalid("The OGG Vorbis identification header is incomplete or invalid.");
    channels = packet[11] ?? 0;
    sampleRate = packetView.getUint32(12, true);
    if (!sampleRate) invalid("The OGG Vorbis sample rate is invalid.");
    codec = "Vorbis";
  }
  if (!pages || !ended || !firstPacketComplete || !codec) invalid("The OGG stream is incomplete, malformed, or not Vorbis/Opus audio.");
  return { codec, channels, sampleRate, pages, checks: "Ogg page sequence, CRC checksums, and codec identification packet" };
}

function readDataUri(uri: string, allowedMime: string[]): { mimeType: string; bytes: Uint8Array } {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:") || comma < 0) invalid("Only embedded base64 data is supported for glTF resources.", "ASSET_EXTERNAL_REFERENCE");
  const header = uri.slice(5, comma);
  const mimeType = header.split(";")[0]?.toLowerCase() ?? "";
  if (!/;base64$/i.test(header) || !allowedMime.includes(mimeType)) invalid("The glTF embeds a resource with an unsupported MIME type.", "ASSET_EXTERNAL_REFERENCE");
  const base64 = uri.slice(comma + 1);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) invalid("A glTF embedded resource has malformed base64 data.");
  const decoded = Buffer.from(base64, "base64");
  if (decoded.toString("base64") !== base64) invalid("A glTF embedded resource has non-canonical base64 data.");
  return { mimeType, bytes: new Uint8Array(decoded) };
}

function validateEmbeddedImage(mimeType: string, bytes: Uint8Array): void {
  if (mimeType === "image/png") inspectPng(bytes);
  else if (mimeType === "image/jpeg") inspectJpeg(bytes);
  else if (mimeType === "image/webp") inspectWebp(bytes);
  else invalid("Only embedded PNG, JPEG, and WebP textures are supported.");
}

function arrayField(document: Record<string, unknown>, field: string): unknown[] {
  const value = document[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_GLTF_COLLECTION) invalid(`The glTF ${field} collection is invalid or too large.`, "ASSET_COMPLEXITY_LIMIT");
  return value;
}

function validateGltfDocument(document: unknown, isBinaryGlb: boolean, binaryChunk: Uint8Array | null): Record<string, string | number | boolean> {
  if (!document || typeof document !== "object" || Array.isArray(document)) invalid("The glTF root must be a JSON object.");
  const gltf = document as Record<string, unknown>;
  const asset = gltf.asset;
  if (!asset || typeof asset !== "object" || (asset as Record<string, unknown>).version !== "2.0") invalid("Only glTF 2.0 assets are supported.");

  function checkUris(value: unknown, depth = 0): void {
    if (depth > 64) invalid("The glTF JSON nesting is too deep.", "ASSET_COMPLEXITY_LIMIT");
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key.toLowerCase() === "uri" && typeof child === "string" && !child.startsWith("data:")) {
        invalid("External model, texture, or buffer URLs are not allowed. Embed resources in the uploaded glTF/GLB.", "ASSET_EXTERNAL_REFERENCE");
      }
      checkUris(child, depth + 1);
    }
  }
  checkUris(gltf);

  const buffers = arrayField(gltf, "buffers");
  const bufferLengths: number[] = [];
  const bufferContents: Uint8Array[] = [];
  const bufferViews = arrayField(gltf, "bufferViews");
  const accessors = arrayField(gltf, "accessors");
  const meshes = arrayField(gltf, "meshes");
  const nodes = arrayField(gltf, "nodes");
  const materials = arrayField(gltf, "materials");
  const images = arrayField(gltf, "images");
  const textures = arrayField(gltf, "textures");
  const animations = arrayField(gltf, "animations");
  if (meshes.length === 0) invalid("The glTF does not contain any mesh geometry.");
  if (buffers.length === 0) invalid("The model must contain at least one embedded geometry buffer.", "ASSET_EXTERNAL_REFERENCE");
  if (nodes.length === 0 || !nodes.some((node) => node && typeof node === "object" && (node as Record<string, unknown>).mesh !== undefined)) invalid("The model has no scene node that references mesh geometry.");
  if (isBinaryGlb && buffers.length > 1) invalid("A GLB may contain only its single embedded binary buffer.");
  if (isBinaryGlb && buffers.length === 0 && binaryChunk?.length) invalid("The GLB binary chunk is not referenced by its JSON document.");
  if (!isBinaryGlb && buffers.length === 0 && bufferViews.length) invalid("The glTF has buffer views without a buffer.");

  for (let index = 0; index < buffers.length; index += 1) {
    const buffer = buffers[index];
    if (!buffer || typeof buffer !== "object") invalid("A glTF buffer record is malformed.");
    const record = buffer as Record<string, unknown>;
    const declared = Number(record.byteLength);
    if (!Number.isSafeInteger(declared) || declared < 1 || declared > maxAssetBytes()) invalid("A glTF buffer has an invalid or excessive byte length.", "ASSET_COMPLEXITY_LIMIT");
    let embeddedBytes: Uint8Array | null = null;
    if (typeof record.uri === "string") {
      embeddedBytes = readDataUri(record.uri, ["application/octet-stream", "application/gltf-buffer"]).bytes;
    } else if (isBinaryGlb && index === 0 && binaryChunk) {
      embeddedBytes = binaryChunk;
    } else {
      invalid("Every glTF buffer must be embedded in the uploaded file.", "ASSET_EXTERNAL_REFERENCE");
    }
    const available = embeddedBytes?.byteLength ?? 0;
    if (available < declared || (isBinaryGlb ? available - declared > 3 : available !== declared)) invalid("A glTF buffer length does not match its embedded data.");
    bufferLengths.push(declared);
    bufferContents.push(embeddedBytes!.subarray(0, declared));
  }

  for (const view of bufferViews) {
    if (!view || typeof view !== "object") invalid("A glTF buffer view is malformed.");
    const record = view as Record<string, unknown>;
    const bufferIndex = Number(record.buffer);
    const length = Number(record.byteLength);
    const start = Number(record.byteOffset ?? 0);
    if (!Number.isInteger(bufferIndex) || bufferIndex < 0 || bufferIndex >= bufferLengths.length || !Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(start) || start < 0 || start + length > (bufferLengths[bufferIndex] ?? 0)) invalid("A glTF buffer view exceeds its embedded buffer.");
  }

  let accessorComponents = 0;
  const typeComponents: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const componentBytes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  for (const accessor of accessors) {
    if (!accessor || typeof accessor !== "object") invalid("A glTF accessor is malformed.");
    const record = accessor as Record<string, unknown>;
    const count = Number(record.count);
    const accessorType = String(record.type);
    const components = typeComponents[accessorType] ?? 0;
    const bytesPerComponent = componentBytes[Number(record.componentType)] ?? 0;
    if (!Number.isSafeInteger(count) || count < 1 || count > 10_000_000 || !components || !bytesPerComponent) invalid("A glTF accessor has an unsupported or excessive shape.", "ASSET_COMPLEXITY_LIMIT");
    accessorComponents += count * components;
    if (accessorComponents > 25_000_000) invalid("The model’s combined accessor data is too complex for browser preview.", "ASSET_COMPLEXITY_LIMIT");
    if (record.sparse !== undefined) invalid("Sparse glTF accessors are not supported in this preview path.", "ASSET_NEEDS_CONVERSION");
    const viewIndex = Number(record.bufferView);
    if (!Number.isInteger(viewIndex) || viewIndex < 0 || viewIndex >= bufferViews.length) invalid("A glTF accessor references a missing buffer view.");
    const view = bufferViews[viewIndex] as Record<string, unknown>;
    const viewLength = Number(view.byteLength);
    const accessorOffset = Number(record.byteOffset ?? 0);
    const matrixDimension = accessorType === "MAT2" ? 2 : accessorType === "MAT3" ? 3 : accessorType === "MAT4" ? 4 : 0;
    const elementBytes = matrixDimension
      ? matrixDimension * Math.ceil((matrixDimension * bytesPerComponent) / 4) * 4
      : components * bytesPerComponent;
    const stride = Number(view.byteStride ?? elementBytes);
    const requiredBytes = accessorOffset + (count - 1) * stride + elementBytes;
    if (!Number.isSafeInteger(accessorOffset) || accessorOffset < 0 || accessorOffset % bytesPerComponent !== 0 || !Number.isSafeInteger(stride) || stride < elementBytes || stride > 252 || (view.byteStride !== undefined && stride % 4 !== 0) || !Number.isSafeInteger(requiredBytes) || requiredBytes > viewLength) invalid("A glTF accessor exceeds or is misaligned within its embedded buffer view.");
  }

  let primitiveCount = 0;
  for (const mesh of meshes) {
    if (!mesh || typeof mesh !== "object") invalid("A glTF mesh record is malformed.");
    const primitives = (mesh as Record<string, unknown>).primitives;
    if (!Array.isArray(primitives) || primitives.length < 1 || primitives.length > 1_000) invalid("A glTF mesh has an invalid primitive list.", "ASSET_COMPLEXITY_LIMIT");
    primitiveCount += primitives.length;
    if (primitiveCount > 5_000) invalid("The model has too many draw primitives for browser preview.", "ASSET_COMPLEXITY_LIMIT");
    for (const primitive of primitives) {
      if (!primitive || typeof primitive !== "object") invalid("A glTF primitive is malformed.");
      const record = primitive as Record<string, unknown>;
      const attributes = record.attributes;
      if (!attributes || typeof attributes !== "object" || Array.isArray(attributes)) invalid("A glTF primitive has no valid attributes.");
      for (const accessorIndex of Object.values(attributes as Record<string, unknown>)) {
        if (!Number.isInteger(accessorIndex) || Number(accessorIndex) < 0 || Number(accessorIndex) >= accessors.length) invalid("A glTF primitive references a missing accessor.");
      }
      if (record.indices !== undefined && (!Number.isInteger(record.indices) || Number(record.indices) < 0 || Number(record.indices) >= accessors.length)) invalid("A glTF primitive references missing indices.");
      if (record.material !== undefined && (!Number.isInteger(record.material) || Number(record.material) < 0 || Number(record.material) >= materials.length)) invalid("A glTF primitive references a missing material.");
      if (record.mode !== undefined && (!Number.isInteger(record.mode) || Number(record.mode) < 0 || Number(record.mode) > 6)) invalid("A glTF primitive has an invalid mode.");
    }
  }

  const nodeChildren: number[][] = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") invalid("A glTF node record is malformed.");
    const record = node as Record<string, unknown>;
    const children = record.children;
    if (children !== undefined && (!Array.isArray(children) || children.some((child) => !Number.isInteger(child) || Number(child) < 0 || Number(child) >= nodes.length))) invalid("A glTF node references an invalid child.");
    if (record.mesh !== undefined && (!Number.isInteger(record.mesh) || Number(record.mesh) < 0 || Number(record.mesh) >= meshes.length)) invalid("A glTF node references a missing mesh.");
    nodeChildren.push((children as number[] | undefined) ?? []);
  }
  const nodeState = new Uint8Array(nodes.length);
  for (let start = 0; start < nodes.length; start += 1) {
    if (nodeState[start] !== 0) continue;
    const stack: Array<{ node: number; childIndex: number }> = [{ node: start, childIndex: 0 }];
    nodeState[start] = 1;
    while (stack.length) {
      const current = stack[stack.length - 1]!;
      const children = nodeChildren[current.node] ?? [];
      if (current.childIndex >= children.length) { nodeState[current.node] = 2; stack.pop(); continue; }
      const child = children[current.childIndex]!;
      current.childIndex += 1;
      if (nodeState[child] === 1) invalid("The glTF node hierarchy contains a cycle.");
      if (nodeState[child] === 0) { nodeState[child] = 1; stack.push({ node: child, childIndex: 0 }); }
    }
  }

  const scenes = arrayField(gltf, "scenes");
  for (const scene of scenes) {
    if (!scene || typeof scene !== "object") invalid("A glTF scene record is malformed.");
    const sceneNodes = (scene as Record<string, unknown>).nodes;
    if (sceneNodes !== undefined && (!Array.isArray(sceneNodes) || sceneNodes.some((node) => !Number.isInteger(node) || Number(node) < 0 || Number(node) >= nodes.length))) invalid("A glTF scene references an invalid root node.");
  }
  if (gltf.scene !== undefined && (!Number.isInteger(gltf.scene) || Number(gltf.scene) < 0 || Number(gltf.scene) >= scenes.length)) invalid("The glTF default scene is invalid.");

  for (const image of images) {
    if (!image || typeof image !== "object") invalid("A glTF image record is malformed.");
    const record = image as Record<string, unknown>;
    if (typeof record.uri === "string") {
      const embedded = readDataUri(record.uri, ["image/png", "image/jpeg", "image/webp"]);
      validateEmbeddedImage(embedded.mimeType, embedded.bytes);
    } else if (record.bufferView !== undefined) {
      const viewIndex = Number(record.bufferView);
      if (!Number.isInteger(viewIndex) || viewIndex < 0 || viewIndex >= bufferViews.length || !["image/png", "image/jpeg", "image/webp"].includes(String(record.mimeType))) invalid("A glTF embedded image buffer view is invalid.");
      const view = bufferViews[viewIndex] as Record<string, unknown>;
      const bufferIndex = Number(view.buffer);
      const start = Number(view.byteOffset ?? 0);
      const length = Number(view.byteLength);
      const imageBytes = bufferContents[bufferIndex]?.subarray(start, start + length);
      if (!imageBytes?.length) invalid("A glTF embedded texture has no data.");
      validateEmbeddedImage(String(record.mimeType), imageBytes);
    } else invalid("A glTF image must be embedded in a data URI or buffer view.", "ASSET_EXTERNAL_REFERENCE");
  }
  for (const texture of textures) {
    if (!texture || typeof texture !== "object") invalid("A glTF texture record is malformed.");
    const source = (texture as Record<string, unknown>).source;
    if (source !== undefined && (!Number.isInteger(source) || Number(source) < 0 || Number(source) >= images.length)) invalid("A glTF texture references a missing image.");
  }

  const extensions = [...arrayField(gltf, "extensionsUsed"), ...arrayField(gltf, "extensionsRequired")].filter((entry): entry is string => typeof entry === "string");
  const unsupportedExtensions = extensions.filter((entry) => /draco|meshopt|quantized/i.test(entry));
  if (unsupportedExtensions.length) invalid("The model uses compressed geometry that GameForge cannot safely decode yet.", "ASSET_NEEDS_CONVERSION");

  return {
    meshes: meshes.length,
    nodes: nodes.length,
    materials: materials.length,
    textures: textures.length,
    embeddedImages: images.length,
    animations: animations.length,
    bufferViews: bufferViews.length,
    accessors: accessors.length,
    externalReferences: 0,
    checks: isBinaryGlb ? "GLB header/chunks, glTF 2.0 JSON, embedded buffers, and references" : "glTF 2.0 JSON, data-URI buffers/images, and references",
  };
}

function inspectGltf(bytes: Uint8Array, binary: boolean): Record<string, string | number | boolean> {
  let documentText = "";
  let binaryChunk: Uint8Array | null = null;
  if (binary) {
    if (bytes.length < 20) invalid("The GLB file is too short to contain a header and JSON chunk.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) invalid("The GLB header, version, or declared length is invalid.");
    let offset = 12;
    let jsonChunks = 0;
    while (offset + 8 <= bytes.length) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      const chunkStart = offset + 8;
      if (chunkLength % 4 !== 0 || chunkStart + chunkLength > bytes.length) invalid("The GLB contains a malformed chunk.");
      if (offset === 12 && chunkType !== 0x4e4f534a) invalid("The GLB JSON chunk must appear first.");
      if (chunkType === 0x004e4942 && jsonChunks !== 1) invalid("The GLB binary chunk must appear after its JSON chunk.");
      const chunk = bytes.subarray(chunkStart, chunkStart + chunkLength);
      if (chunkType === 0x4e4f534a) {
        jsonChunks += 1;
        if (jsonChunks > 1) invalid("The GLB contains multiple JSON chunks.");
        try { documentText = new TextDecoder("utf-8", { fatal: true }).decode(chunk).replace(/[\u0000\u0020]+$/g, ""); }
        catch { return invalid("The GLB JSON chunk is not valid UTF-8."); }
      } else if (chunkType === 0x004e4942) {
        if (binaryChunk) invalid("The GLB contains more than one binary chunk.");
        binaryChunk = chunk;
      } else invalid("The GLB contains an unsupported chunk type.");
      offset = chunkStart + chunkLength;
    }
    if (offset !== bytes.length || jsonChunks !== 1 || !documentText) invalid("The GLB JSON chunk is missing or incomplete.");
  } else {
    if (bytes.length === 0 || bytes[0] !== 0x7b) invalid("The glTF file must be UTF-8 JSON.");
    try { documentText = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return invalid("The glTF JSON is not valid UTF-8."); }
  }
  let document: unknown;
  try { document = JSON.parse(documentText); }
  catch { return invalid("The glTF JSON is malformed."); }
  return validateGltfDocument(document, binary, binaryChunk);
}

export function inspectAsset(rawFilename: string, bytes: Uint8Array): AssetInspection {
  const { filename, extension, category: expectedCategory } = assetCategoryForFilename(rawFilename);
  if (!bytes.byteLength) invalid("The uploaded asset is empty.");
  if (bytes.byteLength > maxAssetBytes()) throw new ApiError(413, "ASSET_TOO_LARGE", `Individual assets are limited to ${Math.floor(maxAssetBytes() / 1024 / 1024)} MiB.`);

  let category: AssetCategory;
  let format: string;
  let mimeType: string;
  let details: Record<string, string | number | boolean>;
  if (extension === "png") { category = "image"; format = "PNG"; mimeType = "image/png"; details = inspectPng(bytes); }
  else if (extension === "jpg" || extension === "jpeg") { category = "image"; format = "JPEG"; mimeType = "image/jpeg"; details = inspectJpeg(bytes); }
  else if (extension === "webp") { category = "image"; format = "WebP"; mimeType = "image/webp"; details = inspectWebp(bytes); }
  else if (extension === "glb" || extension === "gltf") { category = "model"; format = extension === "glb" ? "GLB 2.0" : "glTF 2.0"; mimeType = extension === "glb" ? "model/gltf-binary" : "model/gltf+json"; details = inspectGltf(bytes, extension === "glb"); }
  else if (extension === "wav") { category = "audio"; format = "WAV"; mimeType = "audio/wav"; details = inspectWav(bytes); }
  else { category = "audio"; format = "OGG"; mimeType = "audio/ogg"; details = inspectOgg(bytes); }
  if (category !== expectedCategory) invalid("The detected asset type does not match its supported file extension.");

  return {
    filename,
    extension,
    format,
    category,
    mimeType,
    sizeBytes: bytes.byteLength,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    validationState: "valid_compatible",
    details,
  };
}

export function assetFormatHelp(): string {
  return SUPPORTED_FORMATS;
}
