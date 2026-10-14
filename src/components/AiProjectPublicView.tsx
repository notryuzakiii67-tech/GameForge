"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowLeft, Code2, GitFork, LoaderCircle, Play, ShieldAlert, Sparkles } from "lucide-react";
import { ReportButton } from "@/components/GameActions";
import type { ProjectFile } from "@/lib/zip";

type Project = { id: string; ownerId: string; title: string; description: string; genre: string; visibility: string; status: string; allowRemix: boolean; sourceProjectId: string | null; creator: { username: string; displayName: string }; canRemix: boolean };

export function AiProjectPublicView({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [version, setVersion] = useState(0);
  const [activePath, setActivePath] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const entry = useMemo(() => files.find((file) => file.path.toLowerCase() === "index.html")?.path ?? files.find((file) => file.path.toLowerCase().endsWith("/index.html"))?.path ?? "index.html", [files]);
  const preview = `/api/ai/projects/${projectId}/versions/${version}/${entry.split("/").map(encodeURIComponent).join("/")}`;

  useEffect(() => {
    let active = true;
    fetch(`/api/ai/projects/${projectId}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "This project isn’t available.");
        if (active) {
          setProject(body.project);
          setFiles(body.latest?.files ?? []);
          setVersion(body.latest?.version ?? 0);
          setActivePath(body.latest?.files?.[0]?.path ?? "");
        }
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "This project isn’t available."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  async function remix() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/ai/projects/${projectId}/remix`, { method: "POST" });
      const body = await response.json();
      if (response.status === 401) { window.location.href = "/auth?mode=login"; return; }
      if (!response.ok) throw new Error(body.error?.message || "Remix couldn’t be created.");
      window.location.href = `/studio/${body.project.id}`;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Remix couldn’t be created."); }
    finally { setBusy(false); }
  }

  async function download() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/ai/projects/${projectId}/export`);
      if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message || "Download failed."); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url; link.download = `gameforge-project-v${version}.zip`; link.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Download failed."); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="page-wrap public-project-loading"><LoaderCircle size={20} className="spin" /> Loading project…</div>;
  if (!project) return <div className="page-wrap page-content"><div className="notice notice-error">{error || "This project isn’t available."}</div><Link href="/ai-gallery" className="button button-outline" style={{ marginTop: 15 }}><ArrowLeft size={13} /> Back to gallery</Link></div>;

  const activeFile = files.find((file) => file.path === activePath);
  return <div className="page-wrap page-content public-project-page">
    <div className="breadcrumb"><Link href="/ai-gallery">AI Gallery</Link><span>/</span><strong>{project.title}</strong></div>
    <div className="public-project-heading"><div><div className="eyebrow"><Sparkles size={13} /> AI-ASSISTED BROWSER GAME <span className="genre-pill">{project.genre}</span></div><h1>{project.title}</h1><p>{project.description || "A creator-built browser game made in GameForge Studio."}</p><div className="developer-meta"><span>by <Link href={`/developers/${project.creator.username}`}>{project.creator.displayName}</Link></span><span>Version {version}</span>{project.sourceProjectId && <span>Remixed from a public project</span>}</div></div><div className="public-project-actions">{project.canRemix && <button className="button button-primary" onClick={remix} disabled={busy}><GitFork size={14} /> {busy ? "Creating copy…" : "Remix this game"}</button>}<button className="button button-dark" onClick={download} disabled={busy}><ArrowDownToLine size={14} /> Download ZIP</button><ReportButton targetId={project.id} targetType="ai_project" /></div></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}{message && <div className="notice notice-success" role="status">{message}</div>}
    <div className="public-project-grid">
      <section className="public-game-preview"><div className="studio-preview-toolbar"><div><span className="status-dot" /> RESTRICTED PREVIEW</div><span className="version-label">VERSION {version}</span></div><div className="public-preview-frame">{files.length ? <iframe title={`${project.title} playable preview`} src={preview} sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads" allow="gamepad" referrerPolicy="no-referrer" /> : <div className="player-placeholder"><Play size={22} /><strong>No playable version was found</strong></div>}</div><div className="public-preview-note"><ShieldAlert size={12} /> Runs with an opaque-origin sandbox. External network access is restricted.</div></section>
      <aside className="public-code-panel"><div className="studio-panel-heading">Project files <span>{files.length}</span></div><div className="studio-file-list public-file-list">{files.map((file) => <button key={file.path} className={`studio-file${activePath === file.path ? " active" : ""}`} onClick={() => setActivePath(file.path)}><Code2 size={13} /><span>{file.path}</span></button>)}</div>{activeFile && <><div className="studio-editor-toolbar">{activePath}</div><pre className="studio-code-view public-code-view"><code>{activeFile.content}</code></pre></>}</aside>
    </div>
    {project.sourceProjectId && <div className="notice notice-info source-attribution"><GitFork size={14} /> This project is a separate remix. <Link href={`/ai-gallery/${project.sourceProjectId}`}>Visit the original ↗</Link></div>}
    <div className="public-project-footer"><Link href="/ai-gallery"><ArrowLeft size={13} /> Back to AI gallery</Link><Link href="/studio"><Sparkles size={13} /> Make something of your own</Link></div>
  </div>;
}
