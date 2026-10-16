"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDown, Compass, FileBox, Flame, Gamepad2, Grid2X2, Hammer, Library, Menu, Search, Sparkles, X,
} from "lucide-react";
import type { PublicUser } from "@/lib/auth";

const navigation = [
  { href: "/", label: "Discover", icon: Compass },
  { href: "/games", label: "Games", icon: Gamepad2 },
  { href: "/asset-store", label: "Asset Store", icon: FileBox },
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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeIsError, setNoticeIsError] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const accountWrapRef = useRef<HTMLDivElement>(null);
  const accountToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setUser(data?.user ?? null); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [pathname]);

  useEffect(() => {
    setMenuOpen(false);
    setAccountMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const typing = target instanceof HTMLElement
        && (target.isContentEditable || Boolean(target.closest("input, textarea, select, [contenteditable='true']")));
      if (event.key === "Escape") {
        if (accountMenuOpen) {
          setAccountMenuOpen(false);
          accountToggleRef.current?.focus();
        } else if (menuOpen) {
          setMenuOpen(false);
          mobileToggleRef.current?.focus();
        } else if (document.activeElement === searchInputRef.current) {
          searchInputRef.current?.blur();
        }
        return;
      }
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (accountMenuOpen && !accountWrapRef.current?.contains(target)) setAccountMenuOpen(false);
      if (menuOpen && !mobileMenuRef.current?.contains(target) && !mobileToggleRef.current?.contains(target)) setMenuOpen(false);
    }

    function onResize() {
      if (window.innerWidth > 1439 && menuOpen) setMenuOpen(false);
      if (window.innerWidth <= 700 && accountMenuOpen) setAccountMenuOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onResize);
    };
  }, [accountMenuOpen, menuOpen]);

  async function logout() {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("The sign-out request was not accepted. Try again.");
      setUser(null);
      setAccountMenuOpen(false);
      setMenuOpen(false);
      setNoticeIsError(false);
      setNotice("You’re signed out.");
      window.setTimeout(() => setNotice(""), 3000);
    } catch {
      setNoticeIsError(true);
      setNotice("Couldn’t sign out just now. Try again.");
    }
  }

  const initials = user?.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "GF";
  const links = (mobile = false) => navigation.map(({ href, label, icon: Icon, featured }) => {
    const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    return <Link key={href} href={href} className={`nav-link${active ? " active" : ""}${featured ? " nav-featured" : ""}${mobile ? " mobile-link" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setMenuOpen(false)}>
      <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
      <span>{label}</span>
    </Link>;
  });

  function closeAccountMenu() { setAccountMenuOpen(false); }

  return <>
    <a className="skip-link" href="#main-content">Skip to main content</a>
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
            <input ref={searchInputRef} name="q" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a game" aria-label="Search games" aria-keyshortcuts="/" />
            <kbd aria-hidden="true">/</kbd>
          </form>
          {user ? <>
            <Link className="icon-button header-library-link" href="/library" aria-label="Open my library" title="My library"><Library size={18} aria-hidden="true" /></Link>
            <div className="account-wrap" ref={accountWrapRef}>
              <button ref={accountToggleRef} type="button" className="account-button" aria-expanded={accountMenuOpen} aria-controls="account-menu" aria-label={`Account options for ${user.displayName}`} onClick={() => setAccountMenuOpen((open) => !open)}>
                <span className="avatar avatar-small" aria-hidden="true">{initials}</span>
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              <div id="account-menu" className="account-menu" hidden={!accountMenuOpen}>
                <div className="account-menu-head"><strong>{user.displayName}</strong><span>@{user.username}</span></div>
                <Link href={`/developers/${user.username}`} onClick={closeAccountMenu}>My profile</Link>
                <Link href="/dashboard" onClick={closeAccountMenu}>Creator dashboard</Link>
                <Link href="/settings" onClick={closeAccountMenu}>Settings &amp; connections</Link>
                {user.role === "admin" || user.role === "moderator" ? <Link href="/admin" onClick={closeAccountMenu}>Moderation</Link> : null}
                <button type="button" onClick={logout}>Sign out</button>
              </div>
            </div>
          </> : <>
            <Link className="quiet-link sign-in-link" href="/auth?mode=login">Sign in</Link>
            <Link className="button button-small button-primary header-join" href="/auth?mode=register">Join free <span aria-hidden="true">↗</span></Link>
          </>}
          <button ref={mobileToggleRef} type="button" className="mobile-menu-toggle icon-button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="mobile-menu" aria-label={menuOpen ? "Close navigation" : "Open navigation"}>
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div id="mobile-menu" ref={mobileMenuRef} className="mobile-menu" hidden={!menuOpen}>
        <div className="mobile-search-row"><form className="nav-search" action="/games" role="search"><Search size={16} aria-hidden="true" /><input name="q" placeholder="Search games" aria-label="Search games" /></form></div>
        <nav aria-label="Mobile navigation">{links(true)}</nav>
        {user ? <div className="mobile-account">
          <div className="mobile-account-identity"><span className="avatar avatar-small" aria-hidden="true">{initials}</span><div><strong>{user.displayName}</strong><span>@{user.username}</span></div></div>
          <nav className="mobile-account-links" aria-label="Account navigation">
            <Link href={`/developers/${user.username}`} onClick={() => setMenuOpen(false)}>My profile</Link>
            <Link href="/dashboard" onClick={() => setMenuOpen(false)}>Creator dashboard</Link>
            <Link href="/settings" onClick={() => setMenuOpen(false)}>Settings</Link>
            {user.role === "admin" || user.role === "moderator" ? <Link href="/admin" onClick={() => setMenuOpen(false)}>Moderation</Link> : null}
          </nav>
          <button className="button button-outline button-small" type="button" onClick={logout}>Sign out</button>
        </div> : <div className="mobile-join"><Link className="button button-primary" href="/auth?mode=register" onClick={() => setMenuOpen(false)}>Create your free account</Link><Link href="/auth?mode=login" onClick={() => setMenuOpen(false)}>Already a member? Sign in</Link></div>}
      </div>
    </header>
    {notice && <div className="toast-notice" role={noticeIsError ? "alert" : "status"}>{notice}</div>}
    <main id="main-content" className="app-main" tabIndex={-1}>{children}</main>
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-brand"><Link className="brand" href="/"><span className="brand-mark"><Hammer size={17} /></span><span className="brand-name">gameforge<span className="brand-period">.</span></span></Link><p>Play. Create. Publish. Discover.<br />A home for small games and big ideas.</p></div>
        <div className="footer-links"><div><strong>Explore</strong><Link href="/games">Games</Link><Link href="/asset-store">Asset Store</Link><Link href="/ai-gallery">AI creations</Link><Link href="/collections">Collections</Link></div><div><strong>Create</strong><Link href="/studio">AI Studio</Link><Link href="/assets">Asset Studio</Link><Link href="/dashboard">Creator dashboard</Link><Link href="/developers">Developers</Link></div><div><strong>GameForge</strong><Link href="/about">About</Link><Link href="/settings">Settings</Link><a href="https://github.com/notryuzakiii67-tech/GameForge" target="_blank" rel="noreferrer">Source ↗</a></div></div>
      </div>
      <div className="footer-bottom"><span>© {new Date().getFullYear()} GameForge · Built for the browser</span><span className="footer-note"><span className="status-dot" /> Demo content is labeled</span></div>
    </footer>
  </>;
}
