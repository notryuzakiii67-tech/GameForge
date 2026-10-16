export type AssetUsageGuide = { purpose: string; notes: string; snippet: string };

export function assetUsageGuide(category: "image" | "model" | "audio", format: string, assetId: string): AssetUsageGuide {
  const reference = `gameforge-asset://${assetId.toLowerCase()}`;
  if (category === "image") return {
    purpose: "2D image, sprite, background, or texture source",
    notes: "Use the exact reference as an <img> or CSS background URL, or assign it to an Image object for canvas rendering. Preserve aspect ratio unless the game design explicitly calls for cropping.",
    snippet: `<img src="${reference}" alt="Game asset">`,
  };
  if (category === "audio") return {
    purpose: "Sound effect or music source",
    notes: "Use an HTMLAudioElement or the Web Audio API and start playback from an explicit user gesture; browser autoplay may be blocked. Avoid starting duplicate music loops when restarting a scene.",
    snippet: `const sound = new Audio("${reference}");\nsound.preload = "none";\n// Call sound.play() from a user-initiated event handler.`,
  };
  return {
    purpose: `${format} 3D model source`,
    notes: "Use the exact reference as the model URL for a GLTF/GLB loader already bundled in the project. GameForge does not inject a renderer or GLTFLoader into generated games; do not assume THREE exists or add an external CDN dependency.",
    snippet: `const modelUrl = "${reference}";\n// Load with a GLTF/GLB loader bundled with this project.`,
  };
}
