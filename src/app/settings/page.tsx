import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ExternalLink, KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

export const metadata: Metadata = { title: "Settings & AI keys" };

const providers = [
  { name: "Google Gemini", href: "https://aistudio.google.com/app/apikey", instructions: "Create or revoke a key in Google AI Studio. GameForge asks Google for the model list using your key; current availability and quotas come from Google." },
  { name: "Mistral", href: "https://console.mistral.ai/api-keys/", instructions: "Create a Mistral API key in your account. The available model selector is populated from the provider’s API." },
  { name: "Groq", href: "https://console.groq.com/keys", instructions: "Create or revoke a Groq API key in the Groq console. Model access and rate limits are determined by your provider account." },
];

export default function SettingsPage() {
  return <div className="page-wrap page-content"><header className="page-header"><div className="eyebrow"><KeyRound size={13} /> SETTINGS & CONNECTIONS</div><h1>Your keys stay yours.</h1><p>GameForge uses a bring-your-own-key (BYOK) setup for AI generation. No shared platform key is silently used on your behalf.</p></header>
    <div className="settings-layout"><main className="settings-main">
      <section className="panel-card settings-security-card"><div className="settings-card-icon"><LockKeyhole size={19} /></div><div><h2>Session-scoped AI access</h2><p>Paste a provider key inside AI Studio when you want to connect. The key is sent over HTTPS to GameForge’s server for model discovery or generation, then discarded. It is not saved in the browser, a cookie, a project, or our database; leaving the page clears it from memory.</p><p>GameForge never exposes a server-level AI key to your browser and does not automatically fall back to a paid provider. Your provider’s own pricing, quotas, and terms still apply.</p><Link className="button button-primary button-small" href="/studio">Open AI Studio <ArrowRight size={13} /></Link></div></section>
      <section className="settings-provider-list"><div className="section-heading"><div><div className="eyebrow eyebrow-small">SUPPORTED PROVIDERS</div><h2>Connect a provider</h2><p>Model IDs are discovered from the key you supply; provider availability can change.</p></div></div>{providers.map((provider) => <article className="settings-provider-card" key={provider.name}><span className="settings-provider-mark"><KeyRound size={15} /></span><div><strong>{provider.name}</strong><p>{provider.instructions}</p></div><a className="button button-dark button-small" href={provider.href} target="_blank" rel="noreferrer">Provider dashboard <ExternalLink size={12} /></a></article>)}</section>
      <section className="panel-card settings-security-note"><div className="card-title-with-icon"><span><ShieldCheck size={15} /></span><h2>Security notes</h2></div><ul className="prose-list"><li>Keys are only included in the provider request you start and are redacted from application logs and error messages.</li><li>Disconnect by clearing the Studio key field or leaving the page. If a key is exposed, revoke it in the provider dashboard above.</li><li>GameForge applies a per-account request budget. Provider-side quotas are separate and may change.</li><li>Do not paste a provider key into a game prompt, generated source file, or public project description.</li></ul></section>
    </main><aside className="settings-aside"><div className="panel-card"><h3>Account basics</h3><p>Use the creator dashboard to set up a public studio profile and manage game drafts.</p><Link className="text-link" href="/dashboard">Open creator dashboard <ArrowRight size={13} /></Link></div><div className="panel-card settings-limits-card"><h3>What isn’t connected yet</h3><p>Email verification, password recovery, persistent API-key vaults, and profile image uploads are not enabled in this MVP. We don’t claim keys are stored securely because we don’t store them.</p></div></aside></div>
  </div>;
}
