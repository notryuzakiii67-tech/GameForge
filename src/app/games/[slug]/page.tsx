import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarDays, Code2, ExternalLink, Flag, Gamepad2, Heart, ShieldCheck, Smartphone, Sparkles, Tag } from "lucide-react";
import { FavoriteButton, RatingControl, ReportButton, ShareButton } from "@/components/GameActions";
import { GamePlayer } from "@/components/GamePlayer";
import { GameReviews } from "@/components/GameReviews";
import { GameCard } from "@/components/GameCard";
import { demoGameDetails } from "@/lib/demo-game-details";
import { demoGames } from "@/lib/demo-games";
import { getGameBySlug, searchGames, type GameDetails } from "@/lib/games";

export const dynamic = "force-dynamic";

export default async function GamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let game: GameDetails | null = null;
  let failed = false;
  try {
    game = await getGameBySlug(slug);
  } catch {
    failed = true;
  }
  if (!game && process.env.NODE_ENV !== "production") game = demoGameDetails(slug);
  if (!game) notFound();

  let related: Awaited<ReturnType<typeof searchGames>> = [];
  try {
    related = (await searchGames({ genre: game.genre, limit: 6 })).filter((item) => item.id !== game!.id).slice(0, 3);
  } catch { /* Related games are optional; the game page still plays without the catalog. */ }
  if (!related.length && process.env.NODE_ENV !== "production") related = demoGames.filter((item) => item.id !== game!.id).slice(0, 3);

  const entryPoint = game.entryPoint || "index.html";
  const src = game.isDemo
    ? `/demos/${encodeURIComponent(game.slug)}/${entryPoint.split("/").map(encodeURIComponent).join("/")}`
    : game.versionNumber
      ? `${(process.env.GAME_CONTENT_ORIGIN || "").replace(/\/$/, "")}/api/builds/${encodeURIComponent(game.id)}/${game.versionNumber}/${entryPoint.split("/").map(encodeURIComponent).join("/")}`
      : null;
  const initials = game.developer.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  return <div className="page-wrap page-content game-page">
    <div className="breadcrumb"><Link href="/games">Games</Link><span>/</span><Link href={`/games?genre=${encodeURIComponent(game.genre)}`}>{game.genre}</Link><span>/</span><strong>{game.title}</strong></div>
    {failed && <div className="notice notice-info" style={{ marginBottom: 15 }}>Showing local starter content. The database-backed catalog is currently unavailable.</div>}
    <div className="game-detail-top">
      <GamePlayer title={game.title} src={src} controls={game.controls} demo={game.isDemo} sandboxCapabilities={game.sandboxCapabilities} aspect={game.playerAspect} />
      <aside className="game-side-card">
        <div className="game-side-top"><span className="genre-pill">{game.genre}</span>{game.isDemo && <span className="demo-pill-static">DEMO</span>}{game.verificationStatus && <span className={`verification-pill verification-${game.verificationStatus}`}>{game.verificationStatus === "not-fully-tested" ? "NOT FULLY TESTED" : game.verificationStatus.toUpperCase()}</span>}</div>
        <h1>{game.title}</h1>
        <div className="game-byline"><span className="avatar">{initials}</span><span><small>MADE BY</small>{game.developerUsername ? <Link href={`/developers/${game.developerUsername}`}>{game.developer}</Link> : <span>{game.developer}</span>}</span>{game.developerUsername && <Link className="byline-arrow" href={`/developers/${game.developerUsername}`} aria-label={`View ${game.developer} creator profile`}><ExternalLink size={14} /></Link>}</div>
        <p>{game.description}</p>
        <div className="game-actions"><FavoriteButton gameId={game.id} initialCount={game.favoriteCount} /><ShareButton /></div>
        {game.verificationNote && <div className="verification-note" role="note"><strong>Verification status</strong><span>{game.verificationNote}</span></div>}
        <div className="game-info-list">
          <div className="game-info-item"><span>Genre</span><span>{game.genre}</span></div>
          <div className="game-info-item"><span>Build</span><span>{game.version}</span></div>
          <div className="game-info-item"><span>Published</span><span>{game.publishedAt ? new Date(game.publishedAt).toLocaleDateString() : game.isDemo ? "Starter demo" : "Not listed"}</span></div>
          <div className="game-info-item"><span>Platform</span><span>{game.platform.join(", ")}</span></div>
          <div className="game-info-item"><span>Rating</span><span>{game.ratingCount ? `${game.averageRating?.toFixed(1)} · ${game.ratingCount} ratings` : "No ratings yet"}</span></div>
          <div className="game-info-item"><span>Favorites</span><span>{game.favoriteCount}</span></div>
        </div>
        <div className="game-side-extra"><div><Gamepad2 size={13} /><span>{game.controls || "Controls vary by game"}</span></div><div><Smartphone size={13} /><span>{game.platform.includes("Mobile") ? "Mobile support listed" : "Keyboard / mouse as implemented"}</span></div></div>
        {game.tags?.length ? <div className="tag-row">{game.tags.map((tag) => <span key={tag}><Tag size={10} />{tag}</span>)}</div> : null}
        <div className="side-report"><ReportButton targetId={game.id} /></div>
      </aside>
    </div>

    <div className="game-detail-sections">
      <div className="game-detail-main-column">
        <section className="game-description-card"><div className="card-title-with-icon"><span><Code2 size={15} /></span><h2>About this game</h2></div><p>{game.description}</p>{game.instructions && <div className="instructions-block"><h3>How to play</h3><p>{game.instructions}</p></div>}{game.warnings.length > 0 && <div className="warning-row"><ShieldCheck size={14} /><span>Content notes: {game.warnings.join(", ")}</span></div>}</section>
        <GameReviews gameId={game.id} />
      </div>
      <div className="game-detail-side-column">
        <section className="game-description-card rate-card"><div className="card-title-with-icon"><span><Heart size={15} /></span><h2>Enjoyed the game?</h2></div><p>A quick rating helps other players find something they’ll love.</p><RatingControl gameId={game.id} /><span className="rate-note">One rating per account · you can update it anytime</span></section>
        <section className="game-description-card"><div className="card-title-with-icon"><span><CalendarDays size={15} /></span><h2>Build notes</h2></div><div className="build-note-row"><span>Version</span><strong>{game.version}</strong></div><div className="build-note-row"><span>Updated</span><strong>{game.updatedAt ? new Date(game.updatedAt).toLocaleDateString() : "Starter build"}</strong></div><div className="build-note-row"><span>License</span><strong>{game.license}</strong></div>{game.sourceUrl && <div className="build-note-row"><span>Source</span><a href={game.sourceUrl} target="_blank" rel="noopener noreferrer">Pinned upstream revision</a></div>}{game.sourceAttribution && <p className="build-note-safe">{game.sourceAttribution}</p>}<p className="build-note-safe">This game runs as untrusted client-side code in a restricted iframe. GameForge does not execute uploaded code on its server.</p></section>
        {related.length > 0 && <section className="related-games"><div className="related-title"><h2>More to explore</h2><Link href={`/games?genre=${encodeURIComponent(game.genre)}`}>All <ArrowRight size={12} /></Link></div>{related.slice(0, 2).map((item) => <GameCard key={item.id} game={item} compact />)}</section>}
        {game.isDemo && <div className="notice notice-info demo-game-note"><Sparkles size={14} /><span>Starter build. The verification note records the headless-browser outcome and remaining limits; physical-device and production-host checks have not been performed. Seed your local database to enable platform ratings and reviews for these examples.</span></div>}
      </div>
    </div>
  </div>;
}
