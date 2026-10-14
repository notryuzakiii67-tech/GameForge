"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Code2, GitFork, Search, Sparkles } from "lucide-react";
import { genres } from "@/lib/demo-games";

type GalleryProject = { id: string; title: string; description: string; genre: string; allowRemix: boolean; sourceProjectId: string | null; updatedAt: string; creator: { username: string; displayName: string }; version: number | null; summary: string | null };

export function AiGalleryBrowser() {
  const [projects, setProjects] = useState<GalleryProject[]>([]);
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (genre) params.set("genre", genre);
    fetch(`/api/ai/gallery?${params.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "Gallery unavailable");
        if (active) { setProjects(body.projects ?? []); setFailed(false); }
      })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [q, genre]);

  return <div>
    <div className="discovery-toolbar"><div className="search-box discovery-search"><Search size={16} /><input aria-label="Search AI projects" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search AI-made games" /></div><select className="select-input" aria-label="Filter AI projects by genre" value={genre} onChange={(event) => setGenre(event.target.value)}><option value="">All game types</option>{genres.map((item) => <option key={item}>{item}</option>)}</select><span className="discovery-count">{loading ? "Loading…" : `${projects.length} public projects`}</span></div>
    {failed && <div className="notice notice-error">The public AI gallery could not load from the database.</div>}
    {loading ? <div className="gallery-grid gallery-skeletons" aria-label="Loading AI projects">{[1,2,3,4].map((item) => <div className="gallery-skeleton" key={item}><div /><i /><i /></div>)}</div> : projects.length ? <div className="gallery-grid">{projects.map((project) => <Link className="gallery-card" href={`/ai-gallery/${project.id}`} key={project.id}>
      <div className="gallery-thumb"><span className="gallery-symbol"><Sparkles size={25} /></span><small>{project.genre}</small></div><h3>{project.title}</h3><p>{project.description || project.summary || "An AI-assisted browser game. Open to play and explore the project."}</p><div className="gallery-card-meta"><span>by {project.creator.displayName}</span><span>{project.allowRemix ? <><GitFork size={11} /> Remixable</> : <><Code2 size={11} /> v{project.version ?? 1}</>}</span></div>
    </Link>)}</div> : <div className="empty-state-card"><span className="empty-state-symbol"><Sparkles size={22} /></span><strong>{failed ? "Gallery unavailable" : "No public projects yet"}</strong><p>{failed ? "Try again after the catalog database is available." : "AI-made projects appear here after their creator opts in and moderation approves them."}</p><Link href="/studio" className="button button-primary button-small">Create the first one</Link></div>}
  </div>;
}
