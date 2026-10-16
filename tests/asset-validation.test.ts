import { describe, expect, it } from "vitest";
import { assetCategoryForFilename, inspectAsset } from "@/lib/asset-validation";

const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");
const triangleBytes = Buffer.alloc(36);
new Float32Array(triangleBytes.buffer, triangleBytes.byteOffset, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);

function triangleGltf(uri?: string) {
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: triangleBytes.byteLength, ...(uri ? { uri } : {}) }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: triangleBytes.byteLength, target: 34962 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
}

function expectValidationError(run: () => unknown, code: string, status: number) {
  try { run(); throw new Error("Expected asset validation to fail."); }
  catch (error) { expect(error).toMatchObject({ code, status }); }
}

function pcmWavBytes() {
  const bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8_000, 24);
  bytes.writeUInt32LE(16_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(4, 40);
  bytes.writeInt16LE(0, 44);
  bytes.writeInt16LE(0, 46);
  return new Uint8Array(bytes);
}

function opusOggBytes() {
  const opusHead = Buffer.alloc(19);
  opusHead.write("OpusHead", 0, "ascii");
  opusHead[8] = 1;
  opusHead[9] = 2;
  opusHead.writeUInt32LE(48_000, 12);
  const tags = Buffer.from("OpusTags", "ascii");
  const header = Buffer.alloc(27);
  header.write("OggS", 0, "ascii");
  header[4] = 0;
  header[5] = 0x06;
  header.writeUInt32LE(7, 14);
  header.writeUInt32LE(0, 18);
  header[26] = 2;
  const lacing = Buffer.from([opusHead.length, tags.length]);
  const body = Buffer.concat([opusHead, tags]);
  const page = Buffer.concat([header, lacing, body]);
  let crc = 0;
  for (const byte of page) {
    crc = (crc ^ (byte << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) crc = ((crc << 1) ^ (crc & 0x80000000 ? 0x04c11db7 : 0)) >>> 0;
  }
  page.writeUInt32LE(crc >>> 0, 22);
  return new Uint8Array(page);
}

function glbBytes() {
  const document = triangleGltf();
  const json = Buffer.from(JSON.stringify(document));
  const jsonPadding = (4 - (json.length % 4)) % 4;
  const paddedJson = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
  const binary = Buffer.from(triangleBytes);
  const total = 12 + 8 + paddedJson.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return new Uint8Array(Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, binary]));
}

describe("individual asset validation", () => {
  it("validates PNG structure and dimensions rather than trusting the filename", () => {
    const result = inspectAsset("forest.png", new Uint8Array(onePixelPng));
    expect(result).toMatchObject({ format: "PNG", category: "image", mimeType: "image/png", validationState: "valid_compatible" });
    expect(result.details).toMatchObject({ width: 1, height: 1, pixelCount: 1 });
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(() => inspectAsset("forest.jpg", new Uint8Array(onePixelPng))).toThrowError(/JPEG/);
  });

  it("rejects damaged image chunks and unsupported extensions", () => {
    const damaged = new Uint8Array(onePixelPng);
    damaged[damaged.length - 6] = (damaged[damaged.length - 6] ?? 0) ^ 0x01;
    expect(() => inspectAsset("broken.png", damaged)).toThrowError(/checksum/);
    expectValidationError(() => inspectAsset("vector.svg", new Uint8Array([0x3c, 0x73, 0x76, 0x67])), "ASSET_UNSUPPORTED", 415);
  });

  it("accepts self-contained glTF 2.0 and GLB triangle geometry and reports measured content", () => {
    const jsonAsset = Buffer.from(JSON.stringify(triangleGltf(`data:application/octet-stream;base64,${triangleBytes.toString("base64")}`)));
    const jsonResult = inspectAsset("triangle.gltf", new Uint8Array(jsonAsset));
    expect(jsonResult).toMatchObject({ format: "glTF 2.0", category: "model", mimeType: "model/gltf+json" });
    expect(jsonResult.details).toMatchObject({ meshes: 1, nodes: 1, accessors: 1, externalReferences: 0 });

    const binaryResult = inspectAsset("triangle.glb", glbBytes());
    expect(binaryResult).toMatchObject({ format: "GLB 2.0", category: "model", mimeType: "model/gltf-binary" });
    expect(binaryResult.details).toMatchObject({ meshes: 1, bufferViews: 1, accessors: 1, externalReferences: 0 });
  });

  it("validates PCM WAV chunk lengths, sample format, and duration", () => {
    const result = inspectAsset("tone.wav", pcmWavBytes());
    expect(result).toMatchObject({ format: "WAV", category: "audio", mimeType: "audio/wav" });
    expect(result.details).toMatchObject({ codec: "PCM", channels: 1, sampleRate: 8_000, bitsPerSample: 16, durationSeconds: 0.00025 });
    const damaged = pcmWavBytes();
    new DataView(damaged.buffer, damaged.byteOffset, damaged.byteLength).setUint32(28, 12_000, true);
    expect(() => inspectAsset("bad.wav", damaged)).toThrowError(/byte rate/i);
  });

  it("checks OGG page sequence, CRCs, and a recognized Opus identification packet", () => {
    const bytes = opusOggBytes();
    const result = inspectAsset("tone.ogg", bytes);
    expect(result).toMatchObject({ format: "OGG", category: "audio", mimeType: "audio/ogg" });
    expect(result.details).toMatchObject({ codec: "Opus", channels: 2, sampleRate: 48_000, pages: 1 });
    const damaged = new Uint8Array(bytes);
    damaged[damaged.length - 1] = (damaged[damaged.length - 1] ?? 0) ^ 0x01;
    expect(() => inspectAsset("damaged.ogg", damaged)).toThrowError(/checksum/i);
  });

  it("rejects external model resources and cyclic scene graphs", () => {
    const external = triangleGltf("https://example.invalid/mesh.bin");
    expectValidationError(() => inspectAsset("external.gltf", new Uint8Array(Buffer.from(JSON.stringify(external)))), "ASSET_EXTERNAL_REFERENCE", 400);
    const cyclic = triangleGltf(`data:application/octet-stream;base64,${triangleBytes.toString("base64")}`);
    cyclic.nodes[0].mesh = 0;
    (cyclic.nodes[0] as { children?: number[] }).children = [0];
    expect(() => inspectAsset("cycle.gltf", new Uint8Array(Buffer.from(JSON.stringify(cyclic)))))
      .toThrowError(/cycle/i);
  });

  it("normalizes path-like names but rejects unimplemented OBJ/FBX formats", () => {
    expect(assetCategoryForFilename("../../my forest/tree.glb")).toMatchObject({ filename: "tree.glb", extension: "glb", category: "model" });
    expectValidationError(() => inspectAsset("character.obj", new Uint8Array([1, 2, 3])), "ASSET_UNSUPPORTED", 415);
  });
});
