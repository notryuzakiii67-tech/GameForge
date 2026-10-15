import Link from "next/link";
import { Play, Star } from "lucide-react";
import type { GameCardData } from "@/lib/demo-games";

export function GameCard({ game, compact = false }: { game: GameCardData; compact?: boolean }) {
  const cover = game.cover || "/art/neon-drift.svg";
  const initials = game.developer.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  const blocked = game.verificationStatus === "blocked";
  const statusLabel = game.verificationStatus === "not-fully-tested" ? "NOT FULLY TESTED" : game.verificationStatus?.toUpperCase();
  const developerProfile = game.developerUsername ? `/developers/${game.developerUsername}` : null;
  const coverContent = <div className="game-cover" style={{ background: `radial-gradient(circle at 80% 12%, ${game.accent || "#826cff"}42, transparent 36%), linear-gradient(135deg, #181725, #101620)` }}>
    <img className="game-cover-art" src={cover} alt={`${game.title} cover art`} loading="lazy" />
    <span className={`cover-play${blocked ? " cover-play-blocked" : ""}`}>{blocked ? "Unavailable" : <><Play size={15} fill="currentColor" /> Play</>}</span>
    {game.isDemo && !blocked && <span className="demo-pill">STARTER</span>}
  </div>;
  const creator = <><span className="creator-mini-avatar">{initials}</span><span>{game.developer}</span></>;

  return <article className={`game-card${compact ? " game-card-compact" : ""}${blocked ? " game-card-blocked" : ""}`}>
    {blocked ? <div className="game-cover-link" aria-disabled="true">{coverContent}</div> : <Link href={`/games/${game.slug}`} className="game-cover-link" aria-label={`Play ${game.title}`}>{coverContent}</Link>}
    <div className="game-card-info">
      <div className="game-card-title-row">{blocked ? <span className="game-card-title">{game.title}</span> : <Link href={`/games/${game.slug}`} className="game-card-title">{game.title}</Link>}<span className="genre-pill">{game.genre}</span></div>
      <p className="game-card-description">{game.description}</p>
      <div className="game-card-meta">
        {developerProfile ? <Link className="creator-mini" href={developerProfile}>{creator}</Link> : <span className="creator-mini">{creator}</span>}
        <span className="game-card-stats">{game.averageRating !== null && game.ratingCount > 0 ? <><Star size={13} fill="currentColor" /> {game.averageRating.toFixed(1)}</> : <><Play size={12} fill="currentColor" /> {game.isDemo ? "Demo" : "Play"}</>}</span>
      </div>
      {statusLabel && <div className={`verification-label verification-${game.verificationStatus}`} title={game.verificationNote}>{statusLabel}</div>}
    </div>
  </article>;
}
