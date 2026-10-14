import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Gamepad2, Sparkles } from "lucide-react";

export const metadata: Metadata = { title: "Game Jams" };

export default function GameJamsPage() {
  return <div className="page-wrap page-content"><header className="page-header"><div className="eyebrow"><CalendarDays size={13} /> BUILD TO A THEME</div><h1>Game jams are on the roadmap.</h1><p>Shared themes, friendly deadlines, and games made in a weekend are planned for a later phase. There are no active jams configured yet.</p></header><section className="jam-empty panel-card"><div className="jam-illustration"><span><Gamepad2 size={28} /></span><i /><i /><i /></div><div><h2>Make something while you wait.</h2><p>Try a small playable idea in AI Studio, or browse a few starter games from the community.</p><div className="form-actions"><Link className="button button-primary" href="/studio"><Sparkles size={14} /> Open AI Studio</Link><Link className="button button-outline" href="/games">Browse games</Link></div></div></section></div>;
}
