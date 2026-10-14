"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Expand, LoaderCircle, RotateCcw, Volume2 } from "lucide-react";

export function GamePlayer({ title, src, controls, demo }: { title: string; src: string | null; controls: string; demo: boolean }) {
  const stage = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number | undefined>(undefined);
  const [frameKey, setFrameKey] = useState(0);
  const [loading, setLoading] = useState(Boolean(src));
  const [failed, setFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!src) return;
    setLoading(true);
    setFailed(false);
    setTimedOut(false);
    timeoutRef.current = window.setTimeout(() => { setTimedOut(true); setLoading(false); }, 12_000);
    return () => { if (timeoutRef.current) window.clearTimeout(timeoutRef.current); };
  }, [frameKey, src]);

  function restart() {
    setFrameKey((value) => value + 1);
    setLoading(true);
    setFailed(false);
    setTimedOut(false);
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.current?.requestFullscreen();
    } catch {
      setFailed(true);
    }
  }

  return <section className="game-player-shell" aria-label={`${title} browser game player`}>
    <div className="player-toolbar"><div><span className="status-dot" /> <span>IN-BROWSER PLAYER</span></div><div><span className="version-label">{demo ? "DEMO BUILD" : "ISOLATED BUILD"}</span></div></div>
    <div className="player-stage" ref={stage}>
      {src ? <>
        <iframe
          key={frameKey}
          title={`${title} playable game`}
          src={src}
          sandbox="allow-scripts allow-forms allow-pointer-lock allow-downloads"
          allow="fullscreen; gamepad"
          allowFullScreen
          referrerPolicy="no-referrer"
          onLoad={() => { if (timeoutRef.current) window.clearTimeout(timeoutRef.current); setLoading(false); setFailed(false); setTimedOut(false); }}
          onError={() => { if (timeoutRef.current) window.clearTimeout(timeoutRef.current); setLoading(false); setFailed(true); }}
        />
        {loading && <div className="player-loading" role="status"><LoaderCircle size={20} className="spin" /><span>Loading game files…</span><small>The game runs inside a restricted sandbox.</small></div>}
        {(failed || timedOut) && !loading && <div className="player-recovery" role="status"><AlertCircle size={20} /><strong>{failed ? "This build couldn’t be loaded." : "The game is taking a while to load."}<small>Check your connection or restart the game.</small></strong><button className="button button-dark button-small" onClick={restart}><RotateCcw size={13} /> Try again</button></div>}
      </> : <div className="player-placeholder"><AlertCircle size={22} /><strong>Playable build not available</strong><p>The developer hasn’t uploaded a validated build for this game yet.</p></div>}
    </div>
    <div className="player-controls"><span className="demo-player-label"><span className="status-dot" /> {demo ? "Starter demo · no download required" : "Untrusted game code · restricted sandbox"}</span><div><button className="icon-button" onClick={restart} disabled={!src} aria-label="Restart game" title="Restart"><RotateCcw size={15} /></button><button className="icon-button" onClick={fullscreen} disabled={!src} aria-label="Toggle fullscreen" title="Fullscreen"><Expand size={15} /></button></div></div>
    <div className="visually-hidden"><Volume2 aria-hidden="true" /> Game audio controls, if implemented, are available inside the game.</div>
  </section>;
}
