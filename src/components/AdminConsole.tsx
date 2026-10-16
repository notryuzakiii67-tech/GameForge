"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, LoaderCircle, ShieldCheck, ShieldX } from "lucide-react";
import type { PublicUser } from "@/lib/auth";

type Queue = {
  games: { id: string; title: string; slug: string; description: string; genre: string; submittedAt: string; developer: { displayName: string; username: string }; buildVersion: number | null; entryPoint: string; validationStatus: string | null }[];
  projects: { id: string; title: string; description: string; genre: string; submittedAt: string; version: number; creator: { displayName: string; username: string } }[];
  assets: { id: string; title: string; description: string; filename: string; format: string; category: string; sizeBytes: number; license: string | null; rightsBasis: string | null; rightsConfirmed: boolean; downloadAuthorized: boolean; attribution: string; submittedAt: string; validationState: string; contentHash: string; creator: { displayName: string; username: string } }[];
  reports: { id: string; target_type: string; target_id: string; reason: string; details: string; createdAt: string; reporterUsername: string; targetTitle: string | null; targetHref: string | null; targetIsDemo: boolean; targetUserId: string | null; targetUserRole: string | null; targetUserStatus: string | null }[];
  appeals: { id: string; assetId: string; explanation: string; createdAt: string; publicationStatus: string; title: string; filename: string; creator: { displayName: string; username: string } }[];
  suspendedUsers: { id: string; username: string; displayName: string; role: string; suspendedAt: string }[];
};
type Tab = "games" | "projects" | "assets" | "appeals" | "reports" | "accounts";

