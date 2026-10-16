"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
  publicationStatus: "private" | "pending_review" | "published" | "rejected" | "removed";
  storeTitle: string;
  publicDescription: string;
  license: string | null;
  rightsBasis: "created_by_me" | "licensed_for_redistribution" | "public_domain" | null;
  rightsConfirmed: boolean;
  downloadAuthorized: boolean;
  attribution: string;
  moderationNote: string;
  publishedAt: string | null;
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
  const [storeBusy, setStoreBusy] = useState(false);
  const [storeFormOpen, setStoreFormOpen] = useState(false);
  const [storeTitle, setStoreTitle] = useState("");
  const [storeDescription, setStoreDescription] = useState("");
  const [storeAttribution, setStoreAttribution] = useState("");
  const [storeLicense, setStoreLicense] = useState<"cc-by-4.0" | "cc-by-sa-4.0" | "cc0-1.0">("cc-by-4.0");
  const [rightsBasis, setRightsBasis] = useState<"created_by_me" | "licensed_for_redistribution" | "public_domain">("created_by_me");
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [downloadAuthorized, setDownloadAuthorized] = useState(false);
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
  useEffect(() => {
    if (!selected) return;
    setStoreTitle(selected.storeTitle || selected.filename.replace(/\.[^.]+$/, ""));
    setStoreDescription(selected.publicDescription || "");
    setStoreAttribution(selected.attribution || `@${user?.username ?? "creator"}`);
    setStoreLicense(selected.license === "cc-by-sa-4.0" || selected.license === "cc0-1.0" ? selected.license : "cc-by-4.0");
    setRightsBasis(selected.rightsBasis ?? "created_by_me");
    setRightsConfirmed(false);
    setDownloadAuthorized(false);
    setStoreFormOpen(false);
  }, [selectedId, user?.id]);

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
    if (!selected || !window.confirm(`Permanently delete “${selected.filename}” from your library?`)) return;
    setError("");
    setNotice("");
    setDeleting(true);
    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as { storageCleanupPending?: boolean };
      setAssets((current) => current.filter((asset) => asset.id !== selected.id));
      setSelectedId("");
      setNotice(result.storageCleanupPending ? "Access to this asset was revoked, but object-storage cleanup is pending. Contact the site operator if it remains." : "The asset and stored objects were deleted.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The asset could not be deleted."); }
    finally { setDeleting(false); }
  }

  async function submitToStore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setError(""); setNotice(""); setStoreBusy(true);
    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(selected.id)}/store`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: storeTitle, description: storeDescription, attribution: storeAttribution, license: storeLicense, rightsBasis, rightsConfirmed, downloadAuthorized }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as { message?: string };
      setStoreFormOpen(false);
      setNotice(result.message || "The asset was submitted for moderator review.");
      await refreshAssets();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The asset could not be submitted."); }
    finally { setStoreBusy(false); }
  }

  async function withdrawFromStore() {
    if (!selected || !window.confirm("Withdraw this asset from the public store? Copies already downloaded remain subject to the selected license.")) return;
    setError(""); setNotice(""); setStoreBusy(true);
    try {
      const response = await fetch(`/api/assets/${encodeURIComponent(selected.id)}/store`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseError(response));
      const result = await response.json() as { message?: string };
      setNotice(result.message || "The asset was withdrawn from the public store.");
      await refreshAssets();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The asset could not be withdrawn."); }
    finally { setStoreBusy(false); }
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
  const canDeleteSelected = Boolean(selected && ["private", "rejected", "removed"].includes(selected.publicationStatus));
  const canWithdrawSelected = Boolean(selected && ["pending_review", "published"].includes(selected.publicationStatus));
  const canSubmitSelected = Boolean(selected && ["private", "rejected"].includes(selected.publicationStatus));

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
            <span className="asset-library-item-text"><strong title={asset.filename}>{asset.filename}</strong><small>{asset.format} · {formatBytes(asset.sizeBytes)} · {asset.publicationStatus.replaceAll("_", " ")}</small></span><Check className="asset-selected-check" size={14} />
          </button>)}</div>
          : <div className="asset-library-empty"><span className="asset-empty-icon"><FileBox size={19} /></span><strong>{filter === "all" ? "Your library is empty" : `No ${filter} assets yet`}</strong><span>Upload an image, self-contained GLB/glTF model, WAV, or OGG file. Everything stays private.</span><button className="button button-outline button-small" onClick={() => fileRef.current?.click()} disabled={uploading}><Plus size={13} /> Upload your first asset</button></div>}
        <div className="asset-format-note"><strong>Accepted:</strong> PNG, JPEG, WebP, GLB, self-contained glTF, WAV, OGG. OBJ/FBX, SVG, video, archives, and external model resources are not accepted.</div>
      </aside>

      <section className="asset-detail-panel panel-card" aria-label="Selected asset details">
        {selected ? <>
          <div className="asset-detail-heading"><div><div className="eyebrow">{selected.category.toUpperCase()} · {selected.publicationStatus.replaceAll("_", " ").toUpperCase()}</div><h2 title={selected.filename}>{selected.filename}</h2><span>{selected.format} · {formatBytes(selected.sizeBytes)} · Uploaded {new Date(selected.createdAt).toLocaleString()}</span></div><div className="asset-detail-actions"><a className="button button-dark button-small" href={selected.previewUrl} download={selected.filename}><ArrowDownToLine size={12} /> Download</a>{canWithdrawSelected && <button className="button button-outline button-small" onClick={withdrawFromStore} disabled={storeBusy}>Withdraw from store</button>}{canDeleteSelected && <button className="button button-outline button-small asset-delete-button" onClick={deleteSelected} disabled={deleting}><Trash2 size={13} /> {deleting ? "Deleting…" : "Delete"}</button>}</div></div>
          <div className="asset-preview-shell">
            {selected.category === "image" && <img className="asset-image-preview" src={selected.previewUrl} alt={`Private preview of ${selected.filename}`} />}
            {selected.category === "model" && <AssetPreview key={selected.id} url={selected.previewUrl} label={selected.filename} />}
            {selected.category === "audio" && <div className="asset-audio-preview"><AudioLines size={35} /><strong>{selected.filename}</strong><span>{duration ? `${duration.toFixed(2)} seconds · ` : ""}{formatBytes(selected.sizeBytes)}</span><audio src={selected.previewUrl} controls preload="metadata">Your browser does not support the audio preview.</audio></div>}
          </div>
          <div className="asset-metadata-grid"><div><small>File format</small><strong>{selected.format}</strong></div><div><small>Category</small><strong>{selected.category}</strong></div><div><small>Validated size</small><strong>{formatBytes(selected.sizeBytes)}</strong></div>{width && height && <div><small>Dimensions</small><strong>{width} × {height} px</strong></div>}{modelCounts.length > 0 && <div><small>Model structure</small><strong>{modelCounts.join(" · ")}</strong></div>}{duration && <div><small>Duration</small><strong>{duration.toFixed(2)} s</strong></div>}<div><small>Content validation</small><strong className="asset-valid-state"><Check size={12} /> {selected.validationState.replaceAll("_", " ")}</strong></div></div>
          <div className="asset-privacy-note"><LockKeyhole size={14} /><div><strong>{selected.publicationStatus === "published" ? "Publicly downloadable under its license" : selected.publicationStatus === "pending_review" ? "Private while awaiting moderator review" : selected.publicationStatus === "removed" ? "Removed from public access" : "Private, not published"}</strong><span>{selected.publicationStatus === "published" ? `This file can be downloaded by anyone under ${selected.license ?? "its declared license"}. Existing copies remain subject to that license if you withdraw it.` : "Your file stays private unless you submit it and a moderator approves it. Private file bytes are not sent to AI; only filenames and validated metadata you explicitly attach as prompt context may be shared."}</span></div></div>
          {selected.moderationNote && <div className="notice notice-info asset-moderation-note"><strong>Moderator note:</strong> {selected.moderationNote}</div>}
          <section className="asset-store-submission panel-card" aria-label="Public Asset Store submission">
            <div className="asset-store-submission-head"><div><div className="eyebrow">COMMUNITY ASSET STORE</div><h3>Publish with permission</h3><p>Every listing requires a rights declaration, attribution, a public license, explicit download authorization, and moderator approval.</p></div>{selected.publicationStatus === "published" && <Link href="/asset-store" className="button button-dark button-small">View listing</Link>}</div>
            {selected.publicationStatus === "pending_review" && <p className="asset-store-status-copy">In the review queue. The listing and download are not public yet.</p>}
            {selected.publicationStatus === "published" && <p className="asset-store-status-copy">Published {selected.publishedAt ? new Date(selected.publishedAt).toLocaleString() : ""}. Withdraw anytime; previously downloaded copies remain subject to the license.</p>}
            {selected.publicationStatus === "removed" && <p className="asset-store-status-copy">This asset was removed from public access. Contact the moderation team if you believe this was in error.</p>}
            {canSubmitSelected && !storeFormOpen && <button className="button button-primary button-small" onClick={() => { setRightsConfirmed(false); setDownloadAuthorized(false); setStoreFormOpen(true); }}>Submit for public review</button>}
            {canSubmitSelected && storeFormOpen && <form className="asset-store-rights-form" onSubmit={submitToStore}>
              <div className="field"><label htmlFor="store-asset-title">Store title</label><input id="store-asset-title" className="text-input" value={storeTitle} onChange={(event) => setStoreTitle(event.target.value)} maxLength={100} minLength={2} required /></div>
              <div className="field"><label htmlFor="store-asset-description">Description</label><textarea id="store-asset-description" className="text-area" value={storeDescription} onChange={(event) => setStoreDescription(event.target.value)} maxLength={700} placeholder="Describe the asset and permitted uses." /></div>
              <div className="field"><label htmlFor="store-asset-attribution">Required attribution</label><input id="store-asset-attribution" className="text-input" value={storeAttribution} onChange={(event) => setStoreAttribution(event.target.value)} maxLength={300} minLength={2} placeholder="Creator or source attribution shown with every listing" required /></div>
              <div className="asset-store-form-grid">
                <div className="field"><label htmlFor="store-asset-license">Public download license</label><select id="store-asset-license" className="select-input" value={storeLicense} onChange={(event) => setStoreLicense(event.target.value as typeof storeLicense)}><option value="cc-by-4.0">CC BY 4.0 · Attribution</option><option value="cc-by-sa-4.0">CC BY-SA 4.0 · Attribution + ShareAlike</option><option value="cc0-1.0">CC0 1.0 · Public domain dedication</option></select></div>
                <div className="field"><label htmlFor="store-asset-rights">Basis for your rights</label><select id="store-asset-rights" className="select-input" value={rightsBasis} onChange={(event) => setRightsBasis(event.target.value as typeof rightsBasis)}><option value="created_by_me">I created/own this asset</option><option value="licensed_for_redistribution">I have redistribution authorization</option><option value="public_domain">I verified it is public domain</option></select></div>
              </div>
              <label className="checkbox-row asset-rights-check"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} required /> I confirm that I own the necessary rights, have documented authorization, or verified public-domain status; I may apply the selected license, and the file contains no material that I am not authorized to redistribute.</label>
              <label className="checkbox-row asset-rights-check"><input type="checkbox" checked={downloadAuthorized} onChange={(event) => setDownloadAuthorized(event.target.checked)} required /> I explicitly authorize public listing and downloads under this license. I understand that downloaded copies can remain in circulation under the license after withdrawal.</label>
              <p className="asset-rights-disclaimer">Submissions stay private until a moderator reviews them. Review does not independently verify ownership or replace legal advice. Do not submit assets unless you can authorize redistribution under the selected license.</p>
              <div className="form-actions"><button className="button button-primary button-small" disabled={storeBusy}>{storeBusy ? "Submitting…" : "Confirm declarations & submit"}</button><button className="button button-dark button-small" type="button" onClick={() => setStoreFormOpen(false)} disabled={storeBusy}>Cancel</button></div>
            </form>}
          </section>
        </> : <div className="asset-detail-empty"><span><FileBox size={22} /></span><h2>Select a private asset</h2><p>Validated uploads can be previewed here. Image and audio files use the browser’s safe built-in viewers; GLB/glTF models use the locally bundled Three.js renderer.</p><button className="button button-primary" onClick={() => fileRef.current?.click()} disabled={uploading}><Upload size={14} /> Upload an asset</button></div>}
      </section>
    </div>
    <section className="asset-studio-footnote"><WandSparkles size={14} /><p><strong>Asset safety:</strong> Private uploads remain private by default. Asset Store submissions require an explicit rights basis, attribution, a supported public license, download authorization, and moderator approval; declarations are self-attested and do not replace legal review. Downloads are served as attachments, and withdrawn or removed listings stop being served. AI image/model generation is not available. In AI Studio, selected assets can be bound to an immutable project version and referenced with a `gameforge-asset://UUID` placeholder; only filenames and validated metadata—not private bytes—are sent to AI.</p></section>
  </main>;
}
