"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight, ArrowUpRight, Check, ChevronRight, CirclePlus, Code2, FileArchive, Gamepad2, LoaderCircle,
  PenLine, Rocket, Settings2, Sparkles, Upload, UserRound, WandSparkles,
} from "lucide-react";
import { genres } from "@/lib/demo-games";
import type { PublicUser } from "@/lib/auth";

type GameRecord = { id: string; title: string; slug: string; description: string; genre: string; tags: string[]; status: string; controls: string; instructions: string; remixEnabled: boolean; license: GameFormState["license"]; entryPoint: string; updatedAt: string; publishedAt: string | null; version: string; hasBuild: boolean };
type AIProject = { id: string; title: string; description: string; status: string; visibility: string; updatedAt: string; version: number | null };
type StudioProfile = { studioName: string; description: string; website: string | null; verificationStatus?: string };
type GameFormState = { title: string; description: string; genre: string; tags: string; controls: string; instructions: string; remixEnabled: boolean; license: "all-rights-reserved" | "cc-by-4.0" | "cc-by-sa-4.0" | "cc0-1.0" };
const emptyGame: GameFormState = { title: "", description: "", genre: "Arcade", tags: "", controls: "", instructions: "", remixEnabled: false, license: "all-rights-reserved" };

type ApiPayload = { message?: string; error?: { message?: string }; game?: { title?: string }; version?: number; profile?: StudioProfile };
async function apiMessage(response: Response): Promise<ApiPayload> { try { return await response.json() as ApiPayload; } catch { return {}; } }

