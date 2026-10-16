"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, AudioLines, Download, FileBox, Image as ImageIcon, LoaderCircle, Search, ShieldCheck } from "lucide-react";
import type { PublicUser } from "@/lib/auth";

type StoreAsset = {
  id: string;
  title: string;
  description: string;
  filename: string;
  format: string;
  category: "image" | "model" | "audio";
  sizeBytes: number;
  license: { id: string; name: string; url: string };
  attribution: string;
  creator: { username: string; displayName: string };
  publishedAt: string;
  downloadUrl: string;
};

type ReportReason = "copyright" | "unsafe" | "spam" | "other";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body.error?.message ?? body.message ?? "The request could not be completed.";
  } catch { return "The request could not be completed."; }
}

export function AssetStore() {
  const [assets, setAssets] = useState<StoreAsset[]>([]);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reportId, setReportId] = useState("");
  const [reportReason, setReportReason] = useState<ReportReason>("copyright");
  const [reportDetails, setReportDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [importBusyId, setImportBusyId] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => { if (active) setUser(body?.user ?? null); })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (category !== "all") params.set("category", category);
    if (appliedQuery.trim()) params.set("q", appliedQuery.trim());
    fetch(`/api/asset-store${params.size ? `?${params}` : ""}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "The Asset Store could not be loaded.");
        if (active) setAssets(Array.isArray(body.assets) ? body.assets as StoreAsset[] : []);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "The Asset Store could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [category, appliedQuery]);

  async function reportAsset(event: FormEvent<HTMLFormElement>, assetId: string) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: "asset", targetId: assetId, reason: reportReason, details: reportDetails }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = await response.json();
      setNotice(result.message || "The report was sent to moderators.");
      setReportId(""); setReportDetails("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The report could not be sent."); }
    finally { setBusy(false); }
  }

  async function importAsset(assetId: string) {
    setImportBusyId(assetId); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/asset-store/${encodeURIComponent(assetId)}/import`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The asset could not be added to your private library.");
      setNotice(body.notice || "A private copy was added to your library. Follow the asset’s license and attribution.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The asset could not be added to your private library."); }
    finally { setImportBusyId(""); }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedQuery(query.slice(0, 80));
  }

  return <main className="page-wrap page-content asset-store-page">
    <header className="page-header asset-store-header">
      <div className="eyebrow"><ShieldCheck size={13} /> COMMUNITY ASSET STORE</div>
      <h1>Assets with permission attached.</h1>
      <p>Only validated assets with owner declarations, a public license, attribution, explicit download authorization, and moderator approval appear here. Downloads are served as attachments under each listing’s stated license. A public download is not permission to redistribute outside those terms.</p>
      <Link className="button button-primary button-small" href="/assets">Manage your assets</Link>
    </header>
    <section className="asset-store-toolbar panel-card" aria-label="Search Asset Store">
      <form className="asset-store-search" onSubmit={submitSearch}><Search size={15} /><input className="text-input" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} placeholder="Search titles, filenames, and descriptions" aria-label="Search assets" /><button className="button button-primary button-small" type="submit">Search</button></form>
      <div className="asset-filter-row" role="tablist" aria-label="Filter by asset category">{(["all", "image", "model", "audio"] as const).map((value) => <button key={value} role="tab" aria-selected={category === value} className={category === value ? "active" : ""} onClick={() => setCategory(value)}>{value === "all" ? "All assets" : `${value[0]?.toUpperCase()}${value.slice(1)}`}</button>)}</div>
    </section>
    {error && <div className="notice notice-error" role="alert"><AlertCircle size={13} /> {error}</div>}
    {notice && <div className="notice notice-success" role="status">{notice}</div>}
    {loading ? <div className="studio-loading panel-card"><LoaderCircle className="spin" size={18} /> Loading approved assets…</div>
      : assets.length ? <section className="asset-store-grid" aria-label="Approved public assets">{assets.map((asset) => <article id={`asset-${asset.id}`} className="asset-store-card panel-card" key={asset.id}>
        <div className={`asset-store-type asset-type-${asset.category}`}>{asset.category === "image" ? <ImageIcon size={20} /> : asset.category === "model" ? <FileBox size={20} /> : <AudioLines size={20} />}</div>
        <div className="asset-store-card-title"><h2>{asset.title}</h2><span>{asset.category} · {asset.format} · {formatBytes(asset.sizeBytes)}</span></div>
        <p className="asset-store-description">{asset.description || "No additional description provided."}</p>
        <div className="asset-store-credit"><small>Attribution</small><strong>{asset.attribution}</strong><span>Uploaded by <Link href={`/developers/${encodeURIComponent(asset.creator.username)}`}>{asset.creator.displayName}</Link></span></div>
        <div className="asset-store-license"><small>License</small><a href={asset.license.url} target="_blank" rel="noopener noreferrer">{asset.license.name} ↗</a><span>Review the license before using, adapting, or redistributing this asset.</span></div>
        <div className="asset-store-card-actions"><a className="button button-primary button-small" href={asset.downloadUrl}><Download size={13} /> Download under license</a>{user ? <><button className="button button-outline button-small" onClick={() => void importAsset(asset.id)} disabled={importBusyId === asset.id}>{importBusyId === asset.id ? "Adding private copy…" : "Save to my assets"}</button><button className="button button-outline button-small" onClick={() => { setReportId((current) => current === asset.id ? "" : asset.id); setReportDetails(""); }}>Report</button></> : <Link className="button button-outline button-small" href="/auth?mode=login&next=%2Fasset-store">Sign in to save or report</Link>}</div>
        {user && reportId === asset.id && <form className="asset-store-report-form" onSubmit={(event) => void reportAsset(event, asset.id)}>
          <label className="field"><span>Report reason</span><select className="select-input" value={reportReason} onChange={(event) => setReportReason(event.target.value as ReportReason)}><option value="copyright">Copyright or ownership concern</option><option value="unsafe">Unsafe or prohibited content</option><option value="spam">Spam or misleading listing</option><option value="other">Other</option></select></label>
          <label className="field"><span>Details (optional)</span><textarea className="text-area" value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} maxLength={1000} /></label>
          <button className="button button-danger button-small" disabled={busy}>{busy ? "Sending…" : "Send report"}</button>
        </form>}
      </article>)}</section> : <div className="empty-state-card"><strong>{appliedQuery || category !== "all" ? "No assets match these filters" : "No assets are public yet"}</strong><p>Uploads remain private until their owners authorize public downloads and a moderator approves the listing. Check back later, or submit your own rights-cleared assets from the Asset Studio.</p><Link className="button button-dark button-small" href="/assets">Open Asset Studio</Link></div>}
    <p className="asset-store-scope-note">Rights declarations are self-attested; moderation is not a legal guarantee or independent ownership verification. If you identify an unauthorized or infringing listing, report it for review. Public access can be removed, but previously downloaded copies cannot be recalled. <Link href="/asset-store/policy">Read the review policy.</Link></p>
  </main>;
}
