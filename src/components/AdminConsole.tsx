"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, LoaderCircle, ShieldCheck, ShieldX } from "lucide-react";
import type { PublicUser } from "@/lib/auth";

type Queue = {
  games: { id: string; title: string; slug: string; description: string; genre: string; submittedAt: string; developer: { displayName: string; username: string }; buildVersion: number | null; entryPoint: string; validationStatus: string | null }[];
  projects: { id: string; title: string; description: string; genre: string; submittedAt: string; version: number; creator: { displayName: string; username: string } }[];
  reports: { id: string; target_type: string; target_id: string; reason: string; details: string; createdAt: string; reporterUsername: string; targetTitle: string | null; targetHref: string | null; targetIsDemo: boolean }[];
};
type Tab = "games" | "projects" | "reports";

export function AdminConsole() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [queue, setQueue] = useState<Queue>({ games: [], projects: [], reports: [] });
  const [tab, setTab] = useState<Tab>("games");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => { setUser(body?.user ?? null); setChecked(true); })
      .catch(() => setChecked(true));
  }, []);
  useEffect(() => { if (user && (user.role === "admin" || user.role === "moderator")) void reload(); }, [user]);

  async function reload() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/queue", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Moderation queue unavailable.");
      setQueue({ games: body.games ?? [], projects: body.projects ?? [], reports: body.reports ?? [] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Moderation queue unavailable."); }
    finally { setLoading(false); }
  }

  async function review(
    type: "games" | "projects" | "reports",
    id: string,
    decision: "approve" | "reject" | "actioned" | "dismissed",
    takeDown = false,
  ) {
    if (takeDown && !window.confirm("Hide this reported game or AI project from public listings and playback? Stored files are retained for review.")) return;
    const needsNote = decision === "reject" || decision === "dismissed" || takeDown;
    const reason = needsNote ? (window.prompt(takeDown ? "Required moderation note for the takedown:" : "Optional moderation note:") ?? "") : "";
    if (takeDown && !reason.trim()) { setError("A moderation note is required to take content down."); return; }
    setBusyId(id); setError(""); setNotice("");
    const endpoint = type === "games" ? `/api/admin/games/${id}/decision` : type === "projects" ? `/api/admin/projects/${id}/decision` : `/api/admin/reports/${id}/decision`;
    const body = type === "reports" ? { decision, note: reason, takeDown } : { decision: decision === "approve" ? "approve" : "reject", reason };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Moderation action failed.");
      setNotice(type === "games" ? decision === "approve" ? "Game published." : "Submission rejected." : type === "projects" ? decision === "approve" ? "Public project approved." : "Public listing rejected." : takeDown ? "Content taken down; stored files were retained." : decision === "actioned" ? "Report marked actioned." : "Report dismissed.");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Moderation action failed."); }
    finally { setBusyId(""); }
  }

  if (!checked || (user && (user.role === "admin" || user.role === "moderator") && loading)) return <div className="page-wrap public-project-loading"><LoaderCircle size={18} className="spin" /> {loading ? "Loading moderation queue…" : "Checking administrator access…"}</div>;
  if (!user) return <div className="page-wrap page-content"><div className="notice notice-info">Sign in with an administrator account to access moderation.</div><Link href="/auth?mode=login&next=%2Fadmin" className="button button-primary button-small" style={{ marginTop: 12 }}>Sign in</Link></div>;
  if (user.role !== "admin" && user.role !== "moderator") return <div className="page-wrap page-content"><div className="notice notice-error"><ShieldX size={14} /> Administrator or moderator permissions are required. Access is checked by the server for every operation.</div></div>;
  const counts = { games: queue.games.length, projects: queue.projects.length, reports: queue.reports.length };
  return <div className="page-wrap page-content"><header className="page-header page-header-row"><div><div className="eyebrow"><ShieldCheck size={13} /> MODERATION</div><h1>Keep the arcade welcoming.</h1><p>Review submissions and community reports. Every moderation change is written to the audit log.</p></div><button className="button button-outline button-small" onClick={reload}>Refresh queue</button></header>
    {error && <div className="notice notice-error" role="alert"><AlertCircle size={13} /> {error}</div>}{notice && <div className="notice notice-success" role="status"><Check size={13} /> {notice}</div>}
    <div className="dashboard-stat-row admin-stat-row"><div className="stat-card"><span>Game submissions</span><strong>{counts.games}</strong><small>Waiting for review</small></div><div className="stat-card"><span>AI public listings</span><strong>{counts.projects}</strong><small>Waiting for approval</small></div><div className="stat-card"><span>Open reports</span><strong>{counts.reports}</strong><small>Needs triage</small></div></div>
    <div className="admin-tabs" role="tablist"><button className={tab === "games" ? "active" : ""} onClick={() => setTab("games")}>Game builds · {counts.games}</button><button className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}>AI projects · {counts.projects}</button><button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>Reports · {counts.reports}</button></div>
    {tab === "games" && (queue.games.length ? <div className="moderation-list">{queue.games.map((item) => <article className="moderation-item" key={item.id}><div className="moderation-item-head"><div><h3>{item.title} <span className="genre-pill">{item.genre}</span></h3><p>{item.description || "No description provided."}</p><small>By <Link href={`/developers/${item.developer.username}`}>{item.developer.displayName}</Link> · {new Date(item.submittedAt).toLocaleString()} · Build v{item.buildVersion ?? "?"} · {item.validationStatus ?? "unvalidated"}</small></div><Link className="button button-dark button-small" href={`/api/builds/${item.id}/${item.buildVersion ?? 1}/${item.entryPoint.split("/").map(encodeURIComponent).join("/")}`} target="_blank" rel="noreferrer">Preview build</Link></div><div className="moderation-actions"><button className="button button-primary button-small" onClick={() => review("games", item.id, "approve")} disabled={busyId === item.id}>Approve & publish</button><button className="button button-danger button-small" onClick={() => review("games", item.id, "reject")} disabled={busyId === item.id}>Reject</button></div></article>)}</div> : <div className="empty-state-card"><strong>Game queue is clear</strong><p>New submissions will appear here after a developer uploads and validates a ZIP.</p></div>)}
    {tab === "projects" && (queue.projects.length ? <div className="moderation-list">{queue.projects.map((item) => <article className="moderation-item" key={item.id}><div className="moderation-item-head"><div><h3>{item.title} <span className="genre-pill">{item.genre}</span></h3><p>{item.description || "No description provided."}</p><small>By <Link href={`/developers/${item.creator.username}`}>{item.creator.displayName}</Link> · {new Date(item.submittedAt).toLocaleString()}</small></div><Link className="button button-dark button-small" href={`/api/ai/projects/${item.id}/versions/${item.version}/index.html`} target="_blank" rel="noreferrer">Review preview</Link></div><div className="moderation-actions"><button className="button button-primary button-small" onClick={() => review("projects", item.id, "approve")} disabled={busyId === item.id}>Approve public listing</button><button className="button button-danger button-small" onClick={() => review("projects", item.id, "reject")} disabled={busyId === item.id}>Reject listing</button></div></article>)}</div> : <div className="empty-state-card"><strong>No AI projects awaiting listing</strong><p>Creators can request a public gallery listing from the AI Studio.</p></div>)}
    {tab === "reports" && (queue.reports.length ? <div className="moderation-list">{queue.reports.map((report) => <article className="moderation-item" key={report.id}><div className="moderation-item-head"><div><h3>Report: {report.target_type} · {report.targetTitle || report.target_id} · {report.reason}</h3><p>{report.details || "No additional details."}</p><small>Reported by @{report.reporterUsername} · {new Date(report.createdAt).toLocaleString()} · Target {report.target_id}</small></div>{report.targetHref ? <Link className="button button-dark button-small" href={report.targetHref} target="_blank" rel="noreferrer">Open target</Link> : <span className="moderation-target-missing">Target unavailable</span>}</div><div className="moderation-actions"><button className="button button-primary button-small" onClick={() => review("reports", report.id, "actioned")} disabled={busyId === report.id}>Mark actioned</button>{((report.target_type === "game" && !report.targetIsDemo) || report.target_type === "ai_project") && <button className="button button-danger button-small" onClick={() => review("reports", report.id, "actioned", true)} disabled={busyId === report.id}>Take down & action</button>}<button className="button button-dark button-small" onClick={() => review("reports", report.id, "dismissed")} disabled={busyId === report.id}>Dismiss</button></div></article>)}</div> : <div className="empty-state-card"><strong>No open reports</strong><p>Community reports will appear here.</p></div>)}
    <div className="notice notice-info admin-limit-note">Additional account suspension, appeals, category management, provider configuration, storage analytics, and security event browsing are not included in this Phase 1 console.</div>
  </div>;
}
