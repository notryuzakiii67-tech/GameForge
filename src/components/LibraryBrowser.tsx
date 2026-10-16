"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowDownToLine, ArrowUpRight, Gamepad2, Heart, LoaderCircle, Search, Sparkles } from "lucide-react";
import { GameCard } from "@/components/GameCard";
import type { GameCardData } from "@/lib/demo-games";
import type { PublicUser } from "@/lib/auth";

type LibraryData = { favorites: GameCardData[]; projects: { id: string; title: string; description: string; status: string; visibility: string; updatedAt: string; version: number | null }[]; games: { id: string; title: string; slug: string; genre: string; status: string; updatedAt: string }[] };
type Tab = "saved" | "projects" | "games";

export function LibraryBrowser() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [data, setData] = useState<LibraryData>({ favorites: [], projects: [], games: [] });
  const [tab, setTab] = useState<Tab>("saved");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/auth/me", { cache: "no-store" }), fetch("/api/me/library", { cache: "no-store" })])
      .then(async ([authResponse, libraryResponse]) => {
        const auth = authResponse.ok ? await authResponse.json() : { user: null };
        if (!auth.user) { if (active) { setUser(null); setLoading(false); } return; }
        const library = await libraryResponse.json();
        if (!libraryResponse.ok) throw new Error(library.error?.message || "Your library couldn’t be loaded.");
        if (active) { setUser(auth.user); setData(library); }
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Your library couldn’t be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const filter = <T extends { title: string }>(items: T[]) => items.filter((item) => item.title.toLowerCase().includes(q.toLowerCase()));
  if (loading) return <div className="page-wrap public-project-loading"><LoaderCircle size={18} className="spin" /> Loading your library…</div>;
  if (!user) return <div className="page-wrap page-content"><header className="page-header"><div className="eyebrow"><Heart size={13} /> YOUR GAME LIBRARY</div><h1>Good games, kept close.</h1><p>Sign in to save games and keep AI projects and creator drafts together.</p></header><div className="empty-state-card"><span className="empty-state-symbol"><Heart size={20} /></span><strong>Your library needs an account</strong><p>Saved games and private projects are visible only to you.</p><Link className="button button-primary button-small" href="/auth?mode=login&next=%2Flibrary">Sign in</Link></div></div>;
  const saved = filter(data.favorites);
  const projects = filter(data.projects);
  const games = filter(data.games);
  return <div className="page-wrap page-content"><header className="page-header"><div className="eyebrow"><Heart size={13} /> YOUR GAME LIBRARY</div><h1>Good games, kept close.</h1><p>Your saved games, AI creations, and published projects in one place.</p></header>
    {error && <div className="notice notice-error">{error}</div>}
    <div className="library-top-row"><div className="library-tabs" role="group" aria-label="Library views"><button type="button" aria-pressed={tab === "saved"} className={tab === "saved" ? "active" : ""} onClick={() => setTab("saved")}>Saved games <span>{data.favorites.length}</span></button><button type="button" aria-pressed={tab === "projects"} className={tab === "projects" ? "active" : ""} onClick={() => setTab("projects")}>AI projects <span>{data.projects.length}</span></button><button type="button" aria-pressed={tab === "games"} className={tab === "games" ? "active" : ""} onClick={() => setTab("games")}>My games <span>{data.games.length}</span></button></div><div className="search-box library-search"><Search size={15} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Filter your library" aria-label="Filter library" /></div></div>
    {tab === "saved" && (saved.length ? <div className="game-grid">{saved.map((game) => <GameCard game={game} key={game.id} />)}</div> : <LibraryEmpty icon="saved" title="No saved games yet" body="Tap the heart on any public game page and it will show up here." href="/games" label="Find a game" />)}
    {tab === "projects" && (projects.length ? <div className="project-list">{projects.map((project) => <div className="project-row" key={project.id}><div className="project-row-info"><span className="project-row-thumb"><Sparkles size={17} /></span><div><strong>{project.title}</strong><span>Private by default · v{project.version ?? 1} · updated {new Date(project.updatedAt).toLocaleDateString()}</span></div></div><div className="project-row-actions"><span className={`status-badge status-${project.status}`}>{project.status}</span><Link href={`/studio/${project.id}`} className="button button-dark button-small">Open</Link><a href={`/api/ai/projects/${project.id}/export`} className="icon-button" aria-label={`Download ${project.title} ZIP`}><ArrowDownToLine size={14} /></a></div></div>)}</div> : <LibraryEmpty icon="ai" title="No AI projects yet" body="Projects you create in AI Studio are automatically versioned and saved here." href="/studio" label="Open AI Studio" />)}
    {tab === "games" && (games.length ? <div className="project-list">{games.map((game) => <div className="project-row" key={game.id}><div className="project-row-info"><span className="project-row-thumb"><Gamepad2 size={17} /></span><div><strong>{game.title}</strong><span>{game.genre} · updated {new Date(game.updatedAt).toLocaleDateString()}</span></div></div><div className="project-row-actions"><span className={`status-badge status-${game.status}`}>{game.status}</span>{game.status === "published" && <Link href={`/games/${game.slug}`} className="button button-dark button-small">View <ArrowUpRight size={12} /></Link>}</div></div>)}</div> : <LibraryEmpty icon="games" title="No game drafts yet" body="Create a game draft from your dashboard and upload a browser-ready ZIP." href="/dashboard" label="Open dashboard" />)}
    <p className="library-footnote">Recently played tracking, downloads for uploaded games, and collections are not enabled in this MVP.</p>
  </div>;
}

function LibraryEmpty({ icon, title, body, href, label }: { icon: "saved" | "ai" | "games"; title: string; body: string; href: string; label: string }) {
  const Icon = icon === "saved" ? Heart : icon === "ai" ? Sparkles : Gamepad2;
  return <div className="empty-state-card"><span className="empty-state-symbol"><Icon size={21} /></span><strong>{title}</strong><p>{body}</p><Link href={href} className="button button-primary button-small">{label}</Link></div>;
}