export function AdminConsole() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [queue, setQueue] = useState<Queue>({ games: [], projects: [], assets: [], appeals: [], reports: [], suspendedUsers: [] });
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
      setQueue({ games: body.games ?? [], projects: body.projects ?? [], assets: body.assets ?? [], appeals: body.appeals ?? [], reports: body.reports ?? [], suspendedUsers: body.suspendedUsers ?? [] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Moderation queue unavailable."); }
    finally { setLoading(false); }
  }

  async function review(
    type: "games" | "projects" | "assets" | "reports",
    id: string,
    decision: "approve" | "reject" | "actioned" | "dismissed",
    takeDown = false,
  ) {
    if (takeDown && !window.confirm("Remove this reported item from public access? Stored files are retained for review.")) return;
    const needsNote = decision === "reject" || decision === "dismissed" || takeDown;
    const requiredNote = takeDown || (type === "assets" && decision === "reject");
    const reason = needsNote ? (window.prompt(requiredNote ? "Required moderation note (at least 3 characters):" : "Optional moderation note:") ?? "") : "";
    if (requiredNote && reason.trim().length < 3) { setError("A moderation note of at least 3 characters is required for this action."); return; }
    setBusyId(id); setError(""); setNotice("");
    const endpoint = type === "games" ? `/api/admin/games/${id}/decision` : type === "projects" ? `/api/admin/projects/${id}/decision` : type === "assets" ? `/api/admin/assets/${id}/decision` : `/api/admin/reports/${id}/decision`;
    const body = type === "reports" ? { decision, note: reason, takeDown } : type === "assets" ? { decision: decision === "approve" ? "approve" : "reject", note: reason } : { decision: decision === "approve" ? "approve" : "reject", reason };
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Moderation action failed.");
      setNotice(type === "games" ? decision === "approve" ? "Game published." : "Submission rejected." : type === "projects" ? decision === "approve" ? "Public project approved." : "Public listing rejected." : type === "assets" ? decision === "approve" ? "Asset approved and listed." : "Asset submission rejected." : takeDown ? "Content taken down; stored files were retained." : decision === "actioned" ? "Report marked actioned." : "Report dismissed.");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Moderation action failed."); }
    finally { setBusyId(""); }
  }

  async function reviewAppeal(id: string, decision: "reopen" | "uphold") {
    const note = window.prompt(`Required moderator note for ${decision === "reopen" ? "reopening review" : "upholding the decision"} (at least 3 characters):`) ?? "";
    if (note.trim().length < 3) { setError("A moderation note of at least 3 characters is required."); return; }
    setBusyId(id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/asset-store/appeals/${encodeURIComponent(id)}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Appeal review failed.");
      setNotice(decision === "reopen" ? "Appeal accepted. The asset is back in the standard review queue; it is not public." : "Appeal reviewed; the previous moderation decision stands.");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Appeal review failed."); }
    finally { setBusyId(""); }
  }

  async function moderateAccount(reportId: string, targetUserId: string, suspended: boolean) {
    const decision = suspended ? "restore" : "suspend";
    const label = suspended ? "restore access to" : "suspend";
    if (!window.confirm(`Are you sure you want to ${label} this account? Existing sessions will be revoked when suspended.`)) return;
    const note = window.prompt("Required moderation note (at least 3 characters):") ?? "";
    if (note.trim().length < 3) { setError("A moderation note of at least 3 characters is required."); return; }
    setBusyId(reportId); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/users/${targetUserId}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Account moderation failed.");
      setNotice(suspended ? "Account access restored. The user must sign in again." : "Account suspended and active sessions revoked.");
      await reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Account moderation failed."); }
    finally { setBusyId(""); }
  }

  if (!checked || (user && (user.role === "admin" || user.role === "moderator") && loading)) return <div className="page-wrap public-project-loading"><LoaderCircle size={18} className="spin" /> {loading ? "Loading moderation queue…" : "Checking administrator access…"}</div>;
  if (!user) return <div className="page-wrap page-content"><div className="notice notice-info">Sign in with an administrator account to access moderation.</div><Link href="/auth?mode=login&next=%2Fadmin" className="button button-primary button-small" style={{ marginTop: 12 }}>Sign in</Link></div>;
  if (user.role !== "admin" && user.role !== "moderator") return <div className="page-wrap page-content"><div className="notice notice-error"><ShieldX size={14} /> Administrator or moderator permissions are required. Access is checked by the server for every operation.</div></div>;
  const counts = { games: queue.games.length, projects: queue.projects.length, assets: queue.assets.length, appeals: queue.appeals.length, reports: queue.reports.length };
  return <div className="page-wrap page-content"><header className="page-header page-header-row"><div><div className="eyebrow"><ShieldCheck size={13} /> MODERATION</div><h1>Keep the arcade welcoming.</h1><p>Review submissions and community reports. Every moderation change is written to the audit log.</p></div><button className="button button-outline button-small" onClick={reload}>Refresh queue</button></header>
    {error && <div className="notice notice-error" role="alert"><AlertCircle size={13} /> {error}</div>}{notice && <div className="notice notice-success" role="status"><Check size={13} /> {notice}</div>}
    <div className="dashboard-stat-row admin-stat-row"><div className="stat-card"><span>Game submissions</span><strong>{counts.games}</strong><small>Waiting for review</small></div><div className="stat-card"><span>AI public listings</span><strong>{counts.projects}</strong><small>Waiting for approval</small></div><div className="stat-card"><span>Asset Store submissions</span><strong>{counts.assets}</strong><small>Rights review required</small></div><div className="stat-card"><span>Asset appeals</span><strong>{counts.appeals}</strong><small>Need review</small></div><div className="stat-card"><span>Open reports</span><strong>{counts.reports}</strong><small>Needs triage</small></div></div>
    <div className="admin-tabs" role="tablist"><button className={tab === "games" ? "active" : ""} onClick={() => setTab("games")}>Game builds · {counts.games}</button><button className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}>AI projects · {counts.projects}</button><button className={tab === "assets" ? "active" : ""} onClick={() => setTab("assets")}>Assets · {counts.assets}</button><button className={tab === "appeals" ? "active" : ""} onClick={() => setTab("appeals")}>Asset appeals · {counts.appeals}</button><button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")}>Reports · {counts.reports}</button>{user.role === "admin" && <button className={tab === "accounts" ? "active" : ""} onClick={() => setTab("accounts")}>Suspended accounts · {queue.suspendedUsers.length}</button>}</div>
    {tab === "games" && (queue.games.length ? <div className="moderation-list">{queue.games.map((item) => <article className="moderation-item" key={item.id}><div className="moderation-item-head"><div><h3>{item.title} <span className="genre-pill">{item.genre}</span></h3><p>{item.description || "No description provided."}</p><small>By <Link href={`/developers/${item.developer.username}`}>{item.developer.displayName}</Link> · {new Date(item.submittedAt).toLocaleString()} · Build v{item.buildVersion ?? "?"} · {item.validationStatus ?? "unvalidated"}</small></div><Link className="button button-dark button-small" href={`/api/builds/${item.id}/${item.buildVersion ?? 1}/${item.entryPoint.split("/").map(encodeURIComponent).join("/")}`} target="_blank" rel="noreferrer">Preview build</Link></div><div className="moderation-actions"><button className="button button-primary button-small" onClick={() => review("games", item.id, "approve")} disabled={busyId === item.id}>Approve & publish</button><button className="button button-danger button-small" onClick={() => review("games", item.id, "reject")} disabled={busyId === item.id}>Reject</button></div></article>)}</div> : <div className="empty-state-card"><strong>Game queue is clear</strong><p>New submissions will appear here after a developer uploads and validates a ZIP.</p></div>)}
    {tab === "projects" && (queue.projects.length ? <div className="moderation-list">{queue.projects.map((item) => <article className="moderation-item" key={item.id}><div className="moderation-item-head"><div><h3>{item.title} <span className="genre-pill">{item.genre}</span></h3><p>{item.description || "No description provided."}</p><small>By <Link href={`/developers/${item.creator.username}`}>{item.creator.displayName}</Link> · {new Date(item.submittedAt).toLocaleString()}</small></div><Link className="button button-dark button-small" href={`/api/ai/projects/${item.id}/versions/${item.version}/index.html`} target="_blank" rel="noreferrer">Review preview</Link></div><div className="moderation-actions"><button className="button button-primary button-small" onClick={() => review("projects", item.id, "approve")} disabled={busyId === item.id}>Approve public listing</button><button className="button button-danger button-small" onClick={() => review("projects", item.id, "reject")} disabled={busyId === item.id}>Reject listing</button></div></article>)}</div> : <div className="empty-state-card"><strong>No AI projects awaiting listing</strong><p>Creators can request a public gallery listing from the AI Studio.</p></div>)}
    {tab === "assets" && (queue.assets.length ? <div className="moderation-list">{queue.assets.map((asset) => <article className="moderation-item" key={asset.id}><div className="moderation-item-head"><div><h3>{asset.title} <span className="genre-pill">{asset.category} · {asset.format}</span></h3><p>{asset.description || "No public description provided."}</p><small>File {asset.filename} · {Math.ceil(asset.sizeBytes / 1024)} KB · By <Link href={`/developers/${asset.creator.username}`}>{asset.creator.displayName}</Link> · Submitted {new Date(asset.submittedAt).toLocaleString()}</small><div className="asset-review-facts"><strong>License:</strong> {asset.license ?? "missing"} · <strong>Rights basis:</strong> {asset.rightsBasis ?? "missing"}<br /><strong>Attribution:</strong> {asset.attribution || "missing"}<br /><strong>Declarations:</strong> rights {asset.rightsConfirmed ? "confirmed" : "missing"}, public downloads {asset.downloadAuthorized ? "authorized" : "missing"} · <strong>Validation:</strong> {asset.validationState}<br /><strong>SHA-256:</strong> {asset.contentHash}</div></div><Link className="button button-dark button-small" href={`/api/admin/assets/${asset.id}/download`} target="_blank" rel="noreferrer">Download for review</Link></div><div className="moderation-actions"><button className="button button-primary button-small" onClick={() => review("assets", asset.id, "approve")} disabled={busyId === asset.id}>Approve & publish</button><button className="button button-danger button-small" onClick={() => review("assets", asset.id, "reject")} disabled={busyId === asset.id}>Reject with note</button></div></article>)}</div> : <div className="empty-state-card"><strong>No assets awaiting review</strong><p>Only owner-submitted assets with rights and download declarations appear here. Approval is required before public listing or download.</p></div>)}
    {tab === "appeals" && (queue.appeals.length ? <div className="moderation-list">{queue.appeals.map((appeal) => <article className="moderation-item" key={appeal.id}><div className="moderation-item-head"><div><h3>{appeal.title} <span className="genre-pill">{appeal.publicationStatus}</span></h3><p>{appeal.explanation}</p><small>File {appeal.filename} · By <Link href={`/developers/${appeal.creator.username}`}>{appeal.creator.displayName}</Link> · Appealed {new Date(appeal.createdAt).toLocaleString()}</small><p className="asset-review-facts">An accepted appeal returns the asset to the normal pending-review queue; it does not publish the file automatically.</p></div><Link className="button button-dark button-small" href={`/api/admin/assets/${encodeURIComponent(appeal.assetId)}/download`} target="_blank" rel="noreferrer">Review attachment</Link></div><div className="moderation-actions"><button className="button button-primary button-small" onClick={() => reviewAppeal(appeal.id, "reopen")} disabled={busyId === appeal.id}>Reopen for review</button><button className="button button-danger button-small" onClick={() => reviewAppeal(appeal.id, "uphold")} disabled={busyId === appeal.id}>Uphold decision</button></div></article>)}</div> : <div className="empty-state-card"><strong>No open Asset Store appeals</strong><p>Owner appeals for rejected or removed assets appear here. Reopened items return to standard review and remain private until approved.</p></div>)}
    {tab === "reports" && (queue.reports.length ? <div className="moderation-list">{queue.reports.map((report) => <article className="moderation-item" key={report.id}><div className="moderation-item-head"><div><h3>Report: {report.target_type} · {report.targetTitle || report.target_id} · {report.reason}</h3><p>{report.details || "No additional details."}</p><small>Reported by @{report.reporterUsername} · {new Date(report.createdAt).toLocaleString()} · Target {report.target_id}</small></div><div className="moderation-target-actions">{report.target_type === "asset" && <Link className="button button-dark button-small" href={`/api/admin/assets/${encodeURIComponent(report.target_id)}/download`} target="_blank" rel="noreferrer">Review attachment</Link>}{report.targetHref ? <Link className="button button-dark button-small" href={report.targetHref} target="_blank" rel="noreferrer">Open target</Link> : <span className="moderation-target-missing">Target unavailable</span>}</div></div><div className="moderation-actions"><button className="button button-primary button-small" onClick={() => review("reports", report.id, "actioned")} disabled={busyId === report.id}>Mark actioned</button>{((report.target_type === "game" && !report.targetIsDemo) || report.target_type === "ai_project" || report.target_type === "asset") && <button className="button button-danger button-small" onClick={() => review("reports", report.id, "actioned", true)} disabled={busyId === report.id}>Take down & action</button>}{user.role === "admin" && report.target_type === "user" && report.targetUserId && report.targetUserId !== user.id && (report.targetUserStatus === "active" || report.targetUserStatus === "suspended") && <button className={`button button-small ${report.targetUserStatus === "suspended" ? "button-dark" : "button-danger"}`} onClick={() => moderateAccount(report.id, report.targetUserId!, report.targetUserStatus === "suspended")} disabled={busyId === report.id}>{report.targetUserStatus === "suspended" ? "Restore account" : "Suspend account"}</button>}<button className="button button-dark button-small" onClick={() => review("reports", report.id, "dismissed")} disabled={busyId === report.id}>Dismiss</button></div></article>)}</div> : <div className="empty-state-card"><strong>No open reports</strong><p>Community reports will appear here.</p></div>)}
    {tab === "accounts" && user.role === "admin" && (queue.suspendedUsers.length ? <div className="moderation-list">{queue.suspendedUsers.map((account) => <article className="moderation-item" key={account.id}><div className="moderation-item-head"><div><h3>{account.displayName} <span className="genre-pill">{account.role}</span></h3><p>@{account.username}</p><small>Suspended {new Date(account.suspendedAt).toLocaleString()}</small></div><button className="button button-primary button-small" onClick={() => moderateAccount(account.id, account.id, true)} disabled={busyId === account.id}>Restore account</button></div></article>)}</div> : <div className="empty-state-card"><strong>No suspended accounts</strong><p>Users suspended by a site administrator will appear here.</p></div>)}
    <div className="notice notice-info admin-limit-note">Category management, provider configuration, storage analytics, and security event browsing are not included in this Phase 1 console. Account suspension and restoration are restricted to site administrators and require an audit note.</div>
  </div>;
}
