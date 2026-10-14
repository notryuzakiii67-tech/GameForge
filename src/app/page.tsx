import Link from "next/link";
import { ArrowRight, ArrowUpRight, Gamepad2, MousePointer2, Sparkles, WandSparkles } from "lucide-react";
import { GameCard } from "@/components/GameCard";
import { demoGames, genres, type GameCardData } from "@/lib/demo-games";
import { searchGames } from "@/lib/games";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let games: GameCardData[] = [];
  let setupIssue = false;
  try {
    games = await searchGames({ limit: 6, sort: "recent" });
  } catch {
    setupIssue = true;
  }
  const isDemo = games.length === 0 && process.env.NODE_ENV !== "production";
  if (isDemo) games = demoGames;
  const featured = games[0] ?? (isDemo ? demoGames[0] : null);
  const starterGames = games.slice(0, 6);

  return <div className="home-page">
    <section className="home-hero page-wrap">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-spark"><Sparkles size={13} /></span> A new kind of game space <span className="eyebrow-rule" /></div>
        <h1>Good games.<br /><span>Made by you.</span></h1>
        <p className="hero-lede">Jump into clever little worlds, make your own with AI, and share what you build with players everywhere.</p>
        <div className="hero-actions">
          <Link href="/games" className="button button-primary button-large"><Gamepad2 size={17} /> Find a game <ArrowRight size={16} /></Link>
          <Link href="/studio" className="button button-outline button-large"><WandSparkles size={17} /> Open AI Studio</Link>
        </div>
        <div className="hero-social-proof"><div className="tiny-orbs"><i /><i /><i /></div><span><strong>Play in a click.</strong> Create without a download.</span><span className="hero-dot" /> <span className="live-label">Browser-first</span></div>
      </div>
      <div className="hero-visual">
        <div className="hero-visual-grid" />
        {featured ? <>
          <div className="hero-image-frame">
            <img src={featured.cover || "/art/neon-drift.svg"} alt={`${featured.title} game artwork`} />
            <div className="hero-image-shade" />
            <div className="hero-game-caption"><span className="hero-caption-kicker">{isDemo ? "PLAYABLE STARTER" : featured.genre.toUpperCase()}</span><strong>{featured.title}</strong><span>{featured.isDemo ? "Made for your browser · demo game" : `By ${featured.developer}`}</span></div>
            <Link href={`/games/${featured.slug}`} className="hero-play" aria-label={`Play ${featured.title}`}><span><Gamepad2 size={18} fill="currentColor" /></span></Link>
          </div>
          <div className="float-card float-card-top"><span className="float-icon float-purple"><Sparkles size={16} /></span><span><strong>Idea → playable</strong><small>Your next game starts here</small></span></div>
          <div className="float-card float-card-bottom"><span className="float-icon float-green"><MousePointer2 size={16} /></span><span><strong>Instant play</strong><small>No installs. Just press play.</small></span><span className="mini-live-dot" /></div>
        </> : <div className="hero-image-frame hero-setup-art"><div className="setup-art-inner"><span><Gamepad2 size={28} /></span><strong>Your next world starts here.</strong><small>Connect the production database to feature published games.</small></div></div>}
        <div className="hero-visual-orbit orbit-one" /><div className="hero-visual-orbit orbit-two" />
      </div>
    </section>

    <section className="quick-search page-wrap" aria-label="Search games">
      <div><span className="quick-search-label">WHAT ARE YOU IN THE MOOD FOR?</span><strong>Find your next favorite</strong></div>
      <form action="/games" className="search-box"><SearchIcon /><input name="q" placeholder="Try ‘cozy puzzle’ or ‘tiny platformer’" aria-label="Search GameForge games" /><button type="submit">Search <ArrowRight size={15} /></button></form>
    </section>

    <section className="genre-strip page-wrap" aria-label="Browse genres">
      <span className="genre-strip-label">EXPLORE BY MOOD</span>
      <div className="genre-scroll">{genres.slice(0, 11).map((genre, index) => <Link key={genre} className={`genre-chip genre-chip-${index % 5}`} href={`/games?genre=${encodeURIComponent(genre)}`}>{genre}<ArrowUpRight size={12} /></Link>)}</div>
    </section>

    {setupIssue && process.env.NODE_ENV === "production" ? <section className="config-callout page-wrap"><div className="config-callout-icon">!</div><div><strong>GameForge needs its database connection.</strong><p>Discovery will be available once <code>DATABASE_URL</code> points to your production PostgreSQL database. No example metrics or placeholder games are being shown.</p></div></section> : null}

    <section className="section-block page-wrap">
      <div className="section-heading"><div><div className="eyebrow eyebrow-small"><span className="section-mark" /> THE ARCADE</div><h2>{isDemo ? "A few worlds to wander" : "Fresh from the forge"}</h2><p>{isDemo ? "Three actual, playable demos to try while you explore." : "New browser games, ready when you are."}</p></div><Link href="/games" className="text-link">Explore all games <ArrowRight size={15} /></Link></div>
      {starterGames.length ? <div className="game-grid">{starterGames.map((game) => <GameCard key={game.id} game={game} />)}</div> : <div className="empty-state-card"><span className="empty-state-symbol"><Gamepad2 size={23} /></span><strong>No public games yet</strong><p>Be the first creator to bring a game to GameForge.</p><Link className="button button-primary button-small" href="/dashboard">Create a game <ArrowRight size={14} /></Link></div>}
      {isDemo && <p className="demo-disclaimer"><span className="status-dot" /> Starter examples are labeled demo content. Ratings and player counts are not invented.</p>}
    </section>

    <section className="studio-promo page-wrap">
      <div className="studio-promo-content"><div className="eyebrow eyebrow-small"><Sparkles size={13} /> YOUR IDEA, IN PLAY</div><h2>From “what if…”<br /><span>to press play.</span></h2><p>Describe a game. Choose your AI provider. Get a playable browser project you can inspect, edit, remix, and make your own.</p><div className="studio-promo-actions"><Link href="/studio" className="button button-primary">Make a game <ArrowRight size={16} /></Link><Link href="/settings" className="text-link">Bring your own AI key <ArrowUpRight size={14} /></Link></div><div className="provider-row"><span>Bring your own key</span><i>Gemini</i><i>Mistral</i><i>Groq</i></div></div>
      <div className="studio-promo-visual" aria-hidden="true"><div className="studio-window"><div className="window-top"><span /><span /><span /><b>gameforge.studio</b><Sparkles size={14} /></div><div className="window-body"><div className="code-pane"><div className="code-label"><span className="code-dot" /> YOUR PROMPT</div><div className="code-lines"><i className="line-long" /><i className="line-mid" /><i className="line-short" /></div><div className="prompt-pill">A tiny garden at midnight…</div><div className="code-footer"><span className="code-check">✓</span> Ready to play</div></div><div className="preview-pane"><div className="preview-stars">✦　　 ·　　✧</div><div className="preview-moon" /><div className="preview-hill hill-back" /><div className="preview-hill hill-front" /><div className="preview-flower">✿</div><div className="preview-start">PLAY</div></div></div><div className="window-footer"><span>index.html</span><span>PREVIEW SANDBOX <span className="status-dot" /></span></div></div><div className="studio-orb orb-a" /><div className="studio-orb orb-b" /></div>
    </section>

    <section className="how-section page-wrap"><div className="section-heading"><div><div className="eyebrow eyebrow-small">THE GAMEFORGE LOOP</div><h2>Play. Make. Pass it on.</h2></div><p className="section-heading-aside">A little curiosity goes a long way.</p></div><div className="how-grid"><article><span className="how-number">01</span><span className="how-icon how-icon-violet"><Gamepad2 size={20} /></span><h3>Discover</h3><p>Find independent browser games worth the tab they open in.</p></article><article><span className="how-number">02</span><span className="how-icon how-icon-mint"><WandSparkles size={20} /></span><h3>Create</h3><p>Turn a half-formed idea into a playable first draft with AI.</p></article><article><span className="how-number">03</span><span className="how-icon how-icon-orange"><ArrowUpRight size={20} /></span><h3>Share</h3><p>Polish your build, publish it for review, and invite people in.</p></article></div></section>

    <section className="closing-cta page-wrap"><div><span className="eyebrow eyebrow-small">YOUR NEXT FAVORITE IS OUT THERE</span><h2>Ready when you are.</h2></div><div className="closing-cta-actions"><Link href="/games" className="button button-outline">Browse games</Link><Link href="/auth?mode=register" className="button button-primary">Join GameForge <ArrowRight size={15} /></Link></div></section>
  </div>;
}

function SearchIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.6"/><path d="m16 16 4.2 4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>; }
