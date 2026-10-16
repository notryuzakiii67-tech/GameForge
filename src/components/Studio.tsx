"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ArrowDownToLine, ArrowLeft, Check, ChevronRight, Code2, FileBox, FileCode2, FileJson2,
  FileText, LoaderCircle, LockKeyhole, RotateCcw, Save, Send, Settings2, Sparkles, WandSparkles,
} from "lucide-react";
import { genres } from "@/lib/demo-games";
import { replaceWithAssetReference } from "@/lib/asset-replacement";
import type { PublicUser } from "@/lib/auth";
import type { AiProvider, ProviderModel } from "@/lib/ai/providers";
import type { ProjectFile } from "@/lib/zip";

type ProjectSummary = { id: string; title: string; description: string; status: string; visibility: string; version: number | null; summary: string | null; allowRemix?: boolean };
type StudioAsset = { id: string; filename: string; category: "image" | "model" | "audio"; format: string; sizeBytes: number; validation: Record<string, unknown> };
type ProjectAssetBinding = { assetId: string; filename: string; format: string; category: "image" | "model" | "audio"; sizeBytes: number; placeholder: string; createdAt: string; importSource: { assetId: string | null; license: string; licenseUrl: string; attribution: string; creatorUsername: string; creatorDisplayName: string } | null };
type VersionSummary = { version: number; prompt: string; provider: string; model: string; summary: string; createdAt: string };
type ErrorBody = { error?: { code?: string; message?: string; retryAfter?: number } };

const providerOptions: { id: AiProvider; name: string; info: string; short: string }[] = [
  { id: "gemini", name: "Google Gemini", short: "Gemini", info: "Uses the operator-configured GEMINI_API_KEY. Provider availability and quotas are controlled by Google." },
  { id: "mistral", name: "Mistral", short: "Mistral", info: "Uses the operator-configured MISTRAL_API_KEY. Model access and quotas follow the provider account." },
  { id: "groq", name: "Groq", short: "Groq", info: "Uses the operator-configured GROQ_API_KEY. Model access and quotas follow the provider account." },
];
const examples = [
  "A tiny robot platformer with floating islands, coins, and a portal.",
  "A cozy midnight garden puzzle about guiding fireflies home.",
  "A one-button arcade game where a paper plane rides the wind.",
];

async function readError(response: Response): Promise<ErrorBody> {
  try { return await response.json() as ErrorBody; } catch { return {}; }
}

function iconForFile(path: string) {
  if (/\.html?$/i.test(path)) return <Code2 size={13} />;
  if (/\.json$/i.test(path)) return <FileJson2 size={13} />;
  if (/\.(?:js|mjs|css)$/i.test(path)) return <FileCode2 size={13} />;
  return <FileText size={13} />;
}

