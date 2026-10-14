"use client";

import { useEffect, useState } from "react";
import { Check, Heart, Share2, ShieldAlert, Star } from "lucide-react";

type ApiErrorBody = { error?: { message?: string } };

async function messageFrom(response: Response): Promise<string> {
  try {
    const body = await response.json() as ApiErrorBody;
    return body.error?.message || "That action could not be completed.";
  } catch {
    return "That action could not be completed.";
  }
}

export function FavoriteButton({ gameId, initialCount = 0 }: { gameId: string; initialCount?: number }) {
  const [favorited, setFavorited] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    fetch(`/api/games/${gameId}/favorite`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (data) setFavorited(Boolean(data.favorited)); })
      .catch(() => undefined);
  }, [gameId]);
  async function toggle() {
    setMessage("");
    setBusy(true);
    try {
      const response = await fetch(`/api/games/${gameId}/favorite`, { method: favorited ? "DELETE" : "POST" });
      if (response.status === 401) { window.location.href = "/auth?mode=login"; return; }
      if (!response.ok) { setMessage(await messageFrom(response)); return; }
      const next = !favorited;
      setFavorited(next);
      setCount((value) => Math.max(0, value + (next ? 1 : -1)));
    } catch {
      setMessage("A network error interrupted that action.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="action-with-message"><button className={`button ${favorited ? "button-primary" : "button-dark"}`} onClick={toggle} disabled={busy} aria-pressed={favorited}><Heart size={15} fill={favorited ? "currentColor" : "none"} /> {favorited ? "Saved" : "Save"}{count > 0 && <span className="action-count">{count}</span>}</button>{message && <span className="inline-action-message" role="status">{message}</span>}</div>;
}

export function ShareButton() {
  const [copied, setCopied] = useState(false);
  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return <button className="button button-dark" onClick={share}><Share2 size={14} /> {copied ? <><Check size={13} /> Copied</> : "Share"}</button>;
}

export function ReportButton({ targetId, targetType = "game" }: { targetId: string; targetType?: "game" | "ai_project" }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function report() {
    const details = window.prompt("Tell the moderation team what we should review. Please don’t include personal information.");
    if (details === null) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetType, targetId, reason: "other", details }) });
      if (response.status === 401) { window.location.href = "/auth?mode=login"; return; }
      if (!response.ok) { setMessage(await messageFrom(response)); return; }
      setMessage("Report sent to moderation.");
    } catch {
      setMessage("Couldn’t send that report. Try again later.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="action-with-message"><button className="quiet-report" onClick={report} disabled={busy}><ShieldAlert size={13} /> {busy ? "Sending…" : "Report"}</button>{message && <span className="inline-action-message" role="status">{message}</span>}</div>;
}

export function RatingControl({ gameId }: { gameId: string }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function rate(value: number) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/games/${gameId}/rating`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating: value }) });
      if (response.status === 401) { window.location.href = "/auth?mode=login"; return; }
      if (!response.ok) { setMessage(await messageFrom(response)); return; }
      setRating(value);
      setMessage("Rating saved.");
    } catch {
      setMessage("Couldn’t save that rating.");
    } finally {
      setBusy(false);
    }
  }
  return <div className="rating-widget"><div className="rating-stars" role="radiogroup" aria-label="Rate this game">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} star${value === 1 ? "" : "s"}`} disabled={busy} onMouseEnter={() => setHover(value)} onMouseLeave={() => setHover(0)} onFocus={() => setHover(value)} onBlur={() => setHover(0)} onClick={() => rate(value)}><Star size={17} fill={(hover || rating) >= value ? "currentColor" : "none"} /></button>)}</div>{message && <span className="inline-action-message" role="status">{message}</span>}</div>;
}
