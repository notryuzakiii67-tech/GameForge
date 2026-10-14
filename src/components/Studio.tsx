"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowDownToLine, ArrowLeft, Check, ChevronRight, Code2, Eye, EyeOff, FileCode2, FileJson2,
  FileText, LoaderCircle, LockKeyhole, RotateCcw, Save, Send, Settings2, Sparkles, WandSparkles,
} from "lucide-react";
import { genres } from "@/lib/demo-games";
import type { PublicUser } from "@/lib/auth";
import type { AiProvider, ProviderModel } from "@/lib/ai/providers";
import type { ProjectFile } from "@/lib/zip";

type ProjectSummary = { id: string; title: string; description: string; status: string; visibility: string; version: number | null; summary: string | null; allowRemix?: boolean };
type VersionSummary = { version: number; prompt: string; provider: string; model: string; summary: string; createdAt: string };
type ErrorBody = { error?: { code?: string; message?: string; retryAfter?: number } };

const providerOptions: { id: AiProvider; name: string; info: string; keyUrl: string; short: string }[] = [
  { id: "gemini", name: "Google Gemini", short: "Gemini", info: "Use a Gemini API key from Google AI Studio. Availability and quotas are set by Google.", keyUrl: "https://aistudio.google.com/app/apikey" },
  { id: "mistral", name: "Mistral", short: "Mistral", info: "Connect a Mistral API key. Your account controls its model access and usage.", keyUrl: "https://console.mistral.ai/api-keys/" },
  { id: "groq", name: "Groq", short: "Groq", info: "Use a Groq API key for inference. Check your provider console for current model availability.", keyUrl: "https://console.groq.com/keys" },
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
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
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
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [activePath, setActivePath] = useState("");
  const [code, setCode] = useState("");
  const [version, setVersion] = useState(0);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [publishStatus, setPublishStatus] = useState("");
  const [allowRemix, setAllowRemix] = useState(false);
  const [mobileTab, setMobileTab] = useState<"prompt" | "preview" | "files">("preview");
  const [dirty, setDirty] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const selectedProvider = providerOptions.find((item) => item.id === provider)!;
  const indexPath = useMemo(() => files.find((file) => file.path.toLowerCase() === "index.html")?.path ?? files.find((file) => file.path.toLowerCase().endsWith("/index.html"))?.path ?? "index.html", [files]);
  const previewSrc = projectId && version ? `/api/ai/projects/${projectId}/versions/${version}/${indexPath.split("/").map(encodeURIComponent).join("/")}?v=${version}` : "";
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

  async function loadProjects() {
    try {
      const response = await fetch("/api/ai/projects", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) setProjects(data.projects ?? []);
    } catch { /* The project list can be retried after login or a network recovery. */ }
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
      setAllowRemix(Boolean(data.project.allowRemix));
      setGameType(data.project.genre ?? "Experimental");
      setFiles(nextFiles);
      setVersion(data.latest?.version ?? 0);
      setActivePath(nextFiles[0]?.path ?? "");
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
    setApiKey("");
    setModels([]);
    setModel("");
    setConnected(false);
    setError("");
  }

  async function connectProvider() {
    setError("");
    setNotice("");
    if (!apiKey.trim()) { setError("Enter your provider API key first."); return; }
    setLoadingModels(true);
    setConnected(false);
    try {
      const response = await fetch("/api/ai/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, apiKey }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Provider connection failed.");
      const available = Array.isArray(body.models) ? body.models as ProviderModel[] : [];
      setModels(available);
      setModel((current) => available.some((item) => item.id === current) ? current : available[0]?.id ?? "");
      setConnected(true);
      setNotice(`${body.providerName} responded. ${available.length} models are available for this key.`);
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
        body: JSON.stringify({ provider, model, apiKey, prompt: prompt.trim(), gameType, ...(projectId ? { projectId } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Generation failed. Your previous versions are unchanged.");
      const nextFiles = body.version.files as ProjectFile[];
      setProjectId(body.project.id);
      setProjectTitle(body.project.title);
      setProjectDescription(body.project.description);
      setFiles(nextFiles);
      setVersion(body.version.number);
      setActivePath(nextFiles.find((file) => file.path.toLowerCase().endsWith(".html"))?.path ?? nextFiles[0]?.path ?? "");
      setDirty(false);
      setNotice(`Version ${body.version.number} saved. ${body.note}`);
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
    setFiles([]);
    setActivePath("");
    setCode("");
    setVersion(0);
    setVersions([]);
    setDirty(false);
    setNotice("Ready for a new private draft.");
  }

  if (authLoading) return <div className="page-wrap studio-page"><div className="studio-loading panel-card"><LoaderCircle className="spin" size={20} /> Opening your studio…</div></div>;
  if (!user) return <div className="page-wrap page-content"><header className="page-header"><div className="eyebrow"><Sparkles size={13} /> AI GAME STUDIO</div><h1>Make something playable.</h1><p>Use your own AI provider key to generate browser-ready games, iterate on the code, and publish approved builds.</p></header><div className="studio-auth-gate panel-card"><span className="studio-auth-icon"><LockKeyhole size={23} /></span><h2>Sign in to create</h2><p>AI projects and version history are private to your account. Provider keys stay in this browser session and are sent only with the request you initiate.</p><Link href="/auth?mode=login" className="button button-primary">Sign in to GameForge <ChevronRight size={15} /></Link><Link href="/auth?mode=register" className="auth-switch">New here? Create an account</Link></div></div>;

  return <div className="page-wrap studio-page page-content">
    <div className="studio-topbar">
      <div className="studio-topbar-title"><Link href="/" className="studio-back" aria-label="Back home"><ArrowLeft size={15} /></Link><div><h1>AI Studio</h1><span>{projectId ? projectTitle || "Untitled project" : "A playable idea starts with a prompt"}</span></div>{projectId && <span className="status-badge status-draft">Saved draft · v{version}</span>}</div>
      <div className="studio-top-actions">
        {projectId && <><button className="button button-dark button-small" onClick={copyProjectLink} title="Copy a private link"><LinkIcon /> Share</button><button className="button button-dark button-small" onClick={exportZip}><ArrowDownToLine size={13} /> ZIP</button><button className="button button-primary button-small" onClick={submitForReview} disabled={!files.length || generating || saving}><Send size={13} /> Publish</button></>}
      </div>
    </div>
    {error && <div className="notice notice-error studio-notice" role="alert"><AlertCircle size={14} /> {error}</div>}
    {notice && !error && <div className="notice notice-success studio-notice" role="status"><Check size={14} /> {notice}</div>}
    {publishStatus && <div className="notice notice-info studio-notice" role="status">{publishStatus}</div>}
    <div className="studio-mobile-tabs"><button className={mobileTab === "prompt" ? "active" : ""} onClick={() => setMobileTab("prompt")}>Prompt</button><button className={mobileTab === "preview" ? "active" : ""} onClick={() => setMobileTab("preview")}>Preview</button><button className={mobileTab === "files" ? "active" : ""} onClick={() => setMobileTab("files")}>Files & history</button></div>
    <div className="studio-layout">
      <aside className={`studio-panel studio-left-panel${mobileTab === "prompt" ? " mobile-active" : ""}`}>
        <div className="studio-panel-heading">Start with an idea <span>BYOK · private</span></div>
        <label className="field"><span className="field-label">AI provider</span><select className="select-input" value={provider} onChange={(event) => changeProvider(event.target.value as AiProvider)}>{providerOptions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <div className="field"><label htmlFor="provider-key">Provider API key</label><div className="studio-key-input"><input id="provider-key" className="text-input" type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => { setApiKey(event.target.value); setConnected(false); setModels([]); setModel(""); }} placeholder="Paste your key for this session" /><button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "Hide API key" : "Show API key"}>{showKey ? <EyeOff size={14} /> : <Eye size={14} />}</button></div><small>Never saved or logged. <a href={selectedProvider.keyUrl} target="_blank" rel="noreferrer">Get a key ↗</a></small></div>
        <button className="button button-outline button-small provider-connect" onClick={connectProvider} disabled={loadingModels || !apiKey.trim()}>{loadingModels ? <><LoaderCircle size={13} className="spin" /> Checking key…</> : connected ? <><Check size={13} /> Connected · refresh models</> : "Check connection & load models"}</button>
        <div className="studio-connection-status" role="status"><span className={`provider-indicator${connected ? " connected" : ""}`} />{connected ? `${selectedProvider.short} replied · quota is set by provider` : "Provider connection not checked"}</div>
        <p className="studio-provider-explanation">{selectedProvider.info}</p>
        <div className="studio-model-grid"><label className="field"><span className="field-label">Model</span><select className="select-input" value={model} onChange={(event) => setModel(event.target.value)} disabled={!models.length}><option value="">{models.length ? "Choose a model" : "Check provider first"}</option>{models.map((available) => <option key={available.id} value={available.id}>{available.displayName} · {available.id}</option>)}</select></label><label className="field"><span className="field-label">Game type</span><select className="select-input" value={gameType} onChange={(event) => setGameType(event.target.value)}>{genres.map((genre) => <option value={genre} key={genre}>{genre}</option>)}</select></label></div>
        {projects.length > 0 && <label className="field saved-project-select"><span className="field-label">Your saved projects</span><select className="select-input" value={projectId ?? ""} onChange={switchProject}><option value="">New project</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.title} · v{item.version ?? 1}</option>)}</select></label>}
        <form onSubmit={generate}>
          <div className="field"><label htmlFor="studio-prompt">What should the game feel like?</label><textarea id="studio-prompt" className="text-area studio-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={4000} minLength={8} placeholder={projectId ? "Tell the studio what to change…" : "Describe the world, the player, the challenge, and what makes it fun…"} required /></div>
          <div className="studio-prompt-examples">{examples.map((example) => <button className="prompt-example" key={example} type="button" onClick={() => setPrompt(example)}>{example.split(" ").slice(0, 3).join(" ")}…</button>)}</div>
          <button className="button button-primary studio-generate-button" type="submit" disabled={generating || saving || !connected || !model}>{generating ? <><LoaderCircle size={15} className="spin" /> Asking {selectedProvider.short}…</> : projectId ? <><WandSparkles size={15} /> Create next version</> : <><Sparkles size={15} /> Generate playable game</>}</button>
        </form>
        {generating && <div className="generation-progress" role="status"><span className="generation-pulse" /><div><strong>Waiting for {selectedProvider.name}</strong><small>Generation runs on your selected provider. Please keep this page open.</small></div></div>}
        <p className="studio-note"><LockKeyhole size={11} /> Your key is sent over HTTPS for this request only and discarded. Provider quotas and charges are governed by your provider account. GameForge applies its own daily limits.</p>
      </aside>

      <section className={`studio-preview${mobileTab === "preview" ? " mobile-active" : ""}`} aria-label="Game preview">
        <div className="studio-preview-toolbar"><div><span className="status-dot" /> LIVE PREVIEW <span className="studio-preview-separator">/</span> {projectTitle || "Your game will appear here"}</div><div>{version > 0 && <span className="version-label">VERSION {version}</span>}<button className="icon-button" onClick={() => setPreviewKey((value) => value + 1)} disabled={!previewSrc} aria-label="Refresh preview" title="Refresh preview"><RotateCcw size={14} /></button></div></div>
        <div className="studio-preview-frame">
          {previewSrc ? <iframe key={`${projectId}-${version}-${previewKey}`} title="Isolated preview of your generated game" src={previewSrc} sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads" allow="gamepad" referrerPolicy="no-referrer" /> : <div className="studio-preview-empty"><div><div className="studio-empty-spark"><Sparkles size={22} /></div><h2>Your next game lives here.</h2><p>Connect one of your AI providers, describe a game, and the playable preview will appear in this restricted browser frame.</p><div className="studio-empty-checks"><span><Check size={12} /> No install step</span><span><Check size={12} /> Private by default</span><span><Check size={12} /> Versioned drafts</span></div></div></div>}
        </div>
        <div className="studio-preview-footer"><span>{files.length ? `${files.length} project files · ${version ? `version ${version}` : "unsaved"}` : "No project loaded"}</span><span className="studio-status">{files.length ? "PATH + SYNTAX CHECKED · NOT RUNTIME TESTED" : "SANDBOX READY"}</span></div>
      </section>

      <aside className={`studio-panel studio-right-panel${mobileTab === "files" ? " mobile-active" : ""}`}>
        <div className="studio-panel-section"><div className="studio-panel-heading">Project files <span>{files.length}</span></div>
          {files.length ? <div className="studio-file-list">{files.map((file) => <button key={file.path} className={`studio-file${activePath === file.path ? " active" : ""}`} onClick={() => { chooseFile(file.path); setMobileTab("files"); }} title={file.path}>{iconForFile(file.path)}<span>{file.path}</span></button>)}</div> : <p className="studio-empty-note">Generated files will be listed here.</p>}
          {activeFile && <div className="studio-editor-wrap"><div className="studio-editor-toolbar"><span>{activePath}</span>{dirty && <span className="dirty-dot">Edited</span>}</div><textarea className="studio-code-view studio-code-editor" aria-label={`Edit ${activePath}`} spellCheck={false} value={code} onChange={(event) => { setCode(event.target.value); setDirty(true); }} /><button className="button button-dark button-small studio-save-code" onClick={saveCode} disabled={!dirty || saving}>{saving ? <LoaderCircle size={12} className="spin" /> : <Save size={12} />} Save code as new version</button></div>}
        </div>
        <div className="studio-panel-section studio-history-section"><div className="studio-panel-heading">Version history <span>{versions.length}</span></div>
          {versions.length ? <div className="studio-history-list">{versions.map((item) => <div className="history-item" key={item.version}><strong>v{item.version} · {item.provider}/{item.model}</strong><span>{item.summary || item.prompt || "Saved project version"}</span><small>{new Date(item.createdAt).toLocaleString()}</small>{item.version !== version && <button onClick={() => restoreVersion(item.version)}><RotateCcw size={10} /> Restore as new version</button>}</div>)}</div> : <p className="studio-empty-note">Each generated or saved change adds a version here.</p>}
        </div>
        {projectId && <div className="studio-panel-section studio-project-settings"><div className="studio-panel-heading"><Settings2 size={13} /> Sharing & remix</div><label className="checkbox-row"><input type="checkbox" checked={allowRemix} onChange={requestRemixing} /> Allow remixing after public approval</label><button className="button button-outline button-small studio-share-review" onClick={async () => { try { const response = await fetch(`/api/ai/projects/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visibility: "public" }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || "Couldn’t submit project."); setNotice(body.message || "Project submitted to moderation."); } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t submit project."); } }}>Request public listing</button></div>}
      </aside>
    </div>
    {loadingProject && <div className="studio-loading-overlay" role="status"><LoaderCircle className="spin" size={19} /> Loading project…</div>}
    {initialProjectId && <div className="studio-bottom-link"><Link href="/library"><ArrowLeft size={13} /> Back to your library</Link></div>}
  </div>;
}

function LinkIcon() { return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3A5 5 0 0 0 13 2.93l-1.72 1.72M14 11a5 5 0 0 0-7.07 0l-3 3A5 5 0 0 0 11 21.07l1.71-1.71" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
