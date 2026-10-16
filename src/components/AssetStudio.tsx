"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowDownToLine, ArrowLeft, AudioLines, Check, FileBox, Image as ImageIcon, LoaderCircle,
  LockKeyhole, Plus, Trash2, Upload, WandSparkles,
} from "lucide-react";
import type { PublicUser } from "@/lib/auth";
import { AssetPreview } from "@/components/AssetPreview";

type Asset = {
  id: string;
  filename: string;
  extension: string;
  format: string;
  category: "image" | "model" | "audio";
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  validationState: string;
  validation: Record<string, unknown>;
  createdAt: string;
  previewUrl: string;
};
type ApiErrorBody = { error?: { message?: string; code?: string } };
type CategoryFilter = "all" | Asset["category"];

const acceptedFiles = ".png,.jpg,.jpeg,.webp,.glb,.gltf,.wav,.ogg";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function responseError(response: Response): Promise<string> {
  try { return ((await response.json()) as ApiErrorBody).error?.message ?? "The request could not be completed."; }
  catch { return "The request could not be completed."; }
}

function uploadWithProgress(url: string, method: "PUT" | "POST", headers: Record<string, string>, fields: Record<string, string>, file: File, onProgress: (percentage: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    if (method === "PUT") for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Object storage rejected the upload (HTTP ${request.status}).`));
    };
    request.onerror = () => reject(new Error("Upload failed. For S3-compatible storage, check that the bucket CORS policy permits PUT from this GameForge origin and allows the signed headers."));
    request.onabort = () => reject(new Error("Upload cancelled."));
    if (method === "POST") {
      const form = new FormData();
      for (const [name, value] of Object.entries(fields)) form.append(name, value);
      form.append("file", file);
      request.send(form);
    } else request.send(file);
  });
}

export function AssetStudio() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const visibleAssets = useMemo(() => filter === "all" ? assets : assets.filter((asset) => asset.category === filter), [assets, filter]);
  const selected = visibleAssets.find((asset) => asset.id === selectedId) ?? visibleAssets[0] ?? null;

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (mounted) { setUser(data?.user ?? null); setAuthLoading(false); } })
      .catch(() => { if (mounted) setAuthLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => { if (user) void refreshAssets(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  async function refreshAssets() {
    setLoadingAssets(true);
    try {
      const response = await fetch("/api/assets", { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response));
      const data = await response.json() as { assets?: Asset[] };
      const next = Array.isArray(data.assets) ? data.assets : [];
      setAssets(next);
      setSelectedId((current) => next.some((asset) => asset.id === current) ? current : next[0]?.id ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your private library could not be loaded.");
    } finally { setLoadingAssets(false); }
  }

  async function upload(file: File) {
    setError("");
    setNotice("");
    setUploading(true);
    setUploadProgress(0);
    let assetId = "";
    try {
      const intentResponse = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size }),
      });
      if (!intentResponse.ok) throw new Error(await responseError(intentResponse));
      const intent = await intentResponse.json() as {
        assetId: string; uploadUrl: string; method: "PUT" | "POST"; headers?: Record<string, string>; fields?: Record<string, string>; storageMode: "local" | "s3";
      };
      assetId = intent.assetId;
      await uploadWithProgress(intent.uploadUrl, intent.method, intent.headers ?? {}, intent.fields ?? {}, file, setUploadProgress);
      setUploadProgress(100);
      const completeResponse = await fetch(`/api/assets/${encodeURIComponent(assetId)}/complete`, { method: "POST" });
      if (!completeResponse.ok) throw new Error(await responseError(completeResponse));
      const completed = await completeResponse.json() as { asset: Asset };
      setAssets((current) => [completed.asset, ...current.filter((asset) => asset.id !== completed.asset.id)]);
      setSelectedId(completed.asset.id);
      setNotice(`${completed.asset.filename} was inspected and saved to your private library. It has not been published.`);
    } catch (cause) {
      if (assetId) {
        try { await fetch(`/api/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" }); } catch { /* A failed intent expires automatically. */ }
      }
      setError(cause instanceof Error ? cause.message : "Asset upload failed.");
      void refreshAssets();
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
  }

  async function deleteSelected() {
    if (!selected || !window.confirm(`Permanently delete “${selected.filename}” from your private library?`)) return;
    setError("");
    setNotice("");
    setDeleting(true);
    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as { storageCleanupPending?: boolean };
      setAssets((current) => current.filter((asset) => asset.id !== selected.id));
      setSelectedId("");
      setNotice(result.storageCleanupPending ? "Access to this asset was revoked, but object-storage cleanup is pending. Contact the site operator if it remains." : "The private asset and stored objects were deleted.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The asset could not be deleted."); }
    finally { setDeleting(false); }
  }

  if (authLoading) return <div className="page-wrap page-content"><div className="studio-loading panel-card"><LoaderCircle className="spin" size={20} /> Opening your private asset library…</div></div>;
  if (!user) return <div className="page-wrap page-content"><header className="page-header"><div className="eyebrow"><LockKeyhole size={13} /> PRIVATE ASSET STUDIO</div><h1>Keep your game assets close.</h1><p>Upload and inspect your own images, 3D models, and audio in a private library.</p></header><div className="studio-auth-gate panel-card"><span className="studio-auth-icon"><LockKeyhole size={23} /></span><h2>Sign in to manage assets</h2><p>Uploaded content is private to your account and is never added to the public Asset Store automatically.</p><Link href="/auth?mode=login" className="button button-primary">Sign in to GameForge</Link><Link href="/auth?mode=register" className="auth-switch">New here? Create an account</Link></div></div>;

  const details = selected?.validation ?? {};
  const width = typeof details.width === "number" ? details.width : null;
  const height = typeof details.height === "number" ? details.height : null;
  const duration = typeof details.durationSeconds === "number" ? details.durationSeconds : null;
  const modelCounts = selected?.category === "model"
    ? ["meshes", "nodes", "animations", "materials"].filter((key) => typeof details[key] === "number").map((key) => `${details[key]} ${key}`)
    : [];

  return <main className="page-wrap page-content asset-studio-page">
    <div className="studio-topbar asset-studio-topbar">
      <div className="studio-topbar-title"><Link href="/studio" className="studio-back" aria-label="Back to AI Studio"><ArrowLeft size={15} /></Link><div><h1>Asset Studio</h1><span>Private library · {assets.length} {assets.length === 1 ? "asset" : "assets"}</span></div><span className="asset-private-pill"><LockKeyhole size={11} /> PRIVATE BY DEFAULT</span></div>
      <div className="studio-top-actions"><Link href="/studio" className="button button-dark button-small"><WandSparkles size={13} /> Open AI Game Studio</Link><button className="button button-primary button-small" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={13} /> Add asset</button></div>
    </div>
    {error && <div className="notice notice-error studio-notice" role="alert"><AlertCircle size={14} /> {error}</div>}
    {notice && !error && <div className="notice notice-success studio-notice" role="status"><Check size={14} /> {notice}</div>}
    <input ref={fileRef} className="asset-file-input" type="file" accept={acceptedFiles} onChange={onFileChange} disabled={uploading} aria-label="Choose an asset to upload" />
    <div className="asset-studio-layout">
      <aside className="asset-library-panel panel-card">
        <div className="asset-library-heading"><div><div className="eyebrow"><LockKeyhole size={12} /> YOUR PRIVATE LIBRARY</div><h2>Assets</h2></div><button className="icon-button" onClick={() => void refreshAssets()} disabled={loadingAssets} aria-label="Refresh assets"><LoaderCircle size={14} className={loadingAssets ? "spin" : ""} /></button></div>
        <div className="asset-filter-row" role="tablist" aria-label="Filter assets">
          {(["all", "image", "model", "audio"] as const).map((category) => <button key={category} role="tab" aria-selected={filter === category} className={filter === category ? "active" : ""} onClick={() => setFilter(category)}>{category === "all" ? "All" : category}</button>)}
        </div>
        {uploading && <div className="asset-upload-progress" role="status"><div><Upload size={13} /><span>Uploading and validating…</span><strong>{uploadProgress}%</strong></div><progress max={100} value={uploadProgress} /></div>}
        {loadingAssets ? <div className="asset-library-empty"><LoaderCircle size={16} className="spin" /> Loading your private files…</div>
          : visibleAssets.length ? <div className="asset-library-list">{visibleAssets.map((asset) => <button key={asset.id} className={`asset-library-item${selected?.id === asset.id ? " active" : ""}`} onClick={() => setSelectedId(asset.id)}>
            <span className={`asset-type-icon asset-type-${asset.category}`}>{asset.category === "image" ? <ImageIcon size={16} /> : asset.category === "model" ? <FileBox size={16} /> : <AudioLines size={16} />}</span>
            <span className="asset-library-item-text"><strong title={asset.filename}>{asset.filename}</strong><small>{asset.format} · {formatBytes(asset.sizeBytes)}</small></span><Check className="asset-selected-check" size={14} />
          </button>)}</div>
          : <div className="asset-library-empty"><span className="asset-empty-icon"><FileBox size={19} /></span><strong>{filter === "all" ? "Your library is empty" : `No ${filter} assets yet`}</strong><span>Upload an image, self-contained GLB/glTF model, WAV, or OGG file. Everything stays private.</span><button className="button button-outline button-small" onClick={() => fileRef.current?.click()} disabled={uploading}><Plus size={13} /> Upload your first asset</button></div>}
        <div className="asset-format-note"><strong>Accepted:</strong> PNG, JPEG, WebP, GLB, self-contained glTF, WAV, OGG. OBJ/FBX, SVG, video, archives, and external model resources are not accepted.</div>
      </aside>

      <section className="asset-detail-panel panel-card" aria-label="Selected asset details">
        {selected ? <>
          <div className="asset-detail-heading"><div><div className="eyebrow">{selected.category.toUpperCase()} · VALIDATED PRIVATE FILE</div><h2 title={selected.filename}>{selected.filename}</h2><span>{selected.format} · {formatBytes(selected.sizeBytes)} · Uploaded {new Date(selected.createdAt).toLocaleString()}</span></div><div className="asset-detail-actions"><a className="button button-dark button-small" href={selected.previewUrl} download={selected.filename}><ArrowDownToLine size={12} /> Download</a><button className="button button-outline button-small asset-delete-button" onClick={deleteSelected} disabled={deleting}><Trash2 size={13} /> {deleting ? "Deleting…" : "Delete"}</button></div></div>
          <div className="asset-preview-shell">
            {selected.category === "image" && <img className="asset-image-preview" src={selected.previewUrl} alt={`Private preview of ${selected.filename}`} />}
            {selected.category === "model" && <AssetPreview key={selected.id} url={selected.previewUrl} label={selected.filename} />}
            {selected.category === "audio" && <div className="asset-audio-preview"><AudioLines size={35} /><strong>{selected.filename}</strong><span>{duration ? `${duration.toFixed(2)} seconds · ` : ""}{formatBytes(selected.sizeBytes)}</span><audio src={selected.previewUrl} controls preload="metadata">Your browser does not support the audio preview.</audio></div>}
          </div>
          <div className="asset-metadata-grid"><div><small>File format</small><strong>{selected.format}</strong></div><div><small>Category</small><strong>{selected.category}</strong></div><div><small>Validated size</small><strong>{formatBytes(selected.sizeBytes)}</strong></div>{width && height && <div><small>Dimensions</small><strong>{width} × {height} px</strong></div>}{modelCounts.length > 0 && <div><small>Model structure</small><strong>{modelCounts.join(" · ")}</strong></div>}{duration && <div><small>Duration</small><strong>{duration.toFixed(2)} s</strong></div>}<div><small>Content validation</small><strong className="asset-valid-state"><Check size={12} /> {selected.validationState.replaceAll("_", " ")}</strong></div></div>
          <div className="asset-privacy-note"><LockKeyhole size={14} /><div><strong>Private, not published</strong><span>File bytes remain private and are not sent to AI. Only filenames and validation metadata you explicitly attach as prompt context may be shared; nothing is published.</span></div></div>
        </> : <div className="asset-detail-empty"><span><FileBox size={22} /></span><h2>Select a private asset</h2><p>Validated uploads can be previewed here. Image and audio files use the browser’s safe built-in viewers; GLB/glTF models use the locally bundled Three.js renderer.</p><button className="button button-primary" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={14} /> Upload an asset</button></div>}
      </section>
    </div>
    <section className="asset-studio-footnote"><WandSparkles size={14} /><p><strong>Current scope:</strong> This page securely uploads and previews private assets; AI image/model generation is not available. In AI Studio, selected assets can be bound to an immutable project version and referenced with a `gameforge-asset://UUID` placeholder. Only filenames and validated metadata—not private bytes—are sent to AI. Preview delivery uses a short-lived project/version-scoped grant. Public Asset Store sharing and redistribution rights review are not implemented.</p></section>
  </main>;
}
