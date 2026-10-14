import Link from "next/link";
import { Play, Star } from "lucide-react";
import type { GameCardData } from "@/lib/demo-games";

export function GameCard({ game, compact = false }: { game: GameCardData; compact?: boolean }) {
  const cover = game.cover || "/art/neon-drift.svg";
  const initials = game.developer.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  return <article className={`game-card${compact ? " game-card-compact" : ""}`}>
    <Link href={`/games/${game.slug}`} className="game-cover-link" aria-label={`Play ${game.title}`}>
      <div className="game-cover" style={{ background: `radial-gradient(circle at 80% 12%, ${game.accent || "#826cff"}42, transparent 36%), linear-gradient(135deg, #181725, #101620)` }}>
        <img className="game-cover-art" src={cover} alt={`${game.title} cover art`} loading="lazy" />
        <span className="cover-play"><Play size={15} fill="currentColor" /> Play</span>
        {game.isDemo && <span className="demo-pill">STARTER</span>}
      </div>
    </Link>
    <div className="game-card-info">
      <div className="game-card-title-row"><Link href={`/games/${game.slug}`} className="game-card-title">{game.title}</Link><span className="genre-pill">{game.genre}</span></div>
      <p className="game-card-description">{game.description}</p>
      <div className="game-card-meta">
        <Link className="creator-mini" href={game.isDemo ? "/developers" : game.developerUsername ? `/developers/${game.developerUsername}` : "/developers"}>
          <span className="creator-mini-avatar">{initials}</span><span>{game.developer}</span>
        </Link>
        <span className="game-card-stats">{game.averageRating !== null && game.ratingCount > 0 ? <><Star size={13} fill="currentColor" /> {game.averageRating.toFixed(1)}</> : <><Play size={12} fill="currentColor" /> {game.isDemo ? "Demo" : "Play"}</>}</span>
      </div>
    </div>
  </article>;
}
