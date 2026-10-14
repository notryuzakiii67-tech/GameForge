import type { Metadata } from "next";
import Link from "next/link";
import { BookmarkPlus, Heart, Library } from "lucide-react";

export const metadata: Metadata = { title: "Collections" };

export default function CollectionsPage() {
  return <div className="page-wrap page-content"><header className="page-header"><div className="eyebrow"><BookmarkPlus size={13} /> CURATED WORLDS</div><h1>Collections are taking shape.</h1><p>Custom public collections are planned for the next community phase. You can save individual games to your personal library today.</p></header><div className="feature-status-grid"><article className="panel-card"><span className="feature-status-icon"><Heart size={18} /></span><h2>Save a game</h2><p>Open any public game and use its Save button. Favorites are private to your account and are stored in the database.</p><Link className="button button-primary button-small" href="/games">Explore games</Link></article><article className="panel-card"><span className="feature-status-icon"><Library size={18} /></span><h2>Keep your projects together</h2><p>Your saved games, AI drafts, and developer projects are grouped in My Library.</p><Link className="button button-outline button-small" href="/library">Open my library</Link></article></div></div>;
}