export function Dashboard() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [games, setGames] = useState<GameRecord[]>([]);
  const [projects, setProjects] = useState<AIProject[]>([]);
  const [profile, setProfile] = useState<StudioProfile | null>(null);
  const [profileForm, setProfileForm] = useState({ studioName: "", description: "", website: "" });
  const [tab, setTab] = useState<"overview" | "games" | "profile" | "settings">("overview");
  const [gameFormOpen, setGameFormOpen] = useState(false);
  const [editingGame, setEditingGame] = useState<GameRecord | null>(null);
  const [gameForm, setGameForm] = useState<GameFormState>(emptyGame);
  const [busy, setBusy] = useState(false);
  const [workingId, setWorkingId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => { const body = response.ok ? await response.json() : null; if (active) { setUser(body?.user ?? null); setAuthLoading(false); } })
      .catch(() => { if (active) setAuthLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadData();
  // A new signed-in account should load its dashboard once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const published = useMemo(() => games.filter((game) => game.status === "published").length, [games]);
  const drafts = useMemo(() => games.filter((game) => game.status === "draft" || game.status === "rejected").length, [games]);

  async function loadData() {
    setError("");
    try {
      const [gamesResponse, projectsResponse, profileResponse] = await Promise.all([
        fetch("/api/me/games", { cache: "no-store" }),
        fetch("/api/ai/projects", { cache: "no-store" }),
        fetch("/api/developer/profile", { cache: "no-store" }),
      ]);
      const [gamesBody, projectsBody, profileBody] = await Promise.all([gamesResponse.json(), projectsResponse.json(), profileResponse.json()]);
      if (!gamesResponse.ok) throw new Error(gamesBody.error?.message || "Your projects couldn’t be loaded.");
      setGames(gamesBody.games ?? []);
      setProjects(projectsResponse.ok ? projectsBody.projects ?? [] : []);
      if (profileResponse.ok) {
        setProfile(profileBody.profile);
        if (profileBody.profile) setProfileForm({ studioName: profileBody.profile.studioName, description: profileBody.profile.description, website: profileBody.profile.website || "" });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Dashboard data couldn’t be loaded."); }
  }

  async function saveGame(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const payload = { ...gameForm, tags: gameForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean) };
    try {
      const response = editingGame
        ? await fetch(`/api/games/${editingGame.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await apiMessage(response);
      if (!response.ok) throw new Error(body.error?.message || "The game project couldn’t be saved.");
      setGameForm(emptyGame);
      setGameFormOpen(false);
      setEditingGame(null);
      setMessage(editingGame ? "Draft details saved." : `Draft created: ${body.game?.title ?? gameForm.title}. Upload a ZIP build to continue.`);
      await loadData();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The game project couldn’t be saved."); }
    finally { setBusy(false); }
  }

  function editGame(game: GameRecord) {
    setEditingGame(game);
    setGameForm({ title: game.title, description: game.description, genre: game.genre, tags: game.tags.join(", "), controls: game.controls, instructions: game.instructions, remixEnabled: game.remixEnabled, license: game.license });
    setGameFormOpen(true);
    setTab("games");
  }

  async function uploadBuild(game: GameRecord, file?: File) {
    if (!file) return;
    setWorkingId(game.id);
    setError("");
    setMessage("");
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch(`/api/games/${game.id}/upload`, { method: "POST", body: form });
      const body = await apiMessage(response);
      if (!response.ok) throw new Error(body.error?.message || "The build could not be uploaded.");
      setMessage(`Build v${(body as { version?: number }).version ?? ""} passed ZIP structure and entry-point validation. It has not been executed or malware-scanned.`);
      await loadData();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The build could not be uploaded."); }
    finally { setWorkingId(""); }
  }

  async function submitGame(game: GameRecord) {
    setWorkingId(game.id);
    setError(""); setMessage("");
    try {
      const response = await fetch(`/api/games/${game.id}/submit`, { method: "POST" });
      const body = await apiMessage(response);
      if (!response.ok) throw new Error(body.error?.message || "The submission could not be sent.");
      setMessage(body.message || "Game submitted for review.");
      await loadData();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The submission could not be sent."); }
    finally { setWorkingId(""); }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/developer/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profileForm) });
      const body = await apiMessage(response);
      if (!response.ok) throw new Error(body.error?.message || "The developer profile couldn’t be saved.");
      setProfile(body.profile ?? null);
      setMessage("Developer profile saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The developer profile couldn’t be saved."); }
    finally { setBusy(false); }
  }

  if (authLoading) return <div className="page-wrap page-content dashboard-loading"><LoaderCircle size={18} className="spin" /> Loading your dashboard…</div>;
  if (!user) return <div className="page-wrap page-content"><header className="page-header"><div className="eyebrow"><Rocket size={13} /> CREATOR TOOLS</div><h1>Your next release starts here.</h1><p>Sign in to draft a browser game, upload a build, create a developer profile, and request moderation.</p></header><div className="dashboard-auth-gate panel-card"><Gamepad2 size={25} /><h2>Creator dashboard</h2><p>Your drafts and analytics belong to your account. Sign in or create a free account to continue.</p><Link className="button button-primary" href="/auth?mode=login&next=%2Fdashboard">Sign in to continue <ChevronRight size={14} /></Link></div></div>;

  return <div className="page-wrap page-content">
    <header className="page-header page-header-row"><div><div className="eyebrow"><Rocket size={13} /> CREATOR DASHBOARD</div><h1>Good to see you, {user.displayName.split(" ")[0]}.</h1><p>Make a new draft, keep your projects organized, and bring your next browser game to life.</p></div><Link className="button button-primary" href="/studio"><WandSparkles size={15} /> Create with AI <ArrowRight size={14} /></Link></header>
    {error && <div className="notice notice-error dashboard-notice" role="alert">{error}</div>}{message && <div className="notice notice-success dashboard-notice" role="status"><Check size={13} /> {message}</div>}
    <div className="dashboard-layout">
      <nav className="dashboard-sidebar" aria-label="Creator dashboard sections"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}><Gamepad2 size={15} /> Overview</button><button className={tab === "games" ? "active" : ""} onClick={() => setTab("games")}><Code2 size={15} /> Game projects</button><button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}><UserRound size={15} /> Developer profile</button><button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings2 size={15} /> Settings & API keys</button><Link href="/library"><Sparkles size={15} /> AI project library</Link></nav>
      <section className="dashboard-main">
        {tab === "overview" && <>
          <div className="dashboard-title-row"><div><h2>Studio overview</h2><p>Your project status at a glance. Counts are from your saved projects.</p></div><button className="button button-outline button-small" onClick={() => { setTab("games"); setGameFormOpen(true); setEditingGame(null); setGameForm(emptyGame); }}><CirclePlus size={13} /> New game draft</button></div>
          <div className="dashboard-stat-row"><div className="stat-card"><span>Game projects</span><strong>{games.length}</strong><small>All statuses</small></div><div className="stat-card"><span>Published</span><strong>{published}</strong><small>Public and approved</small></div><div className="stat-card"><span>Drafts to finish</span><strong>{drafts}</strong><small>Draft or needs changes</small></div></div>
          <div className="dashboard-title-row"><div><h2>Recent projects</h2><p>Pick up where you left off.</p></div><button className="text-link button-as-link" onClick={() => setTab("games")}>View all <ArrowRight size={13} /></button></div>
          <div className="project-list">{games.slice(0, 5).map((game) => <GameProjectRow key={game.id} game={game} working={workingId === game.id} onUpload={uploadBuild} onSubmit={submitGame} onEdit={editGame} />)}{!games.length && <div className="empty-state-card"><span className="empty-state-symbol"><Gamepad2 size={20} /></span><strong>No game projects yet</strong><p>Create a draft or start in the AI Studio.</p><button className="button button-primary button-small" onClick={() => { setTab("games"); setGameFormOpen(true); }}>Create draft</button></div>}</div>
          {projects.length > 0 && <><div className="dashboard-title-row dashboard-subheading"><div><h2>AI Studio projects</h2><p>Private drafts stay private until you share them.</p></div><Link className="text-link" href="/library">Open library <ArrowRight size={13} /></Link></div><div className="project-list">{projects.slice(0, 4).map((project) => <div className="project-row" key={project.id}><div className="project-row-info"><span className="project-row-thumb"><Sparkles size={17} /></span><div><strong>{project.title}</strong><span>AI project · v{project.version ?? 1} · updated {new Date(project.updatedAt).toLocaleDateString()}</span></div></div><div className="project-row-actions"><span className={`status-badge status-${project.status}`}>{project.status}</span><Link href={`/studio/${project.id}`} className="button button-dark button-small">Open project</Link></div></div>)}</div></>}
        </>}
        {tab === "games" && <>
          <div className="dashboard-title-row"><div><h2>Your game projects</h2><p>Upload ZIP builds, preview them in a sandbox, and submit for review.</p></div><button className="button button-primary button-small" onClick={() => { setEditingGame(null); setGameForm(emptyGame); setGameFormOpen(!gameFormOpen); }}><CirclePlus size={13} /> New draft</button></div>
          {gameFormOpen && <form className="panel-card creator-form" onSubmit={saveGame}><div className="dashboard-title-row"><div><h3>{editingGame ? "Edit draft details" : "Create a game draft"}</h3><p>Only title and genre are required. You can add the build after saving.</p></div><button type="button" className="icon-button" aria-label="Close game form" onClick={() => { setGameFormOpen(false); setEditingGame(null); }}><span>×</span></button></div><div className="creator-form-grid"><div className="field"><label htmlFor="game-title">Game title</label><input id="game-title" className="text-input" value={gameForm.title} onChange={(event) => setGameForm({ ...gameForm, title: event.target.value })} maxLength={80} required /></div><div className="field"><label htmlFor="game-genre">Genre</label><select id="game-genre" className="select-input" value={gameForm.genre} onChange={(event) => setGameForm({ ...gameForm, genre: event.target.value })}>{genres.map((genre) => <option key={genre}>{genre}</option>)}</select></div><div className="field creator-form-wide"><label htmlFor="game-description">Description</label><textarea id="game-description" className="text-area" value={gameForm.description} onChange={(event) => setGameForm({ ...gameForm, description: event.target.value })} maxLength={5000} placeholder="What makes this game worth playing?" /></div><div className="field"><label htmlFor="game-tags">Tags</label><input id="game-tags" className="text-input" value={gameForm.tags} onChange={(event) => setGameForm({ ...gameForm, tags: event.target.value })} placeholder="arcade, short, cozy" /></div><div className="field"><label htmlFor="game-controls">Controls</label><input id="game-controls" className="text-input" value={gameForm.controls} onChange={(event) => setGameForm({ ...gameForm, controls: event.target.value })} maxLength={1000} placeholder="Arrow keys, mouse…" /></div><div className="field creator-form-wide"><label htmlFor="game-instructions">Instructions</label><textarea id="game-instructions" className="text-area" value={gameForm.instructions} onChange={(event) => setGameForm({ ...gameForm, instructions: event.target.value })} maxLength={2000} placeholder="How should players get started?" /></div><div className="field"><label htmlFor="game-license">License</label><select id="game-license" className="select-input" value={gameForm.license} onChange={(event) => setGameForm({ ...gameForm, license: event.target.value as GameFormState["license"] })}><option value="all-rights-reserved">All rights reserved</option><option value="cc-by-4.0">CC BY 4.0</option><option value="cc-by-sa-4.0">CC BY-SA 4.0</option><option value="cc0-1.0">CC0 1.0</option></select></div><div className="field"><label className="checkbox-row"><input type="checkbox" checked={gameForm.remixEnabled} onChange={(event) => setGameForm({ ...gameForm, remixEnabled: event.target.checked })} /> Allow remixes with attribution</label></div></div><div className="form-actions"><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : editingGame ? "Save details" : "Create draft"} <ArrowRight size={14} /></button><button type="button" className="button button-dark" onClick={() => { setGameFormOpen(false); setEditingGame(null); }}>Cancel</button></div></form>}
          <div className="project-list">{games.map((game) => <GameProjectRow key={game.id} game={game} working={workingId === game.id} onUpload={uploadBuild} onSubmit={submitGame} onEdit={editGame} />)}{!games.length && !gameFormOpen && <div className="empty-state-card"><span className="empty-state-symbol"><Gamepad2 size={20} /></span><strong>Nothing in the forge yet</strong><p>Start with a title and upload a browser-ready ZIP.</p><button className="button button-primary button-small" onClick={() => setGameFormOpen(true)}>Create your first draft</button></div>}</div>
        </>}
        {tab === "profile" && <><div className="dashboard-title-row"><div><h2>Developer profile</h2><p>Give players a public home for your games and studio links.</p></div></div><form className="panel-card profile-editor" onSubmit={saveProfile}><div className="field"><label htmlFor="studio-name">Studio or creator name</label><input id="studio-name" className="text-input" value={profileForm.studioName} onChange={(event) => setProfileForm({ ...profileForm, studioName: event.target.value })} maxLength={64} placeholder={user.displayName} required /></div><div className="field"><label htmlFor="studio-description">Studio description</label><textarea id="studio-description" className="text-area" value={profileForm.description} onChange={(event) => setProfileForm({ ...profileForm, description: event.target.value })} maxLength={800} placeholder="A little about what you make…" /></div><div className="field"><label htmlFor="studio-website">Website</label><input id="studio-website" className="text-input" type="url" value={profileForm.website} onChange={(event) => setProfileForm({ ...profileForm, website: event.target.value })} maxLength={300} placeholder="https://yourstudio.example" /><small>Use an HTTPS URL. Profile pictures and verification are future work.</small></div><div className="form-actions"><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save developer profile"} <Check size={14} /></button>{profile && <Link className="button button-dark" href={`/developers/${user.username}`}>View public profile <ArrowUpRight size={13} /></Link>}</div></form></>}
        {tab === "settings" && <><div className="dashboard-title-row"><div><h2>Settings & API keys</h2><p>Connect a provider when you open AI Studio.</p></div></div><div className="panel-card"><div className="settings-key-lock"><span><LockKeyholeIcon /></span><div><strong>Bring your own AI key</strong><p>GameForge does not save provider API keys. Enter one in AI Studio to discover models and generate games; it stays in page memory and is discarded when you leave.</p></div></div><Link href="/settings" className="button button-primary button-small">Key setup guide <ArrowRight size={13} /></Link></div><div className="panel-card dashboard-security-note"><h3>Account security</h3><p>Passwords are hashed before storage; sessions use opaque, HTTP-only cookies. Email verification, password reset, and account deletion require additional delivery and recovery flows that are not enabled yet.</p></div></>}
      </section>
    </div>
  </div>;
}

function GameProjectRow({ game, working, onUpload, onSubmit, onEdit }: { game: GameRecord; working: boolean; onUpload: (game: GameRecord, file?: File) => void; onSubmit: (game: GameRecord) => void; onEdit: (game: GameRecord) => void }) {
  const canEdit = game.status === "draft" || game.status === "rejected";
  const versionNumber = Number.parseInt(game.version.split(".")[0] || "1", 10);
  const previewEntry = game.entryPoint.split("/").map(encodeURIComponent).join("/");
  const preview = game.hasBuild ? `/api/builds/${game.id}/${versionNumber}/${previewEntry}` : "";
  return <article className="project-row"><div className="project-row-info"><span className="project-row-thumb"><Gamepad2 size={17} /></span><div><strong>{game.title}</strong><span>{game.genre} · {game.hasBuild ? `Build ${game.version}` : "Build missing"} · updated {game.updatedAt ? new Date(game.updatedAt).toLocaleDateString() : "just now"}</span></div></div><div className="project-row-actions"><span className={`status-badge status-${game.status}`}>{game.status}</span>{game.status === "published" ? <Link href={`/games/${game.slug}`} className="button button-dark button-small">View game</Link> : null}{game.hasBuild && game.status !== "published" ? <a className="button button-dark button-small" href={preview} target="_blank" rel="noreferrer">Preview build</a> : null}{canEdit && <button className="button button-outline button-small" onClick={() => onEdit(game)}><PenLine size={12} /> Edit</button>}{canEdit && <label className="button button-dark button-small upload-control"><Upload size={12} /> {working ? "Uploading…" : game.hasBuild ? "Replace ZIP" : "Upload ZIP"}<input type="file" accept=".zip,application/zip" disabled={working} onChange={(event) => { void onUpload(game, event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>}{canEdit && game.hasBuild && <button className="button button-primary button-small" disabled={working} onClick={() => onSubmit(game)}><Rocket size={12} /> Submit for review</button>}</div></article>;
}

function LockKeyholeIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.6"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 4v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
