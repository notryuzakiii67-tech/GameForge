import Link from "next/link";
import { ArrowRight, Search, Sparkles } from "lucide-react";
import { GameCard } from "@/components/GameCard";
import { demoGames, genres } from "@/lib/demo-games";
import { searchGames } from "@/lib/games";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function GamesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const selectedGenre = typeof params.genre === "string" ? params.genre : "All";
  const sort = typeof params.sort === "string" ? params.sort : "recent";
  let games = [] as Awaited<ReturnType<typeof searchGames>>;
  let setupIssue = false;
  try {
    games = await searchGames({ q, genre: selectedGenre, sort, limit: 36 });
  } catch {
    setupIssue = true;
  }
  const showDemo = process.env.NODE_ENV !== "production" && games.length === 0;
  if (showDemo) {
    games = demoGames.filter((game) => {
      const matchesGenre = selectedGenre === "All" || game.genre.toLowerCase() === selectedGenre.toLowerCase();
      const term = q.toLowerCase();
      const matchesSearch = !term || `${game.title} ${game.description} ${game.genre} ${game.tags?.join(" ")}`.toLowerCase().includes(term);
      return matchesGenre && matchesSearch;
    });
  }

  return <div className="page-wrap page-content">
    <header className="page-header page-header-row">
      <div><div className="eyebrow"><span className="section-mark" /> THE ARCADE</div><h1>Find your next world.</h1><p>Small games, big ideas. Pick a mood, press play, and find something you didn’t know you were looking for.</p></div>
      <Link href="/studio" className="button button-outline"><Sparkles size={15} /> Make one with AI <ArrowRight size={14} /></Link>
    </header>
    {setupIssue && process.env.NODE_ENV === "production" ? <div className="notice notice-error" role="status">Discovery is temporarily unavailable because the production database could not be reached. Please try again later.</div> : null}
    <form className="discovery-toolbar" action="/games">
      <div className="search-box discovery-search"><Search size={16} /><input name="q" defaultValue={q} placeholder="Search games, genres, and ideas" aria-label="Search games" /><button type="submit">Search</button></div>
      <select className="select-input" name="genre" defaultValue={selectedGenre} aria-label="Filter by genre">
        <option value="All">All genres</option>{genres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
      </select>
      <select className="select-input" name="sort" defaultValue={sort} aria-label="Sort games">
        <option value="recent">Recently published</option><option value="top-rated">Top rated</option><option value="favorites">Most favorited</option>
      </select>
      {!setupIssue && <span className="discovery-count">{showDemo ? `${games.length} playable starter demos` : `${games.length} ${games.length === 1 ? "game" : "games"}`}</span>}
    </form>
    <div className="filter-row" aria-label="Popular genres">
      <Link className={`filter-chip${selectedGenre === "All" ? " active" : ""}`} href="/games">All games</Link>
      {genres.slice(0, 10).map((genre) => <Link key={genre} className={`filter-chip${selectedGenre.toLowerCase() === genre.toLowerCase() ? " active" : ""}`} href={`/games?genre=${encodeURIComponent(genre)}`}>{genre}</Link>)}
    </div>
    {showDemo && <div className="notice notice-info" style={{ marginBottom: 15 }}>Development preview: the cards below are labeled playable starter demos. Connect PostgreSQL and run <code>npm run db:seed</code> for a database-backed local catalog.</div>}
    {games.length ? <div className="game-grid">{games.map((game) => <GameCard key={game.id} game={game} />)}</div> : <div className="empty-state-card"><span className="empty-state-symbol"><Search size={21} /></span><strong>No games found</strong><p>{setupIssue ? "The catalog could not load from the database." : "Try another search or clear your filters."}</p><Link className="button button-dark button-small" href="/games">Clear filters</Link></div>}
  </div>;
}
