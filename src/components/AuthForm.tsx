"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowRight, Eye, EyeOff, Gamepad2, LoaderCircle, Sparkles } from "lucide-react";

type Mode = "login" | "register";

export function AuthForm({ initialMode = "login", nextPath = "/dashboard" }: { initialMode?: Mode; nextPath?: string }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [showPassword, setShowPassword] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const body = mode === "register" ? { username, displayName, email, password } : { email, password };
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "We couldn’t sign you in. Please try again.");
      const destination = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/dashboard";
      window.location.assign(destination);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn’t sign you in. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) { setMode(next); setError(""); }

  return <div className="auth-layout page-wrap">
    <section className="auth-story"><div><Link className="brand" href="/"><span className="brand-mark"><Gamepad2 size={17} /></span><span className="brand-name">gameforge<span className="brand-period">.</span></span></Link><div className="auth-story-copy"><div className="eyebrow"><Sparkles size={13} /> PLAY · CREATE · SHARE</div><h1>{mode === "register" ? <>Every great game<br />starts somewhere.</> : <>Your next game<br />is one click away.</>}</h1><p>{mode === "register" ? "Join a community for browser games, playful experiments, and ideas that deserve to be played." : "Pick up where you left off, save the games you love, or shape a new one in the AI Studio."}</p></div></div><div className="auth-story-bottom">No downloads. No gatekeeping. Just good games.</div></section>
    <section className="auth-form-wrap"><form className="auth-form" onSubmit={submit}>
      <div className="auth-form-kicker">{mode === "register" ? "YOUR PLAYER PROFILE" : "WELCOME BACK"}</div>
      <h2>{mode === "register" ? "Create your account" : "Sign in to GameForge"}</h2>
      <p>{mode === "register" ? "A free account unlocks your library, creator tools, and private AI projects." : "Your library, projects, and saved worlds are waiting."}</p>
      {error && <div className="notice notice-error auth-error" role="alert">{error}</div>}
      {mode === "register" && <>
        <div className="field"><label htmlFor="displayName">Display name</label><input id="displayName" className="text-input" autoComplete="name" maxLength={48} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How players will know you" required /></div>
        <div className="field"><label htmlFor="username">Username</label><div className="username-input"><span>@</span><input id="username" className="text-input" autoComplete="username" minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="player_one" required /></div><small>3–24 characters · letters, numbers, and underscores</small></div>
      </>}
      <div className="field"><label htmlFor="email">Email address</label><input id="email" type="email" className="text-input" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></div>
      <div className="field"><div className="auth-password-label"><label htmlFor="password">Password</label>{mode === "register" && <small>12 characters minimum</small>}</div><div className="password-input"><input id="password" className="text-input" type={showPassword ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={mode === "register" ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "Choose a strong password" : "Your password"} required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></div>
      {mode === "register" && <p className="auth-terms">By creating an account, you agree to use GameForge respectfully. Password reset and email verification are not yet enabled.</p>}
      <button className="button button-primary auth-submit" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={15} className="spin" /> {mode === "register" ? "Creating account…" : "Signing in…"}</> : <>{mode === "register" ? "Create account" : "Sign in"} <ArrowRight size={15} /></>}</button>
      <div className="auth-switch">{mode === "register" ? <>Already have an account? <button type="button" onClick={() => switchMode("login")}>Sign in</button></> : <>New to GameForge? <button type="button" onClick={() => switchMode("register")}>Create an account</button></>}</div>
      <Link className="auth-back-home" href="/">← Back to the arcade</Link>
    </form></section>
  </div>;
}
