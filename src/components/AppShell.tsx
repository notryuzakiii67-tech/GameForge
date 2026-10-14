"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Bell, ChevronDown, Compass, Flame, Gamepad2, Grid2X2, Hammer, Library, Menu, Search, Sparkles, X,
} from "lucide-react";
import type { PublicUser } from "@/lib/auth";

const navigation = [
  { href: "/", label: "Discover", icon: Compass },
  { href: "/games", label: "Games", icon: Gamepad2 },
  { href: "/studio", label: "AI Studio", icon: Sparkles, featured: true },
  { href: "/developers", label: "Developers", icon: Hammer },
  { href: "/jams", label: "Game Jams", icon: Flame },
  { href: "/collections", label: "Collections", icon: Grid2X2 },
  { href: "/library", label: "My Library", icon: Library },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setUser(data?.user ?? null); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [pathname]);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      setNotice("You’re signed out. See you in the next run.");
      window.setTimeout(() => setNotice(""), 3000);
    } catch {
      setNotice("Couldn’t sign out just now. Try again.");
    }
  }

  const initials = user?.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "GF";
  const links = (mobile = false) => navigation.map(({ href, label, icon: Icon, featured }) => {
    const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    return <Link key={href} href={href} className={`nav-link${active ? " active" : ""}${featured ? " nav-featured" : ""}${mobile ? " mobile-link" : ""}`} onClick={() => setMenuOpen(false)}>
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
      {featured && <span className="nav-new">NEW</span>}
    </Link>;
  });

  return <>
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="GameForge home">
          <span className="brand-mark"><Hammer size={18} strokeWidth={2.3} /></span>
          <span className="brand-name">gameforge<span className="brand-period">.</span></span>
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">{links()}</nav>
        <div className="header-actions">
          <form className="nav-search" action="/games" role="search">
            <Search size={16} aria-hidden="true" />
            <input name="q" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find your next game" aria-label="Search games" />
            <kbd>/</kbd>
          </form>
          {user ? <>
            <Link className="icon-button notification-button" href="/library" aria-label="Notifications and library"><Bell size={18} /></Link>
            <div className="account-wrap">
              <Link className="account-button" href={`/developers/${user.username}`} aria-label={`Open ${user.displayName} profile`}>
                <span className="avatar avatar-small">{initials}</span>
                <ChevronDown size={14} />
              </Link>
              <div className="account-menu">
                <div className="account-menu-head"><strong>{user.displayName}</strong><span>@{user.username}</span></div>
                <Link href="/dashboard">Creator dashboard</Link>
                <Link href="/settings">Settings & API keys</Link>
                {user.role === "admin" || user.role === "moderator" ? <Link href="/admin">Moderation</Link> : null}
                <button onClick={logout}>Sign out</button>
              </div>
            </div>
          </> : <>
            <Link className="quiet-link sign-in-link" href="/auth?mode=login">Sign in</Link>
            <Link className="button button-small button-primary header-join" href="/auth?mode=register">Join free <span aria-hidden="true">↗</span></Link>
          </>}
          <button className="mobile-menu-toggle icon-button" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label={menuOpen ? "Close navigation" : "Open navigation"}>
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {menuOpen && <div className="mobile-menu">
        <div className="mobile-search-row"><form className="nav-search" action="/games"><Search size={16} /><input name="q" placeholder="Search games" aria-label="Search games" /></form></div>
        <nav aria-label="Mobile navigation">{links(true)}</nav>
        {user ? <div className="mobile-account"><span className="avatar avatar-small">{initials}</span><div><strong>{user.displayName}</strong><span>@{user.username}</span></div><button className="button button-outline button-small" onClick={logout}>Sign out</button></div> : <div className="mobile-join"><Link className="button button-primary" href="/auth?mode=register" onClick={() => setMenuOpen(false)}>Create your free account</Link><Link href="/auth?mode=login" onClick={() => setMenuOpen(false)}>Already a member? Sign in</Link></div>}
      </div>}
    </header>
    {notice && <div className="toast-notice" role="status">{notice}</div>}
    <main className="app-main">{children}</main>
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-brand"><Link className="brand" href="/"><span className="brand-mark"><Hammer size={17} /></span><span className="brand-name">gameforge<span className="brand-period">.</span></span></Link><p>Play. Create. Publish. Discover.<br />A home for small games and big ideas.</p></div>
        <div className="footer-links"><div><strong>Explore</strong><Link href="/games">Games</Link><Link href="/ai-gallery">AI creations</Link><Link href="/collections">Collections</Link></div><div><strong>Create</strong><Link href="/studio">AI Studio</Link><Link href="/dashboard">Creator dashboard</Link><Link href="/developers">Developers</Link></div><div><strong>GameForge</strong><Link href="/about">About</Link><Link href="/settings">Settings</Link><a href="https://github.com/notryuzakiii67-tech/GameForge" target="_blank" rel="noreferrer">Source ↗</a></div></div>
      </div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} GameForge · Built for the browser</span><span className="footer-note"><span className="status-dot" /> Demo content is labeled</span></div>
    </footer>
  </>;
}
