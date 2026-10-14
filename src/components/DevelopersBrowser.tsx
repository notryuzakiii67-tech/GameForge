"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, Gamepad2, Search, UsersRound } from "lucide-react";

type Developer = { id: string; username: string; displayName: string; bio: string; studio: { name: string; description: string | null } | null; publishedGames: number; followers: number };

export function DevelopersBrowser() {
  const [developers, setDevelopers] = useState<Developer[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch("/api/developers", { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(); setDevelopers(body.developers ?? []); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  const matches = developers.filter((item) => `${item.displayName} ${item.username} ${item.studio?.name ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return <div>
    <div className="search-box discovery-search developer-search"><Search size={16} /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Find a creator or studio" aria-label="Search creators" /></div>
    {loading ? <div className="gallery-skeletons developer-skeletons">{[1,2,3].map((item) => <div className="developer-skeleton" key={item}><i /><span /><span /></div>)}</div> : failed ? <div className="notice notice-error">Creator profiles could not be loaded from the database.</div> : matches.length ? <div className="developer-grid">{matches.map((developer) => {
      const name = developer.studio?.name || developer.displayName;
      const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
      return <Link className="developer-card" href={`/developers/${developer.username}`} key={developer.id}><span className="avatar">{initials}</span><div className="developer-card-copy"><strong>{name}</strong><span>@{developer.username}</span><p>{developer.studio?.description || developer.bio || "GameForge creator"}</p><div className="developer-card-stats"><span><Gamepad2 size={12} /> {developer.publishedGames} games</span><span><UsersRound size={12} /> {developer.followers} followers</span></div></div><ArrowUpRight size={15} /></Link>;
    })}</div> : <div className="empty-state-card"><span className="empty-state-symbol"><UsersRound size={20} /></span><strong>No creator profiles found</strong><p>{q ? "Try a different name." : "Create a developer profile and publish your first browser game to appear here."}</p><Link className="button button-primary button-small" href="/dashboard">Set up your profile</Link></div>}
  </div>;
}