export function Studio({ initialProjectId }: { initialProjectId?: string }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [provider, setProvider] = useState<AiProvider>("gemini");
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [model, setModel] = useState("");
  const [connected, setConnected] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [gameType, setGameType] = useState("Arcade");
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [projectId, setProjectId] = useState<string | null>(initialProjectId ?? null);
  const [projectTitle, setProjectTitle] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectStatus, setProjectStatus] = useState("draft");
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activePath, setActivePath] = useState("");
  const [code, setCode] = useState("");
  const [version, setVersion] = useState(0);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [assetLibrary, setAssetLibrary] = useState<StudioAsset[]>([]);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [assetLibraryLoading, setAssetLibraryLoading] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [projectBindings, setProjectBindings] = useState<ProjectAssetBinding[]>([]);
  const [bindingsLoading, setBindingsLoading] = useState(false);
  const [bindingSaving, setBindingSaving] = useState(false);
  const [previewSrc, setPreviewSrc] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [publishStatus, setPublishStatus] = useState("");
  const [allowRemix, setAllowRemix] = useState(false);
  const [mobileTab, setMobileTab] = useState<"prompt" | "preview" | "files">("preview");
  const [dirty, setDirty] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const selectedProvider = providerOptions.find((item) => item.id === provider)!;
  const codeEditorRef = useRef<HTMLTextAreaElement>(null);
  const indexPath = useMemo(() => files.find((file) => file.path.toLowerCase() === "index.html")?.path ?? files.find((file) => file.path.toLowerCase().endsWith("/index.html"))?.path ?? "index.html", [files]);
  const activeFile = files.find((file) => file.path === activePath);

  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (mounted) { setUser(data?.user ?? null); setAuthLoading(false); } })
      .catch(() => { if (mounted) setAuthLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (user) {
      void loadProjects();
      void loadAssetLibrary();
      if (initialProjectId) void loadProject(initialProjectId);
    }
    // Project loading is intentionally keyed to the signed-in user and the route project id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, initialProjectId]);

  useEffect(() => {
    const active = files.find((file) => file.path === activePath);
    setCode(active?.content ?? "");
    setDirty(false);
  }, [activePath, files]);

  useEffect(() => {
    let active = true;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    if (!user || !projectId || version < 1) {
      setPreviewSrc("");
      setPreviewLoading(false);
      setPreviewError("");
      return () => { active = false; };
    }
    setPreviewSrc("");
    setPreviewLoading(true);
    setPreviewError("");
    async function refreshSession() {
      try {
        const response = await fetch(`/api/ai/projects/${projectId}/preview-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version }),
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "The private game preview could not be opened.");
        const filePath = indexPath.split("/").map(encodeURIComponent).join("/");
        const previewUrl = body.hasPrivateAssets
          ? typeof body.token === "string"
            ? `/api/ai/projects/${projectId}/preview/${version}/${encodeURIComponent(body.token)}/${filePath}?v=${version}`
            : ""
          : `/api/ai/projects/${projectId}/versions/${version}/${filePath}?v=${version}&refresh=${previewKey}`;
        if (body.hasPrivateAssets && !body.token) throw new Error("The private preview session did not include a temporary access grant.");
        if (!active) return;
        setPreviewSrc(previewUrl);
        if (typeof body.expiresInSeconds === "number") {
          refreshTimer = setTimeout(() => { void refreshSession(); }, Math.max(60, body.expiresInSeconds - 60) * 1000);
        }
      } catch (cause) {
        if (active) {
          setPreviewSrc("");
          setPreviewError(cause instanceof Error ? cause.message : "The private game preview could not be opened.");
        }
      } finally {
        if (active) setPreviewLoading(false);
      }
    }
    void refreshSession();
    return () => {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [user?.id, projectId, version, indexPath, previewKey]);

  async function loadProjects() {
    try {
      const response = await fetch("/api/ai/projects", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) setProjects(data.projects ?? []);
    } catch { /* The project list can be retried after login or a network recovery. */ }
  }

  async function loadAssetLibrary() {
    setAssetLibraryLoading(true);
    try {
      const response = await fetch("/api/assets", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) setAssetLibrary(Array.isArray(data.assets) ? data.assets : []);
    } catch { /* Uploading from Asset Studio remains available if this list cannot be loaded. */ }
    finally { setAssetLibraryLoading(false); }
  }

  async function loadProjectBindings(id: string, targetVersion: number) {
    if (targetVersion < 1) { setProjectBindings([]); return; }
    setBindingsLoading(true);
    try {
      const response = await fetch(`/api/ai/projects/${id}/assets?version=${targetVersion}`, { cache: "no-store" });
      const data = await response.json();
      if (response.ok) setProjectBindings(Array.isArray(data.bindings) ? data.bindings : []);
      else setProjectBindings([]);
    } catch { setProjectBindings([]); }
    finally { setBindingsLoading(false); }
  }

  async function loadProject(id: string) {
    setLoadingProject(true);
    setError("");
    try {
      const [response, historyResponse] = await Promise.all([
        fetch(`/api/ai/projects/${id}`, { cache: "no-store" }),
        fetch(`/api/ai/projects/${id}/versions`, { cache: "no-store" }),
      ]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "This project couldn’t be loaded.");
      const nextFiles = data.latest?.files ?? [];
      setProjectId(id);
      setProjectTitle(data.project.title ?? "Untitled game");
      setProjectDescription(data.project.description ?? "");
      setProjectStatus(data.project.status ?? "draft");
      setAllowRemix(Boolean(data.project.allowRemix));
      setGameType(data.project.genre ?? "Experimental");
      setFiles(nextFiles);
      setVersion(data.latest?.version ?? 0);
      setActivePath(nextFiles[0]?.path ?? "");
      await loadProjectBindings(id, Number(data.latest?.version ?? 0));
      if (historyResponse.ok) {
        const history = await historyResponse.json();
        setVersions(history.versions ?? []);
      }
      setNotice("Project and saved versions loaded.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This project couldn’t be loaded.");
    } finally {
      setLoadingProject(false);
    }
  }

  function changeProvider(next: AiProvider) {
    if (provider === next) return;
    setProvider(next);
    setModels([]);
    setModel("");
    setConnected(false);
    setError("");
  }

  async function connectProvider() {
    setError("");
    setNotice("");
    setLoadingModels(true);
    setConnected(false);
    try {
      const response = await fetch("/api/ai/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Provider connection failed.");
      const resolvedProvider = providerOptions.some((item) => item.id === body.provider) ? body.provider as AiProvider : provider;
      const available = Array.isArray(body.models) ? body.models as ProviderModel[] : [];
      const recommendedModel = typeof body.recommendedModel === "string" ? body.recommendedModel : "";
      setProvider(resolvedProvider);
      setModels(available);
      setModel((current) => resolvedProvider === provider && available.some((item) => item.id === current)
        ? current
        : available.some((item) => item.id === recommendedModel) ? recommendedModel : available[0]?.id ?? "");
      setConnected(true);
      setNotice(body.fallbackFrom
        ? `${providerOptions.find((item) => item.id === body.fallbackFrom)?.name ?? body.fallbackFrom} was rate-limited during model discovery; using ${body.providerName}. Prompts can be sent to fallback providers when quotas are reached.`
        : `${body.providerName} responded. ${available.length} models are available for this key.`);
    } catch (cause) {
      setModels([]);
      setModel("");
      setError(cause instanceof Error ? cause.message : "Provider connection failed.");
    } finally {
      setLoadingModels(false);
    }
  }

  async function generate(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    setNotice("");
    setPublishStatus("");
    if (!connected || !models.some((item) => item.id === model)) { setError("Connect a provider and choose an available model first."); return; }
    if (prompt.trim().length < 8) { setError("Describe the game you want to make in a little more detail."); return; }
    setGenerating(true);
    setMobileTab("preview");
    try {
      const response = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, prompt: prompt.trim(), gameType, assetIds: selectedAssetIds, ...(projectId ? { projectId } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Generation failed. Your previous versions are unchanged.");
      const nextFiles = body.version.files as ProjectFile[];
      setProjectId(body.project.id);
      setProjectTitle(body.project.title);
      setProjectDescription(body.project.description);
      setProjectStatus("draft");
      setFiles(nextFiles);
      setVersion(body.version.number);
      setProjectBindings(Array.isArray(body.assetBindings) ? body.assetBindings : []);
      setActivePath(nextFiles.find((file) => file.path.toLowerCase().endsWith(".html"))?.path ?? nextFiles[0]?.path ?? "");
      setDirty(false);
      setSelectedAssetIds([]);
      setAssetPickerOpen(false);
      const providerNotice = body.aiProvider?.fallbackFrom
        ? ` Quota fallback: ${providerOptions.find((item) => item.id === body.aiProvider.fallbackFrom)?.name ?? body.aiProvider.fallbackFrom} was rate-limited; this version was generated with ${body.aiProvider.usedName} (${body.aiProvider.model}). Your prompt may have been sent to more than one configured external provider.`
        : ` Generated with ${body.aiProvider?.usedName ?? selectedProvider.name} (${body.aiProvider?.model ?? model}).`;
      setNotice(`Version ${body.version.number} saved.${providerNotice} ${body.note}`);
      await loadHistory(body.project.id);
      await loadProjects();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Generation failed. Your previous versions are unchanged.");
    } finally {
      setGenerating(false);
    }
  }

  async function loadHistory(id: string) {
    try {
      const response = await fetch(`/api/ai/projects/${id}/versions`, { cache: "no-store" });
      const body = await response.json();
      if (response.ok) setVersions(body.versions ?? []);
    } catch { /* Version history remains available via the library. */ }
  }

  async function restoreVersion(target: number) {
    if (!projectId) return;
    setError("");
    try {
      const response = await fetch(`/api/ai/projects/${projectId}/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: target }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Version restore failed.");
      setFiles(body.files);
      setVersion(body.version);
      setProjectStatus("draft");
      setProjectBindings(Array.isArray(body.assetBindings) ? body.assetBindings : []);
      setActivePath(body.files[0]?.path ?? "");
      setNotice(`Version ${target} restored as version ${body.version}. Earlier history is preserved.`);
      await loadHistory(projectId);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Version restore failed."); }
  }

  async function saveCode() {
    if (!projectId || !dirty) return;
    setSaving(true);
    setError("");
    try {
      const changed = files.map((file) => file.path === activePath ? { ...file, content: code } : file);
      const response = await fetch(`/api/ai/projects/${projectId}/files`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: changed, summary: `Edited ${activePath} in the code editor.` }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The code changes could not be saved.");
      setFiles(body.files);
      setVersion(body.version);
      setProjectStatus("draft");
      setProjectBindings(Array.isArray(body.assetBindings) ? body.assetBindings : []);
      setDirty(false);
      setNotice(`Code saved as version ${body.version}.`);
      await loadHistory(projectId);
      await loadProjects();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The code changes could not be saved."); }
    finally { setSaving(false); }
  }

  async function exportZip() {
    if (!projectId) return;
    setError("");
    try {
      const response = await fetch(`/api/ai/projects/${projectId}/export`);
      if (!response.ok) {
        const body = await readError(response);
        throw new Error(body.error?.message || "ZIP export failed.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(projectTitle || "gameforge-project").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-v${version}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("Project ZIP downloaded.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ZIP export failed."); }
  }

  async function submitForReview() {
    if (!projectId) return;
    setError("");
    setPublishStatus("");
    try {
      const response = await fetch(`/api/ai/projects/${projectId}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ license: "all-rights-reserved" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Game submission failed.");
      setPublishStatus(body.message || "Game submitted for review.");
      setProjectStatus("submitted");
      setNotice(`Submission created: ${body.game.title} · pending moderation.`);
      await loadProjects();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Game submission failed."); }
  }

  async function requestRemixing() {
    if (!projectId) return;
    const next = !allowRemix;
    setError("");
    try {
      const response = await fetch(`/api/ai/projects/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowRemix: next }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Project settings could not be saved.");
      setAllowRemix(next);
      setNotice(next ? "Remixing is allowed when this public project is approved." : "Remixing disabled.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Project settings could not be saved."); }
  }

  async function copyProjectLink() {
    if (!projectId) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/studio/${projectId}`);
      setNotice("Private project link copied. Only you can open it until you publish a public version.");
    } catch { setError("Clipboard access isn’t available in this browser."); }
  }

  function toggleAssetSelection(id: string) {
    setSelectedAssetIds((current) => current.includes(id)
      ? current.filter((assetId) => assetId !== id)
      : current.length < 6 ? [...current, id] : current);
  }

  async function bindSelectedAssets() {
    if (!projectId || version < 1 || !selectedAssetIds.length || projectStatus !== "draft") return;
    if (dirty) { setError("Save or discard your code edits before changing asset bindings."); return; }
    setError("");
    setBindingSaving(true);
    try {
      const response = await fetch(`/api/ai/projects/${projectId}/assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, assetIds: selectedAssetIds }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The selected private assets could not be bound.");
      setVersion(body.version);
      setFiles(body.files ?? files);
      setProjectBindings(Array.isArray(body.bindings) ? body.bindings : []);
      setSelectedAssetIds([]);
      setNotice(body.message || `Private assets bound in version ${body.version}.`);
      await loadHistory(projectId);
      await loadProjects();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The selected private assets could not be bound."); }
    finally { setBindingSaving(false); }
  }

  async function unbindProjectAsset(assetId: string) {
    if (!projectId || version < 1 || projectStatus !== "draft") return;
    if (dirty) { setError("Save or discard your code edits before changing asset bindings."); return; }
    setError("");
    setBindingSaving(true);
    try {
      const response = await fetch(`/api/ai/projects/${projectId}/assets/${encodeURIComponent(assetId)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The private asset could not be unbound.");
      setVersion(body.version);
      setFiles(body.files ?? files);
      setProjectBindings(Array.isArray(body.bindings) ? body.bindings : []);
      setNotice(body.message || `Asset unbound in version ${body.version}. Earlier versions are unchanged.`);
      await loadHistory(projectId);
      await loadProjects();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The private asset could not be unbound."); }
    finally { setBindingSaving(false); }
  }

  function replaceSelectionWithBoundAsset(asset: ProjectAssetBinding) {
    const editor = codeEditorRef.current;
    if (!editor || !activeFile || projectStatus !== "draft") {
      setError("Open a code file in a private draft before inserting an asset reference.");
      return;
    }
    const result = replaceWithAssetReference(editor.value, editor.selectionStart, editor.selectionEnd, asset.placeholder);
    setCode(result.content);
    setDirty(true);
    setError("");
    setNotice(`Inserted ${asset.filename} as a private asset reference. Save code as a new version to persist it.`);
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(result.cursor, result.cursor);
    });
  }

  function chooseFile(path: string) {
    if (dirty && !window.confirm("Discard unsaved code edits and switch files?")) return;
    setActivePath(path);
  }

  function switchProject(event: ChangeEvent<HTMLSelectElement>) {
    const nextId = event.target.value;
    if (dirty && !window.confirm("Discard unsaved code edits and switch projects?")) return;
    if (nextId) {
      void loadProject(nextId);
      return;
    }
    setProjectId(null);
    setProjectTitle("");
    setProjectDescription("");
    setProjectStatus("draft");
    setProjectBindings([]);
    setFiles([]);
    setActivePath("");
    setCode("");
    setVersion(0);
    setVersions([]);
    setDirty(false);
    setNotice("Ready for a new private draft.");
  }

  if (authLoading) return <div className="page-wrap studio-page"><div className="studio-loading panel-card"><LoaderCircle className="spin" size={20} /> Opening your studio…</div></div>;
  if (!user) return <div className="page-wrap page-content"><header className="page-header"><div className="eyebrow"><Sparkles size={13} /> AI GAME STUDIO</div><h1>Make something playable.</h1><p>Use an operator-configured AI provider to generate browser-ready games, iterate on the code, and publish approved builds.</p></header><div className="studio-auth-gate panel-card"><span className="studio-auth-icon"><LockKeyhole size={23} /></span><h2>Sign in to create</h2><p>AI projects and version history are private to your account. Provider credentials are configured in the server environment and are never sent to your browser.</p><Link href="/auth?mode=login" className="button button-primary">Sign in to GameForge <ChevronRight size={15} /></Link><Link href="/auth?mode=register" className="auth-switch">New here? Create an account</Link></div></div>;

  return <div className="page-wrap studio-page page-content">
    <div className="studio-topbar">
      <div className="studio-topbar-title"><Link href="/" className="studio-back" aria-label="Back home"><ArrowLeft size={15} /></Link><div><h1>AI Studio</h1><span>{projectId ? projectTitle || "Untitled project" : "A playable idea starts with a prompt"}</span></div>{projectId && <span className="status-badge status-draft">Saved draft · v{version}</span>}</div>
      <div className="studio-top-actions">
        <Link href="/assets" className="button button-dark button-small"><FileBox size={13} /> Asset Studio</Link>
        {projectId && <><button className="button button-dark button-small" onClick={copyProjectLink} title="Copy a private link"><LinkIcon /> Share</button><button className="button button-dark button-small" onClick={exportZip}><ArrowDownToLine size={13} /> ZIP</button><button className="button button-primary button-small" onClick={submitForReview} disabled={!files.length || generating || saving}><Send size={13} /> Publish</button></>}
      </div>
    </div>
    {error && <div className="notice notice-error studio-notice" role="alert"><AlertCircle size={14} /> {error}</div>}
    {notice && !error && <div className="notice notice-success studio-notice" role="status"><Check size={14} /> {notice}</div>}
    {publishStatus && <div className="notice notice-info studio-notice" role="status">{publishStatus}</div>}
    <div className="studio-mobile-tabs"><button className={mobileTab === "prompt" ? "active" : ""} onClick={() => setMobileTab("prompt")}>Prompt</button><button className={mobileTab === "preview" ? "active" : ""} onClick={() => setMobileTab("preview")}>Preview</button><button className={mobileTab === "files" ? "active" : ""} onClick={() => setMobileTab("files")}>Files & history</button></div>
    <div className="studio-layout">
      <aside className={`studio-panel studio-left-panel${mobileTab === "prompt" ? " mobile-active" : ""}`}>
        <div className="studio-panel-heading">Start with an idea <span>SERVER KEY · PRIVATE</span></div>
        <label className="field"><span className="field-label">AI provider</span><select className="select-input" value={provider} onChange={(event) => changeProvider(event.target.value as AiProvider)}>{providerOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <div className="studio-provider-key-note"><strong>Server-side provider key</strong><span>{selectedProvider.info}</span><small>The credential is read from server environment variables only. It is never sent to this page.</small><small>Gemini is the default; quota fallback order is Gemini → Mistral → Groq. Fallback may send your prompt to another external provider.</small></div>
        <button className="button button-outline button-small provider-connect" onClick={connectProvider} disabled={loadingModels}>{loadingModels ? <><LoaderCircle size={13} className="spin" /> Checking provider…</> : connected ? <><Check size={13} /> Provider replied · refresh models</> : "Check server configuration & load models"}</button>
        <div className="studio-connection-status" role="status"><span className={`provider-indicator${connected ? " connected" : ""}`} />{connected ? `${selectedProvider.short} replied · provider quotas still apply` : "Provider connection not checked"}</div>
        <div className="studio-model-grid"><label className="field"><span className="field-label">Model</span><select className="select-input" value={model} onChange={(event) => setModel(event.target.value)} disabled={!models.length}><option value="">{models.length ? "Choose a model" : "Check provider first"}</option>{models.map((available) => <option key={available.id} value={available.id}>{available.displayName} · {available.id}</option>)}</select></label><label className="field"><span className="field-label">Game type</span><select className="select-input" value={gameType} onChange={(event) => setGameType(event.target.value)}>{genres.map((genre) => <option value={genre} key={genre}>{genre}</option>)}</select></label></div>
        {projects.length > 0 && <label className="field saved-project-select"><span className="field-label">Your saved projects</span><select className="select-input" value={projectId ?? ""} onChange={switchProject}><option value="">New project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.title} · v{item.version ?? 1}</option>)}</select></label>}
        <form onSubmit={generate}>
          <div className="field"><label htmlFor="studio-prompt">What should the game feel like?</label><textarea id="studio-prompt" className="text-area studio-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={4000} minLength={8} placeholder={projectId ? "Tell the studio what to change…" : "Describe the world, the player, the challenge, and what makes it fun…"} required /></div>
          <div className="studio-attachment-box">
            <div className="studio-attachment-heading"><span><FileBox size={13} /> Private asset references</span><small>{selectedAssetIds.length}/6 selected</small></div>
            {selectedAssetIds.length > 0 && <div className="studio-attachment-chips">{selectedAssetIds.map((id) => assetLibrary.find((asset) => asset.id === id)).filter((asset): asset is StudioAsset => Boolean(asset)).map((asset) => <button key={asset.id} type="button" className="studio-attachment-chip" onClick={() => toggleAssetSelection(asset.id)} title="Remove attachment">{asset.filename}<span>×</span></button>)}</div>}
            <div className="studio-attachment-actions"><button className="button button-outline button-small" type="button" onClick={() => { setAssetPickerOpen((open) => !open); if (!assetLibrary.length) void loadAssetLibrary(); }}><FileBox size={12} /> {assetPickerOpen ? "Hide library" : "Attach from library"}</button><Link href="/assets" className="studio-attachment-upload">Upload assets</Link>{projectId && selectedAssetIds.length > 0 && <button className="button button-outline button-small" type="button" onClick={bindSelectedAssets} disabled={bindingSaving || generating || saving || dirty || projectStatus !== "draft"}>{bindingSaving ? <><LoaderCircle size={12} className="spin" /> Saving…</> : "Bind selected · new version"}</button>}</div>
            {assetPickerOpen && <div className="studio-attachment-picker" role="group" aria-label="Choose private assets as prompt references">{assetLibraryLoading ? <span className="studio-attachment-empty">Loading your private library…</span> : assetLibrary.length ? assetLibrary.map((asset) => <button key={asset.id} type="button" className={`studio-attachment-option${selectedAssetIds.includes(asset.id) ? " selected" : ""}`} onClick={() => toggleAssetSelection(asset.id)} disabled={!selectedAssetIds.includes(asset.id) && selectedAssetIds.length >= 6} aria-pressed={selectedAssetIds.includes(asset.id)}><span className="studio-attachment-check">{selectedAssetIds.includes(asset.id) ? <Check size={11} /> : null}</span><span><strong>{asset.filename}</strong><small>{asset.format} · {asset.category}</small></span></button>) : <span className="studio-attachment-empty">No private assets yet. <Link href="/assets">Upload an asset</Link>.</span>}</div>}
            <p>Only selected filenames and validated metadata are sent to the AI provider; file bytes stay private. Selected assets are bound to the generated version. Game code can refer to them with the exact `gameforge-asset://UUID` placeholder, which resolves only in the private preview.</p>
          </div>
          <div className="studio-prompt-examples">{examples.map((example) => <button className="prompt-example" key={example} type="button" onClick={() => setPrompt(example)}>{example.split(" ").slice(0, 3).join(" ")}…</button>)}</div>
          <button className="button button-primary studio-generate-button" type="submit" disabled={generating || saving || !connected || !model}>{generating ? <><LoaderCircle size={15} className="spin" /> Generating game…</> : projectId ? <><WandSparkles size={15} /> Create next version</> : <><Sparkles size={15} /> Generate playable game</>}</button>
        </form>
        {generating && <div className="generation-progress" role="status"><span className="generation-pulse" /><div><strong>Generating with {selectedProvider.name} or configured fallback</strong><small>Quota fallback order is Gemini → Mistral → Groq. Keep this page open.</small></div></div>}
        <p className="studio-note"><LockKeyhole size={11} /> Provider keys stay server-side. On quota/rate limits, GameForge tries Gemini → Mistral → Groq using only providers with usable server keys and models. If fallback is used, your prompt may be sent to another external provider; prompts and responses are subject to that provider’s terms, quota, and data handling. Configure GEMINI_API_KEY, MISTRAL_API_KEY, and GROQ_API_KEY on the server as desired. GameForge also applies its own daily limits.</p>
      </aside>

      <section className={`studio-preview${mobileTab === "preview" ? " mobile-active" : ""}`} aria-label="Game preview">
        <div className="studio-preview-toolbar"><div><span className="status-dot" /> LIVE PREVIEW <span className="studio-preview-separator">/</span> {projectTitle || "Your game will appear here"}</div><div>{version > 0 && <span className="version-label">VERSION {version}</span>}<button className="icon-button" onClick={() => setPreviewKey((value) => value + 1)} disabled={!projectId || version < 1 || previewLoading} aria-label="Refresh preview" title="Refresh preview"><RotateCcw size={14} /></button></div></div>
        <div className="studio-preview-frame">
          {previewLoading ? <div className="studio-preview-empty"><div><LoaderCircle className="spin" size={22} /><p>Opening a short-lived private preview…</p></div></div>
            : previewError ? <div className="studio-preview-empty"><div><div className="studio-empty-spark"><AlertCircle size={21} /></div><h2>Preview needs attention.</h2><p>{previewError}</p></div></div>
              : previewSrc ? <iframe key={`${projectId}-${version}-${previewKey}-${previewSrc}`} title="Isolated preview of your generated game" src={previewSrc} sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads" allow="gamepad" referrerPolicy="no-referrer" />
                : <div className="studio-preview-empty"><div><div className="studio-empty-spark"><Sparkles size={22} /></div><h2>Your next game lives here.</h2><p>Connect one of your AI providers, describe a game, and the playable preview will appear in this restricted browser frame.</p><div className="studio-empty-checks"><span><Check size={12} /> No install step</span><span><Check size={12} /> Private by default</span><span><Check size={12} /> Versioned drafts</span></div></div></div>}
        </div>
        <div className="studio-preview-footer"><span>{files.length ? `${files.length} project files · ${version ? `version ${version}` : "unsaved"}` : "No project loaded"}</span><span className="studio-status">{files.length ? "PATH + SYNTAX CHECKED · NOT RUNTIME TESTED" : "SANDBOX READY"}</span></div>
      </section>

      <aside className={`studio-panel studio-right-panel${mobileTab === "files" ? " mobile-active" : ""}`}>
        <div className="studio-panel-section"><div className="studio-panel-heading">Project files <span>{files.length}</span></div>
          {files.length ? <div className="studio-file-list">{files.map((file) => <button key={file.path} className={`studio-file${activePath === file.path ? " active" : ""}`} onClick={() => { chooseFile(file.path); setMobileTab("files"); }} title={file.path}>{iconForFile(file.path)}<span>{file.path}</span></button>)}</div> : <p className="studio-empty-note">Generated files will be listed here.</p>}
          {activeFile && <div className="studio-editor-wrap"><div className="studio-editor-toolbar"><span>{activePath}</span>{dirty && <span className="dirty-dot">Edited</span>}</div><textarea ref={codeEditorRef} className="studio-code-view studio-code-editor" aria-label={`Edit ${activePath}`} spellCheck={false} value={code} onChange={(event) => { setCode(event.target.value); setDirty(true); }} /><button className="button button-dark button-small studio-save-code" onClick={saveCode} disabled={!dirty || saving}>{saving ? <LoaderCircle size={12} className="spin" /> : <Save size={12} />} Save code as new version</button></div>}
        </div>
        {projectId && <div className="studio-panel-section studio-bound-assets"><div className="studio-panel-heading">Bound private assets <span>{bindingsLoading ? "…" : projectBindings.length}</span></div>
          {projectBindings.length ? <div className="studio-bound-asset-list">{projectBindings.map((asset) => <div className="studio-bound-asset" key={asset.assetId}><div><strong title={asset.filename}>{asset.filename}</strong><small>{asset.format} · {Math.max(1, Math.ceil(asset.sizeBytes / 1024))} KB</small><code>{asset.placeholder}</code>{asset.importSource && <small className="studio-asset-license-note">{asset.importSource.attribution} · <a href={asset.importSource.licenseUrl} target="_blank" rel="noopener noreferrer">{asset.importSource.license}</a></small>}</div><div className="studio-bound-asset-actions"><button className="button button-outline button-small" onClick={() => replaceSelectionWithBoundAsset(asset)} disabled={!activeFile || bindingSaving || generating || saving || projectStatus !== "draft"} title="Replace selected text in the active file, or insert at the caret">Use in code</button><button className="button button-outline button-small" onClick={() => void unbindProjectAsset(asset.assetId)} disabled={bindingSaving || generating || saving || dirty || projectStatus !== "draft"} title="Unbind in a new version; earlier versions retain their binding">Unbind</button></div></div>)}</div>
            : <p className="studio-empty-note">{bindingsLoading ? "Loading version-specific bindings…" : "No private assets are bound to this version. Select assets on the left or bind them from your library."}</p>}
          <p className="studio-asset-binding-note">Select an existing source/URL in the active file, then use an asset’s <strong>Use in code</strong> action to replace it with that bound placeholder (or insert it at the caret). Save code as a new version to persist the edit. A compatible image/audio/model loader is still required; this is guided text replacement, not automatic scene/material authoring. Binding changes leave older versions intact, and public sharing/game submission remain blocked while private bindings or unresolved placeholders exist.</p>
        </div>}
        <div className="studio-panel-section studio-history-section"><div className="studio-panel-heading">Version history <span>{versions.length}</span></div>
          {versions.length ? <div className="studio-history-list">{versions.map((item) => <div className="history-item" key={item.version}><strong>v{item.version} · {item.provider}/{item.model}</strong><span>{item.summary || item.prompt || "Saved project version"}</span><small>{new Date(item.createdAt).toLocaleString()}</small>{item.version !== version && <button onClick={() => restoreVersion(item.version)}><RotateCcw size={10} /> Restore as new version</button>}</div>)}</div> : <p className="studio-empty-note">Each generated or saved change adds a version here.</p>}
        </div>
        {projectId && <div className="studio-panel-section studio-project-settings"><div className="studio-panel-heading"><Settings2 size={13} /> Sharing & remix</div><label className="checkbox-row"><input type="checkbox" checked={allowRemix} onChange={requestRemixing} /> Allow remixing after public approval</label><button className="button button-outline button-small studio-share-review" onClick={async () => { try { const response = await fetch(`/api/ai/projects/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility: "public" }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || "Couldn’t submit project."); if (typeof body.status === "string") setProjectStatus(body.status); setNotice(body.message || "Project submitted to moderation."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t submit project."); } }}>Request public listing</button></div>}
      </aside>
    </div>
    {loadingProject && <div className="studio-loading-overlay" role="status"><LoaderCircle className="spin" size={19} /> Loading project…</div>}
    {initialProjectId && <div className="studio-bottom-link"><Link href="/library"><ArrowLeft size={13} /> Back to your library</Link></div>}
  </div>;
}

function LinkIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 2.93l-1.72 1.72M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21.07l1.71-1.71" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
