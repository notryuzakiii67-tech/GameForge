"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ExternalLink, Gamepad2, LoaderCircle, UsersRound } from "lucide-react";
import { GameCard } from "@/components/GameCard";
import type { GameCardData } from "@/lib/demo-games";

type Profile = { id: string; username: string; displayName: string; bio: string; studio: { name: string; description: string | null; website: string | null } | null; followers: number; following: number; publishedGames: number; isFollowing: boolean };

export function DeveloperProfileView({ username }: { username: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [games, setGames] = useState<GameCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch(`/api/developers/${encodeURIComponent(username)}`, { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || "Creator not found."); if (active) { setProfile(body.profile); setGames(body.games ?? []); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Creator not found."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [username]);

  async function toggleFollow() {
    if (!profile) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/developers/${encodeURIComponent(profile.username)}/follow`, { method: profile.isFollowing ? "DELETE" : "POST" });
      if (response.status === 401) { window.location.href = "/auth?mode=login"; return; }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Follow action failed.");
      setProfile({ ...profile, isFollowing: body.following, followers: Math.max(0, profile.followers + (body.following ? 1 : -1)) });
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Follow action failed."); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="page-wrap public-project-loading"><LoaderCircle size={18} className="spin" /> Loading creator…</div>;
  if (!profile) return <div className="page-wrap page-content"><div className="notice notice-error">{error || "Creator not found."}</div><Link href="/developers" className="button button-outline" style={{ marginTop: 15 }}>Browse developers</Link></div>;
  const initials = profile.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <div className="page-wrap page-content">
    <div className="breadcrumb"><Link href="/developers">Developers</Link><span>/</span><strong>@{profile.username}</strong></div>
    <section className="developer-hero"><span className="avatar">{initials}</span><div className="developer-profile-heading"><span className="eyebrow eyebrow-small">CREATOR PROFILE</span><h1>{profile.studio?.name || profile.displayName}</h1><p>@{profile.username}{profile.studio?.description ? ` · ${profile.studio.description}` : profile.bio ? ` · ${profile.bio}` : ""}</p><div className="developer-meta"><span><Gamepad2 size={12} /> {profile.publishedGames} published {profile.publishedGames === 1 ? "game" : "games"}</span><span><UsersRound size={12} /> {profile.followers} {profile.followers === 1 ? "follower" : "followers"}</span></div></div><div className="developer-hero-actions"><div className="developer-actions-row">{profile.username !== "gameforge_demo" && <button className={`button ${profile.isFollowing ? "button-dark" : "button-primary"}`} onClick={toggleFollow} disabled={busy}>{busy ? "Updating…" : profile.isFollowing ? "Following" : "Follow creator"}</button>}{profile.studio?.website && <a className="button button-outline" href={profile.studio.website} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Website</a>}</div>{message && <span className="inline-action-message" role="status">{message}</span>}</div></section>
    <div className="section-heading creator-games-heading"><div><div className="eyebrow eyebrow-small"><span className="section-mark" /> FROM THIS CREATOR</div><h2>Games by {profile.studio?.name || profile.displayName}</h2><p>Only public, approved games are listed here.</p></div></div>
    {games.length ? <div className="game-grid">{games.map((game) => <GameCard game={game} key={game.id} />)}</div> : <div className="empty-state-card"><span className="empty-state-symbol"><Gamepad2 size={21} /></span><strong>No published games yet</strong><p>This creator hasn’t shared a public browser game.</p><Link href="/studio" className="button button-primary button-small">Open AI Studio</Link></div>}
  </div>;
}
