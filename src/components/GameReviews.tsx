"use client";

import { FormEvent, useEffect, useState } from "react";
import { MessageSquareText, Send } from "lucide-react";

type Review = { id: string; content: string; createdAt: string; displayName: string; username: string };

export function GameReviews({ gameId }: { gameId: string }) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function reload() {
    try {
      const response = await fetch(`/api/games/${gameId}/reviews`, { cache: "no-store" });
      const body = await response.json();
      if (response.ok && Array.isArray(body.reviews)) setReviews(body.reviews);
    } catch { /* The empty state remains honest if the network is unavailable. */ }
  }
  useEffect(() => { void reload(); }, [gameId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/games/${gameId}/reviews`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      if (response.status === 401) { window.location.href = "/auth?mode=login"; return; }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || "Review couldn’t be saved.");
      setContent("");
      setMessage("Your review is live.");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review couldn’t be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="game-description-card reviews-card">
    <div className="review-section-heading"><div><h2>Reviews</h2><p>Thoughts from players who’ve been here.</p></div><span className="review-count"><MessageSquareText size={13} /> {reviews.length}</span></div>
    <form onSubmit={submit} className="review-form"><label className="visually-hidden" htmlFor={`review-${gameId}`}>Write a review</label><textarea id={`review-${gameId}`} className="text-area" value={content} onChange={(event) => setContent(event.target.value)} minLength={5} maxLength={1200} placeholder="What did you think? Be kind, be specific…" required /><div className="review-form-footer"><span>{content.length} / 1200</span><button className="button button-primary button-small" type="submit" disabled={busy || content.trim().length < 5}><Send size={12} /> {busy ? "Posting…" : "Post review"}</button></div></form>
    {message && <p className="review-feedback" role="status">{message}</p>}
    <div className="review-list">{reviews.length ? reviews.map((review) => <article className="review-item" key={review.id}><div className="review-item-head"><strong>{review.displayName} <span>@{review.username}</span></strong><time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString()}</time></div><p>{review.content}</p></article>) : <div className="review-empty">No reviews yet. You could be the first.</div>}</div>
  </section>;
}
